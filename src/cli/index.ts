#!/usr/bin/env node

import { ACR_VERSION, createBootstrapStatus } from '../core/bootstrap-status.js';
import { CAPABILITY_DEFINITIONS } from '../core/capability-definitions.js';
import { CapabilityRegistry } from '../core/capability-registry.js';
import type {
  Capability,
  ContextSnapshot,
  OptimizationMode,
  RoutingDecision,
} from '../core/contracts.js';
import { PolicyEngine } from '../core/policy-engine.js';
import { classifyTask } from '../core/task-classifier.js';

function printHelp(): void {
  console.log(`ACR — Adaptative Context Router\n\nUsage:\n  acr classify [--json] <task>\n  acr route [--json] [--context-ratio <0..1>] [--available <ids>] [--mode <observe|guarded|auto>] <task>\n  acr doctor [--json]\n  acr status [--json]\n  acr version\n  acr help\n\nCommands:\n  classify Classify task type, precision requirement and optimization risk\n  route    Evaluate routing policy and select/reject optimization strategies\n  doctor   Detect Claude Code and supported optimization capabilities\n  status   Show ACR bootstrap/runtime status\n  version  Print the ACR version`);
}

function statusGlyph(capability: Capability): string {
  switch (capability.status) {
    case 'available':
      return '✓';
    case 'incompatible':
      return '!';
    case 'unknown':
      return '?';
    case 'unavailable':
      return '·';
  }
}

function printDoctor(capabilities: readonly Capability[]): void {
  console.log('ACR doctor\n');
  for (const capability of capabilities) {
    const version = capability.version ? ` — ${capability.version}` : '';
    console.log(`${statusGlyph(capability)} ${capability.name}: ${capability.status}${version}`);
    if (capability.reason) {
      console.log(`  ${capability.reason}`);
    }
  }

  const available = capabilities.filter(
    (capability) => capability.status === 'available',
  ).length;
  console.log(`\n${available}/${capabilities.length} capabilities detected.`);
}

function printClassification(task: string): void {
  const result = classifyTask(task);
  const { profile } = result;

  console.log('ACR classify\n');
  console.log(`task-type: ${profile.taskType}`);
  console.log(`precision: ${profile.precision}`);
  console.log(`risk: ${profile.risk}`);
  console.log(`confidence: ${profile.confidence.toFixed(2)}`);
  console.log(`exact-identifiers: ${profile.requiresExactIdentifiers ? 'yes' : 'no'}`);
  console.log(`expected-output: ${profile.expectedOutputSize ?? 'unknown'}`);
  console.log('\nevidence:');
  for (const item of result.evidence) {
    console.log(`- ${item}`);
  }
}

interface RouteArguments {
  json: boolean;
  task: string;
  context: ContextSnapshot;
  availableOverride?: readonly string[];
  mode: OptimizationMode;
}

