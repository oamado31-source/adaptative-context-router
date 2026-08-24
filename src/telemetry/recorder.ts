import { createHash, randomUUID } from 'node:crypto';

import type {
  Capability,
  RoutingDecision,
  TelemetryEvent,
} from '../core/contracts.js';
import type { PipelineExecutionResult } from '../core/pipeline-executor.js';
import type { TaskClassificationResult } from '../core/task-classifier.js';
import type { TelemetryStore } from './store.js';

export interface TelemetryRunInput {
  task: string;
  classification: TaskClassificationResult;
  capabilities: readonly Capability[];
  decision: RoutingDecision;
  pipeline?: PipelineExecutionResult;
}

export interface TelemetryMeasurementInput {
  runId: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  latencyMs?: number;
  apiLatencyMs?: number;
  costUsd?: number;
  estimatedCostUsd?: number;
  success?: boolean;
  qualityScore?: number;
  provider?: string;
  measurementSource?: string;
  tokenProvenance?: string;
  latencyProvenance?: string;
  costProvenance?: string;
  turns?: number;
  sessionFingerprint?: string;
}

export interface TelemetrySummary {
  totalEvents: number;
  totalRuns: number;
  noOptimizationRuns: number;
  measuredRuns: number;
  selectedStrategies: Readonly<Record<string, number>>;
  executionStatuses: Readonly<Record<string, number>>;
  measuredInputTokens: number;
  measuredOutputTokens: number;
  measuredCostUsd: number;
  providerEstimatedCostUsd: number;
}

function fingerprint(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function createEvent(
  type: TelemetryEvent['type'],
  source: string,
  measured: boolean,
  payload: Readonly<Record<string, unknown>>,
): TelemetryEvent {
  return {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    type,
    source,
    measured,
    payload,
  };
}

function increment(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

export class TelemetryRecorder {
  readonly #store: TelemetryStore;
  readonly #source: string;

  constructor(store: TelemetryStore, source = 'acr') {
    this.#store = store;
    this.#source = source;
  }

  async recordRun(input: TelemetryRunInput): Promise<string> {
    const runId = randomUUID();
    const profile = input.classification.profile;

    await this.#store.append(
      createEvent('classification', this.#source, false, {
        runId,
        taskFingerprint: fingerprint(input.task),
        taskChars: input.task.length,
        taskType: profile.taskType,
        precision: profile.precision,
        risk: profile.risk,
        confidence: profile.confidence,
        requiresExactIdentifiers: profile.requiresExactIdentifiers,
        expectedOutputSize: profile.expectedOutputSize ?? 'unknown',
      }),
    );

    await this.#store.append(
      createEvent('decision', this.#source, false, {
        runId,
        mode: input.decision.mode,
        context: {
          estimatedTokens: input.decision.context.estimatedTokens,
          contextWindowTokens: input.decision.context.contextWindowTokens ?? null,
          utilizationRatio: input.decision.context.utilizationRatio ?? null,
          cacheReadTokens: input.decision.context.cacheReadTokens ?? null,
          cacheWriteTokens: input.decision.context.cacheWriteTokens ?? null,
          source: input.decision.context.source,
        },
        selectedStrategy: input.decision.selected?.id ?? null,
        estimatedSavingRatio:
          input.decision.selected?.estimatedSavingRatio ?? null,
        utilityScore: input.decision.selected?.utilityScore ?? null,
        capabilities: input.capabilities.map((capability) => ({
          id: capability.id,
          status: capability.status,
          version: capability.version ?? null,
        })),
        rejected: input.decision.rejected.map((candidate) => ({
          id: candidate.id,
          blocked: candidate.blocked,
          utilityScore: candidate.utilityScore ?? null,
        })),
      }),
    );

    if (input.pipeline) {
      await this.#store.append(
        createEvent('execution', this.#source, false, {
          runId,
          pipelineStatus: input.pipeline.status,
          receipts: input.pipeline.receipts.map((receipt) => ({
            adapterId: receipt.adapterId,
            status: receipt.status,
            risk: receipt.plan.risk,
            externalExecutionAttempted: receipt.externalExecutionAttempted,
            requiresApproval: receipt.plan.requiresApproval,
          })),
        }),
      );
    }

    return runId;
  }

  async recordMeasurement(input: TelemetryMeasurementInput): Promise<void> {
    await this.#store.append(
      createEvent('measurement', this.#source, true, {
        runId: input.runId,
        inputTokens: input.inputTokens ?? null,
        outputTokens: input.outputTokens ?? null,
        cacheReadTokens: input.cacheReadTokens ?? null,
        cacheWriteTokens: input.cacheWriteTokens ?? null,
        latencyMs: input.latencyMs ?? null,
        apiLatencyMs: input.apiLatencyMs ?? null,
        costUsd: input.costUsd ?? null,
        estimatedCostUsd: input.estimatedCostUsd ?? null,
        success: input.success ?? null,
        qualityScore: input.qualityScore ?? null,
        provider: input.provider ?? null,
        measurementSource: input.measurementSource ?? null,
        tokenProvenance: input.tokenProvenance ?? null,
        latencyProvenance: input.latencyProvenance ?? null,
        costProvenance: input.costProvenance ?? null,
        turns: input.turns ?? null,
        sessionFingerprint: input.sessionFingerprint ?? null,
      }),
    );
  }
}

export function summarizeTelemetry(
  events: readonly TelemetryEvent[],
): TelemetrySummary {
  const selectedStrategies: Record<string, number> = {};
  const executionStatuses: Record<string, number> = {};
  const runIds = new Set<string>();
  const measuredRunIds = new Set<string>();
  let noOptimizationRuns = 0;
  let measuredInputTokens = 0;
  let measuredOutputTokens = 0;
  let measuredCostUsd = 0;
  let providerEstimatedCostUsd = 0;

  for (const event of events) {
    const runId =
      typeof event.payload.runId === 'string' ? event.payload.runId : undefined;
    if (runId) runIds.add(runId);

    if (event.type === 'decision') {
      const strategy = event.payload.selectedStrategy;
      if (typeof strategy === 'string') {
        increment(selectedStrategies, strategy);
      } else if (strategy === null) {
        noOptimizationRuns += 1;
      }
    }

    if (event.type === 'execution') {
      const status = event.payload.pipelineStatus;
      if (typeof status === 'string') {
        increment(executionStatuses, status);
      }
    }

    if (event.type === 'measurement') {
      if (runId) measuredRunIds.add(runId);
      if (typeof event.payload.inputTokens === 'number') {
        measuredInputTokens += event.payload.inputTokens;
      }
      if (typeof event.payload.outputTokens === 'number') {
        measuredOutputTokens += event.payload.outputTokens;
      }
      if (typeof event.payload.costUsd === 'number') {
        measuredCostUsd += event.payload.costUsd;
      }
      if (typeof event.payload.estimatedCostUsd === 'number') {
        providerEstimatedCostUsd += event.payload.estimatedCostUsd;
      }
    }
  }

  return {
    totalEvents: events.length,
    totalRuns: runIds.size,
    noOptimizationRuns,
    measuredRuns: measuredRunIds.size,
    selectedStrategies,
    executionStatuses,
    measuredInputTokens,
    measuredOutputTokens,
    measuredCostUsd,
    providerEstimatedCostUsd,
  };
}
