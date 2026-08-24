import { join } from 'node:path';

import { capabilityResolverFromSnapshot } from '../adapters/default-adapters.js';
import { AdapterRegistry } from '../adapters/registry.js';
import {
  applyAdaptiveRoutingProfile,
  loadAdaptiveRoutingProfile,
} from '../adaptive/profile.js';
import { CAPABILITY_DEFINITIONS } from '../core/capability-definitions.js';
import { CapabilityRegistry } from '../core/capability-registry.js';
import type {
  Capability,
  ContextSnapshot,
  OptimizationMode,
  RoutingDecision,
} from '../core/contracts.js';
import {
  PipelineExecutor,
  type PipelineExecutionResult,
} from '../core/pipeline-executor.js';
import { loadPolicyConfig } from '../core/policy-config.js';
import { PolicyEngine } from '../core/policy-engine.js';
import { classifyTask } from '../core/task-classifier.js';
import { TelemetryRecorder } from '../telemetry/recorder.js';
import { JsonlTelemetryStore } from '../telemetry/store.js';

interface AdaptiveRouteArguments {
  json: boolean;
  recordTelemetry: boolean;
  task: string;
  context: ContextSnapshot;
  availableOverride?: readonly string[];
  mode: OptimizationMode;
  adaptiveProfilePath: string;
}

function defaultTelemetryPath(): string {
  return join(process.cwd(), '.acr', 'telemetry', 'events.jsonl');
}

