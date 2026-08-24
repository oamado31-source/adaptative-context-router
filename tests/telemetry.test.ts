import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type {
  Capability,
  RoutingDecision,
} from '../src/core/contracts.js';
import type { PipelineExecutionResult } from '../src/core/pipeline-executor.js';
import type { TaskClassificationResult } from '../src/core/task-classifier.js';
import {
  summarizeTelemetry,
  TelemetryRecorder,
} from '../src/telemetry/recorder.js';
import {
  JsonlTelemetryStore,
  MemoryTelemetryStore,
} from '../src/telemetry/store.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

const classification: TaskClassificationResult = {
  profile: {
    taskType: 'targeted_code_search',
    precision: 'structural',
    risk: 'medium',
    confidence: 0.94,
    requiresExactIdentifiers: false,
    expectedOutputSize: 'small',
  },
  evidence: ['Targeted symbol/code-location search signal detected.'],
};

const capabilities: readonly Capability[] = [
  {
    id: 'serena',
    name: 'Serena',
    status: 'available',
  },
];

const decision: RoutingDecision = {
  task: classification.profile,
  context: {
    estimatedTokens: 122_000,
    contextWindowTokens: 200_000,
    utilizationRatio: 0.61,
    source: 'estimated',
  },
  mode: 'guarded',
  selected: {
    id: 'serena',
    adapters: ['serena'],
    estimatedSavingRatio: 0.55,
    risk: 'low',
    overheadScore: 8,
    confidence: 0.9,
    utilityScore: 74.2,
    blocked: false,
    reasons: ['Symbol-aware retrieval avoids broad repository reads.'],
  },
  rejected: [],
  rationale: ['Selected serena with utility score 74.20.'],
  createdAt: '2026-08-23T00:00:00.000Z',
};

const pipeline: PipelineExecutionResult = {
  status: 'planned',
  receipts: [],
  rolledBack: [],
  detail: 'External bridge required.',
};

describe('telemetry', () => {
  it('records fingerprints and metadata without storing the raw task', async () => {
    const store = new MemoryTelemetryStore();
    const recorder = new TelemetryRecorder(store);
    const task = 'Find where authenticateUser is defined.';

    await recorder.recordRun({
      task,
      classification,
      capabilities,
      decision,
      pipeline,
    });

    const events = await store.list();
    const serialized = JSON.stringify(events);

    expect(events).toHaveLength(3);
    expect(serialized).not.toContain(task);
    expect(events[0]?.payload.taskFingerprint).toMatch(/^[0-9a-f]{64}$/u);
    expect(events[0]?.payload.taskChars).toBe(task.length);
  });

  it('persists JSONL events and reads them back', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'acr-telemetry-'));
    tempDirs.push(directory);
    const store = new JsonlTelemetryStore(join(directory, 'events.jsonl'));
    const recorder = new TelemetryRecorder(store);

    const runId = await recorder.recordRun({
      task: 'Find where authenticateUser is defined.',
      classification,
      capabilities,
      decision,
    });
    await recorder.recordMeasurement({
      runId,
      inputTokens: 1200,
      outputTokens: 300,
      latencyMs: 850,
      costUsd: 0.012,
      success: true,
    });

    const events = await store.list();

    expect(events).toHaveLength(3);
    expect(events[2]?.type).toBe('measurement');
    expect(events[2]?.measured).toBe(true);
  });

  it('summarizes selected strategies and measured usage separately', async () => {
    const store = new MemoryTelemetryStore();
    const recorder = new TelemetryRecorder(store);
    const runId = await recorder.recordRun({
      task: 'Find where authenticateUser is defined.',
      classification,
      capabilities,
      decision,
      pipeline,
    });

    await recorder.recordMeasurement({
      runId,
      inputTokens: 900,
      outputTokens: 100,
      costUsd: 0.01,
      success: true,
      qualityScore: 1,
    });

    const summary = summarizeTelemetry(await store.list());

    expect(summary.totalRuns).toBe(1);
    expect(summary.measuredRuns).toBe(1);
    expect(summary.selectedStrategies.serena).toBe(1);
    expect(summary.executionStatuses.planned).toBe(1);
    expect(summary.measuredInputTokens).toBe(900);
    expect(summary.measuredOutputTokens).toBe(100);
    expect(summary.measuredCostUsd).toBeCloseTo(0.01);
  });

  it('counts NO_OPTIMIZATION decisions explicitly', async () => {
    const store = new MemoryTelemetryStore();
    const recorder = new TelemetryRecorder(store);

    await recorder.recordRun({
      task: 'Change the button color.',
      classification: {
        profile: {
          taskType: 'simple_operation',
          precision: 'semantic',
          risk: 'low',
          confidence: 0.9,
          requiresExactIdentifiers: false,
          expectedOutputSize: 'small',
        },
        evidence: ['Short, bounded edit signal detected.'],
      },
      capabilities: [],
      decision: {
        task: {
          taskType: 'simple_operation',
          precision: 'semantic',
          risk: 'low',
          confidence: 0.9,
          requiresExactIdentifiers: false,
          expectedOutputSize: 'small',
        },
        context: {
          estimatedTokens: 22_000,
          contextWindowTokens: 200_000,
          utilizationRatio: 0.11,
          source: 'estimated',
        },
        mode: 'guarded',
        selected: null,
        rejected: [],
        rationale: ['Decision: NO_OPTIMIZATION.'],
        createdAt: '2026-08-23T00:00:00.000Z',
      },
    });

    const summary = summarizeTelemetry(await store.list());
    expect(summary.noOptimizationRuns).toBe(1);
    expect(summary.totalRuns).toBe(1);
  });
});
