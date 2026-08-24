import { describe, expect, it } from 'vitest';

import { compareBenchmark } from '../src/benchmark/harness.js';
import type { BenchmarkInput } from '../src/benchmark/contracts.js';

function measured(
  arm: 'baseline' | 'acr',
  overrides: Partial<BenchmarkInput['baseline'][number]> = {},
): BenchmarkInput['baseline'][number] {
  return {
    arm,
    source: 'measured',
    inputTokens: arm === 'baseline' ? 10_000 : 6_000,
    outputTokens: 1_000,
    latencyMs: arm === 'baseline' ? 4_000 : 3_500,
    costUsd: arm === 'baseline' ? 0.12 : 0.08,
    success: true,
    qualityScore: arm === 'baseline' ? 0.96 : 0.95,
    ...overrides,
  };
}

function withoutCost(
  observation: BenchmarkInput['baseline'][number],
): BenchmarkInput['baseline'][number] {
  const copy = { ...observation };
  delete copy.costUsd;
  return copy;
}

function fixture(): BenchmarkInput {
  return {
    case: {
      id: 'symbol-search',
      taskType: 'targeted_code_search',
      strategy: 'serena',
      qualityTolerance: 0.02,
    },
    baseline: [measured('baseline'), measured('baseline', { inputTokens: 9_800 })],
    acr: [measured('acr'), measured('acr', { inputTokens: 6_200 })],
  };
}

describe('compareBenchmark', () => {
  it('reports measured token and cost reductions when quality is preserved', () => {
    const result = compareBenchmark(fixture());

    expect(result.measured).toBe(true);
    expect(result.outcome).toBe('acr-better');
    expect(result.qualityGate.passed).toBe(true);
    expect(result.deltas.inputTokenReductionRatio).toBeCloseTo(0.3838, 3);
    expect(result.deltas.costReductionRatio).toBeCloseTo(1 / 3, 3);
  });

  it('marks quality regression even when tokens fall sharply', () => {
    const input = fixture();
    const result = compareBenchmark({
      ...input,
      acr: [measured('acr', { inputTokens: 2_000, qualityScore: 0.8 })],
    });

    expect(result.outcome).toBe('quality-regression');
    expect(result.qualityGate.passed).toBe(false);
    expect(result.deltas.totalTokenReductionRatio).toBeGreaterThan(0.6);
  });

  it('does not claim cost savings when cost measurements are incomplete', () => {
    const input = fixture();
    const result = compareBenchmark({
      ...input,
      acr: [withoutCost(measured('acr'))],
    });

    expect(result.deltas.costReductionRatio).toBeUndefined();
    expect(result.rationale.some((item) => item.includes('Cost comparison omitted'))).toBe(true);
  });

  it('requires at least one observation per arm', () => {
    const input = fixture();
    expect(() => compareBenchmark({ ...input, baseline: [] })).toThrow(
      'baseline requires at least one measured observation',
    );
  });

  it('rejects invalid quality scores', () => {
    const input = fixture();
    expect(() =>
      compareBenchmark({
        ...input,
        acr: [measured('acr', { qualityScore: 1.2 })],
      }),
    ).toThrow('qualityScore must be between 0 and 1');
  });

  it('rejects arm mismatches rather than silently mixing A/B samples', () => {
    const input = fixture();
    expect(() =>
      compareBenchmark({
        ...input,
        baseline: [measured('acr')],
      }),
    ).toThrow('Expected baseline observation but received acr');
  });

  it('reports baseline better when ACR materially increases total tokens', () => {
    const input = fixture();
    const result = compareBenchmark({
      ...input,
      acr: [measured('acr', { inputTokens: 13_000, outputTokens: 1_500 })],
    });

    expect(result.outcome).toBe('baseline-better');
  });

  it('reports no material difference inside the two-percent token band', () => {
    const input = fixture();
    const result = compareBenchmark({
      ...input,
      baseline: [measured('baseline', { inputTokens: 10_000, outputTokens: 1_000 })],
      acr: [measured('acr', { inputTokens: 9_900, outputTokens: 1_000 })],
    });

    expect(result.outcome).toBe('no-material-difference');
  });
});
