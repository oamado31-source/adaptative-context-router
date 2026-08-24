import type { BenchmarkComparison } from '../benchmark/contracts.js';
import type { TelemetryEvent } from '../core/contracts.js';
import {
  summarizeTelemetry,
  type TelemetrySummary,
} from '../telemetry/recorder.js';

export type DashboardEvidenceMode = 'local-telemetry' | 'synthetic-demo';

export interface DashboardRunSummary {
  runId: string;
  timestamp: string;
  taskType: string | null;
  precision: string | null;
  risk: string | null;
  selectedStrategy: string | null;
  utilizationRatio: number | null;
  estimatedSavingRatio: number | null;
  pipelineStatus: string | null;
  measured: boolean;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number | null;
  costUsd: number | null;
  success: boolean | null;
  qualityScore: number | null;
}

export interface DashboardModel {
  generatedAt: string;
  evidenceMode: DashboardEvidenceMode;
  sourceLabel: string;
  disclaimer: string;
  telemetry: TelemetrySummary;
  measuredCoverageRatio: number;
  runs: readonly DashboardRunSummary[];
  benchmarks: readonly BenchmarkComparison[];
}

type MutableRunSummary = DashboardRunSummary;

function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function runIdFor(event: TelemetryEvent): string | undefined {
  return typeof event.payload.runId === 'string' ? event.payload.runId : undefined;
}

function createRun(runId: string, timestamp: string): MutableRunSummary {
  return {
    runId,
    timestamp,
    taskType: null,
    precision: null,
    risk: null,
    selectedStrategy: null,
    utilizationRatio: null,
    estimatedSavingRatio: null,
    pipelineStatus: null,
    measured: false,
    inputTokens: null,
    outputTokens: null,
    latencyMs: null,
    costUsd: null,
    success: null,
    qualityScore: null,
  };
}

function applyEvent(run: MutableRunSummary, event: TelemetryEvent): void {
  if (event.timestamp < run.timestamp) {
    run.timestamp = event.timestamp;
  }

  switch (event.type) {
    case 'classification':
      run.taskType = stringValue(event.payload.taskType);
      run.precision = stringValue(event.payload.precision);
      run.risk = stringValue(event.payload.risk);
      break;
    case 'decision': {
      run.selectedStrategy = stringValue(event.payload.selectedStrategy);
      run.estimatedSavingRatio = numberValue(event.payload.estimatedSavingRatio);
      const context = asRecord(event.payload.context);
      run.utilizationRatio = numberValue(context?.utilizationRatio);
      break;
    }
    case 'execution':
      run.pipelineStatus = stringValue(event.payload.pipelineStatus);
      break;
    case 'measurement':
      run.measured = true;
      run.inputTokens = numberValue(event.payload.inputTokens);
      run.outputTokens = numberValue(event.payload.outputTokens);
      run.latencyMs = numberValue(event.payload.latencyMs);
      run.costUsd = numberValue(event.payload.costUsd);
      run.success = booleanValue(event.payload.success);
      run.qualityScore = numberValue(event.payload.qualityScore);
      break;
    case 'error':
      break;
  }
}

export function summarizeRuns(
  events: readonly TelemetryEvent[],
): readonly DashboardRunSummary[] {
  const runs = new Map<string, MutableRunSummary>();

  for (const event of events) {
    const runId = runIdFor(event);
    if (!runId) continue;
    const run = runs.get(runId) ?? createRun(runId, event.timestamp);
    applyEvent(run, event);
    runs.set(runId, run);
  }

  return [...runs.values()].sort((left, right) =>
    right.timestamp.localeCompare(left.timestamp),
  );
}

export interface BuildDashboardModelOptions {
  evidenceMode?: DashboardEvidenceMode;
  generatedAt?: string;
}

export function buildDashboardModel(
  events: readonly TelemetryEvent[],
  benchmarks: readonly BenchmarkComparison[] = [],
  options: BuildDashboardModelOptions = {},
): DashboardModel {
  const evidenceMode = options.evidenceMode ?? 'local-telemetry';
  const telemetry = summarizeTelemetry(events);
  const runs = summarizeRuns(events);
  const measuredCoverageRatio =
    telemetry.totalRuns === 0 ? 0 : telemetry.measuredRuns / telemetry.totalRuns;

  const synthetic = evidenceMode === 'synthetic-demo';
  return {
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    evidenceMode,
    sourceLabel: synthetic ? 'Synthetic demonstration data' : 'Local ACR telemetry',
    disclaimer: synthetic
      ? 'SYNTHETIC DEMO — values are illustrative fixtures and are not project benchmark evidence.'
      : 'Routing estimates are operational signals only. Only measurement events and measured A/B benchmark inputs are evidence.',
    telemetry,
    measuredCoverageRatio,
    runs,
    benchmarks,
  };
}
