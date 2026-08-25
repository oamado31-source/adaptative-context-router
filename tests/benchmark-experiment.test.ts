import { describe, expect, it } from 'vitest';

import { parseBenchmarkCorpus } from '../src/benchmark/corpus.js';
import {
  createBenchmarkExperiment,
  finalizeBenchmarkExperiment,
  parseBenchmarkExperimentPlan,
  recordBenchmarkExperimentResult,
  summarizeBenchmarkExperiment,
} from '../src/benchmark/experiment.js';
import { compareBenchmark } from '../src/benchmark/harness.js';

function corpus(expectedStrategy = 'serena', minimumScore = 0.95) {
  return parseBenchmarkCorpus({
    schemaVersion: 1,
    id: 'real-test-v1',
    evidenceMode: 'real',
    provider: 'claude-code',
    target: {
      repository: 'owner/repo',
      revision: '0123456789abcdef0123456789abcdef01234567',
    },
    controls: {
      repetitionsPerArm: 3,
      samePrompt: true,
      sameProviderModel: true,
      sessionPersistence: false,
      armOrder: 'alternating',
      qualityEvaluation: 'blinded-rubric',
    },
    cases: [
      {
        id: 'case-one',
        taskType: 'targeted_code_search',
        task: 'Find the target symbol and report its file.',
        requiredCapabilities: expectedStrategy === 'serena' ? ['serena'] : [],
        expectedStrategy,
        targetPaths: ['src/example.ts'],
        quality: {
          minimumScore,
          assertions: ['Names the correct file.', 'Does not invent another symbol.'],
        },
      },
    ],
  });
}

function claudeResult(
  sessionId: string,
  inputTokens: number,
  resultText: string,
  isError = false,
): string {
  return JSON.stringify({
    type: 'result',
    session_id: sessionId,
    is_error: isError,
    duration_ms: 1200,
    duration_api_ms: 900,
    total_cost_usd: 0.0123,
    num_turns: 1,
    result: resultText,
    usage: {
      input_tokens: inputTokens,
      output_tokens: 100,
      cache_read_input_tokens: 20,
      cache_creation_input_tokens: 10,
    },
  });
}

function completePlan(expectedStrategy = 'serena') {
  let plan = createBenchmarkExperiment(corpus(expectedStrategy), 'case-one', 'claude-model-pinned');
  for (const slot of plan.slots) {
    const tokenCount = slot.arm === 'baseline' ? 1000 : 700;
    plan = recordBenchmarkExperimentResult(
      plan,
      slot.id,
      claudeResult(`session-${slot.sequence}`, tokenCount, `RAW-${slot.sequence}`),
      0.96,
      true,
    );
  }
  return plan;
}