function parseNumber(value: string | undefined, flag: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${flag} requires a numeric value.`);
  }
  return parsed;
}

function parseRouteArguments(args: readonly string[]): RouteArguments {
  let json = false;
  let contextRatio: number | undefined;
  let contextTokens: number | undefined;
  let windowTokens: number | undefined;
  let availableOverride: readonly string[] | undefined;
  let mode: OptimizationMode = 'guarded';
  const taskParts: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case '--json':
        json = true;
        break;
      case '--context-ratio': {
        contextRatio = parseNumber(args[index + 1], '--context-ratio');
        index += 1;
        break;
      }
      case '--context-tokens': {
        contextTokens = parseNumber(args[index + 1], '--context-tokens');
        index += 1;
        break;
      }
      case '--window-tokens': {
        windowTokens = parseNumber(args[index + 1], '--window-tokens');
        index += 1;
        break;
      }
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
      default:
        taskParts.push(arg);
    }
  }

  if (contextRatio !== undefined && (contextRatio < 0 || contextRatio > 1)) {
    throw new Error('--context-ratio must be between 0 and 1.');
  }

  const effectiveWindow = windowTokens ?? (contextRatio !== undefined ? 200_000 : undefined);
  const effectiveEstimated =
    contextTokens ??
    (contextRatio !== undefined && effectiveWindow !== undefined
      ? Math.round(contextRatio * effectiveWindow)
      : 0);
  const effectiveRatio =
    contextRatio ??
    (effectiveWindow !== undefined && effectiveWindow > 0 && contextTokens !== undefined
      ? contextTokens / effectiveWindow
      : undefined);

  const task = taskParts.join(' ').trim();
  if (!task) {
    throw new Error('Usage: acr route [options] <task>');
  }

  return {
    json,
    task,
    context: {
      estimatedTokens: effectiveEstimated,
      ...(effectiveWindow !== undefined ? { contextWindowTokens: effectiveWindow } : {}),
      ...(effectiveRatio !== undefined ? { utilizationRatio: effectiveRatio } : {}),
      source:
        contextRatio !== undefined || contextTokens !== undefined
          ? 'estimated'
          : 'unknown',
    },
    ...(availableOverride !== undefined ? { availableOverride } : {}),
    mode,
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

function printRoute(task: string, decision: RoutingDecision): void {
  console.log('ACR route\n');
  console.log(`task: ${task}`);
  console.log(`type: ${decision.task.taskType}`);
  console.log(`precision: ${decision.task.precision}`);
  console.log(`risk: ${decision.task.risk}`);
  console.log(`mode: ${decision.mode}`);
  console.log(
    `context: ${decision.context.utilizationRatio !== undefined ? `${(decision.context.utilizationRatio * 100).toFixed(1)}%` : 'unknown'}`,
  );
  console.log(`selected: ${decision.selected?.id ?? 'NO_OPTIMIZATION'}`);
  if (decision.selected) {
    console.log(`utility-score: ${decision.selected.utilityScore?.toFixed(2) ?? 'unknown'}`);
    console.log(
      `estimated-saving: ${decision.selected.estimatedSavingRatio !== undefined ? `${(decision.selected.estimatedSavingRatio * 100).toFixed(1)}%` : 'unknown'}`,
    );
  }

  if (decision.rejected.length > 0) {
    console.log('\nrejected:');
    for (const candidate of decision.rejected) {
      console.log(
        `- ${candidate.id}: ${candidate.blocked ? 'BLOCKED' : 'not selected'}${candidate.utilityScore !== undefined ? ` (score ${candidate.utilityScore.toFixed(2)})` : ''}`,
      );
      for (const reason of candidate.reasons) {
        console.log(`  - ${reason}`);
      }
    }
  }

  console.log('\nrationale:');
  for (const item of decision.rationale) {
    console.log(`- ${item}`);
  }
}

async function main(argv: readonly string[]): Promise<void> {
  const [command = 'help', ...args] = argv;

  switch (command) {
    case 'classify': {
      const json = args.includes('--json');
      const task = args.filter((arg) => arg !== '--json').join(' ').trim();
      if (!task) {
        console.error('Usage: acr classify [--json] <task>');
        process.exitCode = 1;
        return;
      }

      const result = classifyTask(task);
      if (json) {
        console.log(JSON.stringify({ task, ...result }, null, 2));
      } else {
        printClassification(task);
      }
      return;
    }
    case 'route': {
      const route = parseRouteArguments(args);
      const classification = classifyTask(route.task);
      const capabilities = route.availableOverride
        ? overrideCapabilities(route.availableOverride)
        : await new CapabilityRegistry().discover();
      const engine = await PolicyEngine.createDefault();
      const decision = engine.evaluate({
        task: classification.profile,
        context: route.context,
        capabilities,
        mode: route.mode,
      });

      if (route.json) {
        console.log(
          JSON.stringify(
            {
              task: route.task,
              evidence: classification.evidence,
              capabilities,
              decision,
            },
            null,
            2,
          ),
        );
      } else {
        printRoute(route.task, decision);
      }
      return;
    }
    case 'doctor': {
      const capabilities = await new CapabilityRegistry().discover();
      if (args.includes('--json')) {
        console.log(JSON.stringify({ capabilities }, null, 2));
      } else {
        printDoctor(capabilities);
      }
      return;
    }
    case 'status': {
      const status = createBootstrapStatus();
      if (args.includes('--json')) {
        console.log(JSON.stringify(status, null, 2));
      } else {
        console.log(`${status.name}\nversion: ${status.version}\nmilestone: ${status.milestone}\nmode: ${status.mode}\nstatus: ${status.status}`);
      }
      return;
    }
    case 'version':
    case '--version':
    case '-v':
      console.log(ACR_VERSION);
      return;
    case 'help':
    case '--help':
    case '-h':
      printHelp();
      return;
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exitCode = 1;
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ACR failed: ${message}`);
  process.exitCode = 1;
});
