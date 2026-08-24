import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { BenchmarkComparison, BenchmarkInput } from '../benchmark/contracts.js';
import { compareBenchmark } from '../benchmark/harness.js';
import { loadBenchmarkInput } from '../benchmark/io.js';
import type { TelemetryEvent } from '../core/contracts.js';
import {
  buildDashboardModel,
  type DashboardEvidenceMode,
  type DashboardModel,
} from '../dashboard/model.js';
import { renderDashboardHtml } from '../dashboard/render.js';
import { JsonlTelemetryStore } from '../telemetry/store.js';

export interface DashboardCliOptions {
  json: boolean;
  evidenceMode: DashboardEvidenceMode;
  telemetryPath: string;
  benchmarkPaths: readonly string[];
  outputPath: string;
}

export interface DashboardBuildResult {
  outputPath: string;
  model: DashboardModel;
}

function defaultTelemetryPath(): string {
  return join(process.cwd(), '.acr', 'telemetry', 'events.jsonl');
}

function defaultDashboardPath(): string {
  return join(process.cwd(), '.acr', 'dashboard.html');
}

export function parseDashboardArguments(
  args: readonly string[],
  evidenceMode: DashboardEvidenceMode,
): DashboardCliOptions {
  let json = false;
  let telemetryPath = defaultTelemetryPath();
  let outputPath = defaultDashboardPath();
  const benchmarkPaths: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--telemetry') {
      const value = args[index + 1];
      if (!value) throw new Error('--telemetry requires a file path.');
      telemetryPath = value;
      index += 1;
      continue;
    }
    if (arg === '--benchmark') {
      const value = args[index + 1];
      if (!value) throw new Error('--benchmark requires a benchmark JSON path.');
      benchmarkPaths.push(value);
      index += 1;
      continue;
    }
    if (arg === '--output') {
      const value = args[index + 1];
      if (!value) throw new Error('--output requires an HTML file path.');
      outputPath = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown dashboard option: ${arg ?? ''}`);
  }

  if (evidenceMode === 'synthetic-demo' && benchmarkPaths.length > 0) {
    throw new Error('Synthetic demo uses built-in fixtures; --benchmark is not accepted.');
  }

  return {
    json,
    evidenceMode,
    telemetryPath,
    benchmarkPaths,
    outputPath,
  };
}

function event(
  id: string,
  timestamp: string,
  type: TelemetryEvent['type'],
  payload: Readonly<Record<string, unknown>>,
  measured = false,
): TelemetryEvent {
  return {
    id,
    timestamp,
    type,
    source: 'acr-synthetic-demo',
    measured,
    payload,
  };
}

function syntheticEvents(): readonly TelemetryEvent[] {
  return [
    event('demo-c1', '2026-01-01T12:00:00.000Z', 'classification', {
      runId: 'demo-serena-run',
      taskType: 'targeted_code_search',
      precision: 'structural',
      risk: 'medium',
    }),
    event('demo-d1', '2026-01-01T12:00:00.100Z', 'decision', {
      runId: 'demo-serena-run',
      selectedStrategy: 'serena',
      estimatedSavingRatio: 0.62,
      context: { utilizationRatio: 0.61 },
    }),
    event('demo-e1', '2026-01-01T12:00:00.200Z', 'execution', {
      runId: 'demo-serena-run',
      pipelineStatus: 'planned',
    }),
    event(
      'demo-m1',
      '2026-01-01T12:00:01.000Z',
      'measurement',
      {
        runId: 'demo-serena-run',
        inputTokens: 6100,
        outputTokens: 1000,
        latencyMs: 3450,
        costUsd: 0.08,
        success: true,
        qualityScore: 0.95,
      },
      true,
    ),
    event('demo-c2', '2026-01-01T12:02:00.000Z', 'classification', {
      runId: 'demo-rtk-run',
      taskType: 'large_logs',
      precision: 'semantic',
      risk: 'low',
    }),
    event('demo-d2', '2026-01-01T12:02:00.100Z', 'decision', {
      runId: 'demo-rtk-run',
      selectedStrategy: 'rtk',
      estimatedSavingRatio: 0.55,
      context: { utilizationRatio: 0.73 },
    }),
    event('demo-e2', '2026-01-01T12:02:00.200Z', 'execution', {
      runId: 'demo-rtk-run',
      pipelineStatus: 'planned',
    }),
    event(
      'demo-m2',
      '2026-01-01T12:02:01.000Z',
      'measurement',
      {
        runId: 'demo-rtk-run',
        inputTokens: 7200,
        outputTokens: 900,
        latencyMs: 4100,
        costUsd: 0.09,
        success: true,
        qualityScore: 0.94,
      },
      true,
    ),
    event('demo-c3', '2026-01-01T12:04:00.000Z', 'classification', {
      runId: 'demo-noopt-run',
      taskType: 'simple_operation',
      precision: 'semantic',
      risk: 'low',
    }),
    event('demo-d3', '2026-01-01T12:04:00.100Z', 'decision', {
      runId: 'demo-noopt-run',
      selectedStrategy: null,
      estimatedSavingRatio: null,
      context: { utilizationRatio: 0.11 },
    }),
    event('demo-e3', '2026-01-01T12:04:00.200Z', 'execution', {
      runId: 'demo-noopt-run',
      pipelineStatus: 'no-optimization',
    }),
  ];
}

function syntheticBenchmarkInput(): BenchmarkInput {
  return {
    case: {
      id: 'synthetic-symbol-search',
      taskType: 'targeted_code_search',
      strategy: 'serena',
      qualityTolerance: 0.02,
      notes: 'Synthetic dashboard fixture only; not project evidence.',
    },
    baseline: [
      {
        arm: 'baseline',
        source: 'measured',
        inputTokens: 10_000,
        outputTokens: 1_000,
        latencyMs: 4_000,
        costUsd: 0.12,
        success: true,
        qualityScore: 0.96,
      },
    ],
    acr: [
      {
        arm: 'acr',
        source: 'measured',
        inputTokens: 6_100,
        outputTokens: 1_000,
        latencyMs: 3_450,
        costUsd: 0.08,
        success: true,
        qualityScore: 0.95,
      },
    ],
  };
}

async function loadComparisons(
  paths: readonly string[],
): Promise<readonly BenchmarkComparison[]> {
  const comparisons: BenchmarkComparison[] = [];
  for (const path of paths) {
    comparisons.push(compareBenchmark(await loadBenchmarkInput(path)));
  }
  return comparisons;
}

export async function buildDashboard(
  options: DashboardCliOptions,
): Promise<DashboardBuildResult> {
  const synthetic = options.evidenceMode === 'synthetic-demo';
  const events = synthetic
    ? syntheticEvents()
    : await new JsonlTelemetryStore(options.telemetryPath).list();
  const benchmarks = synthetic
    ? [compareBenchmark(syntheticBenchmarkInput())]
    : await loadComparisons(options.benchmarkPaths);
  const model = buildDashboardModel(events, benchmarks, {
    evidenceMode: options.evidenceMode,
  });
  const html = renderDashboardHtml(model);

  await mkdir(dirname(options.outputPath), { recursive: true });
  await writeFile(options.outputPath, html, 'utf8');
  return { outputPath: options.outputPath, model };
}

export function printDashboardBuild(result: DashboardBuildResult): void {
  console.log('ACR dashboard build\n');
  console.log(`mode: ${result.model.evidenceMode}`);
  console.log(`runs: ${result.model.telemetry.totalRuns}`);
  console.log(`measured-runs: ${result.model.telemetry.measuredRuns}`);
  console.log(`benchmarks: ${result.model.benchmarks.length}`);
  console.log(`output: ${result.outputPath}`);
  if (result.model.evidenceMode === 'synthetic-demo') {
    console.log('\nSYNTHETIC DEMO — generated values are illustrative and not project evidence.');
  }
}