function parseNumber(value: string | undefined, flag: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${flag} requires a numeric value.`);
  }
  return parsed;
}

function parseAdaptiveRouteArguments(
  args: readonly string[],
  command: 'route' | 'plan',
): AdaptiveRouteArguments {
  let json = false;
  let recordTelemetry = false;
  let contextRatio: number | undefined;
  let contextTokens: number | undefined;
  let windowTokens: number | undefined;
  let availableOverride: readonly string[] | undefined;
  let mode: OptimizationMode = 'guarded';
  let adaptiveProfilePath: string | undefined;
  const taskParts: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) continue;

    switch (arg) {
      case '--json':
        json = true;
        break;
      case '--record':
        recordTelemetry = true;
        break;
      case '--context-ratio':
        contextRatio = parseNumber(args[index + 1], '--context-ratio');
        index += 1;
        break;
      case '--context-tokens':
        contextTokens = parseNumber(args[index + 1], '--context-tokens');
        index += 1;
        break;
      case '--window-tokens':
        windowTokens = parseNumber(args[index + 1], '--window-tokens');
        index += 1;
        break;
      case '--available': {
        const raw = args[index + 1];
        if (!raw) throw new Error('--available requires a comma-separated list.');
        availableOverride = raw
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);
        index += 1;
        break;
      }
      case '--mode': {
        const raw = args[index + 1];
        if (raw !== 'observe' && raw !== 'guarded' && raw !== 'auto') {
          throw new Error('--mode must be observe, guarded or auto.');
        }
        mode = raw;
        index += 1;
        break;
      }
      case '--adaptive-profile': {
        const raw = args[index + 1];
        if (!raw) throw new Error('--adaptive-profile requires a file path.');
        adaptiveProfilePath = raw;
        index += 1;
        break;
      }
      default:
        if (arg.startsWith('--')) {
          throw new Error(`Unknown ${command} option: ${arg}`);
        }
        taskParts.push(arg);
    }
  }

  if (!adaptiveProfilePath) {
    throw new Error('--adaptive-profile is required for adaptive routing.');
  }
  if (contextRatio !== undefined && (contextRatio < 0 || contextRatio > 1)) {
    throw new Error('--context-ratio must be between 0 and 1.');
  }

  const effectiveWindow =
    windowTokens ?? (contextRatio !== undefined ? 200_000 : undefined);
  const effectiveEstimated =
    contextTokens ??
    (contextRatio !== undefined && effectiveWindow !== undefined
      ? Math.round(contextRatio * effectiveWindow)
      : 0);
  const effectiveRatio =
    contextRatio ??
    (effectiveWindow !== undefined &&
    effectiveWindow > 0 &&
    contextTokens !== undefined
      ? contextTokens / effectiveWindow
      : undefined);

  const task = taskParts.join(' ').trim();
  if (!task) {
    throw new Error(`Usage: acr ${command} [options] --adaptive-profile <profile.json> <task>`);
  }

  return {
    json,
    recordTelemetry,
    task,
    context: {
      estimatedTokens: effectiveEstimated,
      ...(effectiveWindow !== undefined
        ? { contextWindowTokens: effectiveWindow }
        : {}),
      ...(effectiveRatio !== undefined ? { utilizationRatio: effectiveRatio } : {}),
      source:
        contextRatio !== undefined || contextTokens !== undefined
          ? 'estimated'
          : 'unknown',
    },
    ...(availableOverride !== undefined ? { availableOverride } : {}),
    mode,
    adaptiveProfilePath,
  };
}

function overrideCapabilities(availableIds: readonly string[]): readonly Capability[] {
  const requested = new Set(availableIds);
  return CAPABILITY_DEFINITIONS.map((definition) => ({
    id: definition.id,
    name: definition.name,
    status: requested.has(definition.id) ? 'available' : 'unavailable',
    reason: 'CLI capability override for deterministic routing evaluation.',
  }));
}

async function evaluateAdaptiveRoute(route: AdaptiveRouteArguments) {
  const classification = classifyTask(route.task);
  const capabilities = route.availableOverride
    ? overrideCapabilities(route.availableOverride)
    : await new CapabilityRegistry().discover();

  const baseConfig = await loadPolicyConfig();
  const profile = await loadAdaptiveRoutingProfile(route.adaptiveProfilePath);
  const applied = applyAdaptiveRoutingProfile(baseConfig, profile);
  const engine = new PolicyEngine(applied.config);
  const baseDecision = engine.evaluate({
    task: classification.profile,
    context: route.context,
    capabilities,
    mode: route.mode,
  });

  const decision: RoutingDecision = {
    ...baseDecision,
    adaptive: applied.provenance,
    rationale: [
      `Adaptive profile ${applied.provenance.profileId} applied from measured evidence (${applied.provenance.appliedRules} rule(s)).`,
      ...baseDecision.rationale,
    ],
  };

  return { classification, capabilities, decision };
}

async function recordRouteTelemetry(
  route: AdaptiveRouteArguments,
  classification: ReturnType<typeof classifyTask>,
  capabilities: readonly Capability[],
  decision: RoutingDecision,
  pipeline?: PipelineExecutionResult,
): Promise<string | undefined> {
  if (!route.recordTelemetry) return undefined;
  const recorder = new TelemetryRecorder(
    new JsonlTelemetryStore(defaultTelemetryPath()),
    'acr-cli',
  );
  return recorder.recordRun({
    task: route.task,
    classification,
    capabilities,
    decision,
    ...(pipeline ? { pipeline } : {}),
  });
}

function printDecision(task: string, decision: RoutingDecision): void {
  console.log('ACR adaptive route\n');
  console.log(`task: ${task}`);
  console.log(`type: ${decision.task.taskType}`);
  console.log(`precision: ${decision.task.precision}`);
  console.log(`risk: ${decision.task.risk}`);
  console.log(`mode: ${decision.mode}`);
  console.log(`adaptive-profile: ${decision.adaptive?.profileId ?? 'none'}`);
  console.log(`adaptive-rules: ${decision.adaptive?.appliedRules ?? 0}`);
  console.log(`selected: ${decision.selected?.id ?? 'NO_OPTIMIZATION'}`);
  if (decision.selected) {
    console.log(`utility-score: ${decision.selected.utilityScore?.toFixed(2) ?? 'unknown'}`);
    console.log(
      `estimated-saving: ${decision.selected.estimatedSavingRatio !== undefined ? `${(decision.selected.estimatedSavingRatio * 100).toFixed(1)}%` : 'unknown'}`,
    );
  }
  console.log('\nrationale:');
  for (const item of decision.rationale) console.log(`- ${item}`);
}

function printPlan(result: PipelineExecutionResult): void {
  console.log('\nadapter-plan:');
  console.log(`pipeline-status: ${result.status}`);
  console.log(`detail: ${result.detail}`);
  if (result.receipts.length === 0) {
    console.log('receipts: none');
    return;
  }
  console.log('receipts:');
  for (const receipt of result.receipts) {
    console.log(`- ${receipt.adapterId}: ${receipt.status}`);
  }
}

export async function runAdaptiveRouteCli(
  command: 'route' | 'plan',
  args: readonly string[],
): Promise<number> {
  const route = parseAdaptiveRouteArguments(args, command);
  const { classification, capabilities, decision } =
    await evaluateAdaptiveRoute(route);

  let pipeline: PipelineExecutionResult | undefined;
  if (command === 'plan') {
    const adapterRegistry = AdapterRegistry.createDefault(
      capabilityResolverFromSnapshot(capabilities),
    );
    pipeline = await new PipelineExecutor(adapterRegistry).execute(decision);
  }

  const telemetryRunId = await recordRouteTelemetry(
    route,
    classification,
    capabilities,
    decision,
    pipeline,
  );

  if (route.json) {
    console.log(
      JSON.stringify(
        {
          task: route.task,
          evidence: classification.evidence,
          capabilities,
          decision,
          ...(pipeline ? { pipeline } : {}),
          ...(telemetryRunId ? { telemetryRunId } : {}),
        },
        null,
        2,
      ),
    );
    return 0;
  }

  printDecision(route.task, decision);
  if (pipeline) printPlan(pipeline);
  if (telemetryRunId) console.log(`\ntelemetry-run: ${telemetryRunId}`);
  return 0;
}