describe('real A/B benchmark experiment ledger', () => {
  it('creates a deterministic alternating 3x3 plan without execution', () => {
    const first = createBenchmarkExperiment(corpus(), 'case-one', 'claude-model-pinned');
    const second = createBenchmarkExperiment(corpus(), 'case-one', 'claude-model-pinned');

    expect(first.id).toBe(second.id);
    expect(first.execution).toBe(false);
    expect(first.evidenceMode).toBe('real');
    expect(first.modelProvenance).toBe('operator-pinned');
    expect(first.slots.map((slot) => `${slot.repetition}:${slot.arm}`)).toEqual([
      '1:baseline',
      '1:acr',
      '2:acr',
      '2:baseline',
      '3:baseline',
      '3:acr',
    ]);
    expect(first.slots.map((slot) => slot.protocol)).toEqual([
      'direct-provider',
      'acr-guided',
      'acr-guided',
      'direct-provider',
      'direct-provider',
      'acr-guided',
    ]);
    expect(summarizeBenchmarkExperiment(first).pendingSlots).toBe(6);
  });

  it('rejects missing model pin and tampered provenance', () => {
    expect(() => createBenchmarkExperiment(corpus(), 'case-one', '   ')).toThrow(
      'model must be explicitly pinned',
    );

    const plan = createBenchmarkExperiment(corpus(), 'case-one', 'claude-model-pinned');
    expect(() =>
      parseBenchmarkExperimentPlan({
        ...plan,
        promptFingerprint: '0'.repeat(64),
      }),
    ).toThrow('promptFingerprint does not match');
  });

  it('requires blinded review and a fresh session fingerprint', () => {
    const plan = createBenchmarkExperiment(corpus(), 'case-one', 'claude-model-pinned');
    const slot = plan.slots[0];
    expect(slot).toBeDefined();

    expect(() =>
      recordBenchmarkExperimentResult(
        plan,
        slot!.id,
        claudeResult('session-one', 1000, 'RAW-ONE'),
        0.96,
        false,
      ),
    ).toThrow('blinded rubric confirmation');

    const noSession = JSON.stringify({
      type: 'result',
      is_error: false,
      duration_ms: 1000,
      usage: { input_tokens: 1000, output_tokens: 100 },
    });
    expect(() =>
      recordBenchmarkExperimentResult(plan, slot!.id, noSession, 0.96, true),
    ).toThrow('must include session_id');
  });

  it('rejects duplicate results and reused Claude sessions', () => {
    const initial = createBenchmarkExperiment(corpus(), 'case-one', 'claude-model-pinned');
    const first = initial.slots[0]!;
    const second = initial.slots[1]!;
    const result = claudeResult('same-session', 1000, 'RAW-ONE');
    const once = recordBenchmarkExperimentResult(initial, first.id, result, 0.96, true);

    expect(() =>
      recordBenchmarkExperimentResult(once, second.id, result, 0.96, true),
    ).toThrow('already recorded');

    expect(() =>
      recordBenchmarkExperimentResult(
        once,
        second.id,
        claudeResult('same-session', 700, 'RAW-TWO'),
        0.96,
        true,
      ),
    ).toThrow('session is already used');
  });

  it('does not persist raw Claude result content', () => {
    const plan = createBenchmarkExperiment(corpus(), 'case-one', 'claude-model-pinned');
    const slot = plan.slots[0]!;
    const updated = recordBenchmarkExperimentResult(
      plan,
      slot.id,
      claudeResult('session-private', 1000, 'RAW SECRET RESULT CONTENT'),
      0.96,
      true,
    );

    const serialized = JSON.stringify(updated);
    expect(serialized).not.toContain('RAW SECRET RESULT CONTENT');
    expect(updated.slots[0]?.record?.measurement.estimatedCostUsd).toBeCloseTo(0.0123);
    expect(updated.slots[0]?.record?.measurement.sessionFingerprint).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('refuses finalization while any slot is pending', () => {
    const plan = createBenchmarkExperiment(corpus(), 'case-one', 'claude-model-pinned');
    expect(() => finalizeBenchmarkExperiment(plan)).toThrow('pending slot');
  });

  it('finalizes measured evidence with corpus quality floor and no promoted client-estimated cost', () => {
    const benchmark = finalizeBenchmarkExperiment(completePlan());

    expect(benchmark.case.strategy).toBe('serena');
    expect(benchmark.case.minimumQualityScore).toBe(0.95);
    expect(benchmark.baseline).toHaveLength(3);
    expect(benchmark.acr).toHaveLength(3);
    expect(benchmark.baseline.every((item) => item.source === 'measured')).toBe(true);
    expect(benchmark.acr.every((item) => item.source === 'measured')).toBe(true);
    expect(benchmark.baseline.every((item) => item.costUsd === undefined)).toBe(true);
    expect(benchmark.acr.every((item) => item.costUsd === undefined)).toBe(true);
  });

  it('keeps NO_OPTIMIZATION cases as calibration controls', () => {
    const benchmark = finalizeBenchmarkExperiment(completePlan('NO_OPTIMIZATION'));
    expect(benchmark.case.strategy).toBeUndefined();
  });

  it('enforces the corpus absolute quality floor in comparative evidence', () => {
    const benchmark = finalizeBenchmarkExperiment(completePlan());
    const result = compareBenchmark({
      ...benchmark,
      baseline: benchmark.baseline.map((item) => ({ ...item, qualityScore: 0.96 })),
      acr: benchmark.acr.map((item) => ({ ...item, qualityScore: 0.94 })),
    });

    expect(result.outcome).toBe('quality-regression');
    expect(result.qualityGate.absoluteMinimum).toBe(0.95);
    expect(result.qualityGate.minimumAcceptedQuality).toBe(0.95);
  });

  it('rejects comparative evidence when baseline itself misses the corpus quality floor', () => {
    const benchmark = finalizeBenchmarkExperiment(completePlan());
    expect(() =>
      compareBenchmark({
        ...benchmark,
        baseline: benchmark.baseline.map((item) => ({ ...item, qualityScore: 0.9 })),
      }),
    ).toThrow('Baseline mean quality');
  });
});
