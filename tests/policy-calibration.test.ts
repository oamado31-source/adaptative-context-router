import { describe, expect, it } from 'vitest';

import type { BenchmarkArm, BenchmarkInput } from '../src/benchmark/contracts.js';
import { compareBenchmark } from '../src/benchmark/harness.js';
import {
  analyzePolicyCalibration,
  DEFAULT_CALIBRATION_THRESHOLDS,
} from '../src/calibration/analyzer.js';
import { parseCalibrationCliArguments } from '../src/cli/calibration.js';
import type { PolicyConfig } from '../src/core/policy-config.js';

function observations(
  arm: BenchmarkArm,
  inputTokens: number,
  qualityScore = 0.95,
  success = true,
): BenchmarkInput['baseline'] {
  return Array.from({ length: 3 }, () => ({
    arm,
    source: 'measured' as const,
    inputTokens,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    latencyMs: arm === 'baseline' ? 1000 : 900,
    success,
    qualityScore,
  }));
}

function comparison(options: {
  id: string;
  strategy?: string;
  baselineInput?: number;
  acrInput?: number;
  baselineQuality?: number;
  acrQuality?: number;
}) {
  const baselineInput = options.baselineInput ?? 1000;
  const acrInput = options.acrInput ?? 800;
  const baselineQuality = options.baselineQuality ?? 0.95;
  const acrQuality = options.acrQuality ?? 0.95;

  return compareBenchmark({
    case: {
      id: options.id,
      taskType: 'targeted_code_search',
      ...(options.strategy !== undefined ? { strategy: options.strategy } : {}),
      qualityTolerance: 0.02,
    },
    baseline: observations('baseline', baselineInput, baselineQuality),
    acr: observations('acr', acrInput, acrQuality),
  });
}

const policy: PolicyConfig = {
  version: 1,
  weights: {
    saving: 100,
    risk: {
      low: 2,
      medium: 10,
      high: 25,
      critical: 100,
    },
    overhead: 20,
    confidence: 10,
  },
  noOptimization: {
    simpleTaskMaxContextUtilization: 0.25,
    generalReasoningMaxContextUtilization: 0.35,
    minimumUtilityScore: 20,
  },
  strategies: [
    {
      id: 'serena',
      adapters: ['serena'],
      taskTypes: ['targeted_code_search', 'repository_exploration'],
      requiredCapabilities: ['serena'],
      forbiddenPrecisions: [],
      estimatedSavingRatio: 0.62,
      risk: 'low',
      overheadScore: 0.1,
      baseScore: 0,
      confidence: 0.9,
      reasons: ['Test strategy.'],
    },
  ],
};

describe('evidence-driven policy calibration', () => {
  it('keeps one measured case as insufficient evidence and never mutates policy', () => {
    const report = analyzePolicyCalibration(
      [comparison({ id: 'one-case', strategy: 'serena' })],
      policy,
    );

    expect(report.measured).toBe(true);
    expect(report.policyMutation).toBe(false);
    expect(report.recommendations).toHaveLength(1);
    expect(report.recommendations[0]?.disposition).toBe('insufficient-evidence');
    expect(report.recommendations[0]?.policyMutation).toBe(false);
    expect(report.recommendations[0]?.proposedEstimatedSavingRatio).toBeUndefined();
  });

  it('promotes only when multiple measured cases clear the quality gate and token threshold', () => {
    const report = analyzePolicyCalibration(
      [
        comparison({ id: 'good-a', strategy: 'serena', acrInput: 800 }),
        comparison({ id: 'good-b', strategy: 'serena', acrInput: 700 }),
      ],
      policy,
    );

    const recommendation = report.recommendations[0];
    expect(recommendation?.disposition).toBe('promote');
    expect(recommendation?.qualityFailures).toBe(0);
    expect(recommendation?.meanTotalTokenReductionRatio).toBeCloseTo(0.25, 6);
    expect(recommendation?.proposedEstimatedSavingRatio).toBeCloseTo(0.25, 6);
    expect(recommendation?.policyMutation).toBe(false);
  });

  it('demotes when any measured case regresses quality even when token use improves', () => {
    const report = analyzePolicyCalibration(
      [
        comparison({ id: 'quality-good', strategy: 'serena', acrInput: 600 }),
        comparison({
          id: 'quality-bad',
          strategy: 'serena',
          acrInput: 500,
          acrQuality: 0.8,
        }),
      ],
      policy,
    );

    const recommendation = report.recommendations[0];
    expect(recommendation?.meanTotalTokenReductionRatio).toBeGreaterThan(0);
    expect(recommendation?.qualityFailures).toBe(1);
    expect(recommendation?.disposition).toBe('demote');
    expect(recommendation?.policyMutation).toBe(false);
  });

  it('holds when measured benefit is positive but below the promotion threshold', () => {
    const report = analyzePolicyCalibration(
      [
        comparison({ id: 'small-a', strategy: 'serena', acrInput: 970 }),
        comparison({ id: 'small-b', strategy: 'serena', acrInput: 970 }),
      ],
      policy,
    );

    expect(report.recommendations[0]?.disposition).toBe('hold');
    expect(report.recommendations[0]?.proposedEstimatedSavingRatio).toBeUndefined();
  });

  it('demotes when measured ACR token use is materially worse than baseline', () => {
    const report = analyzePolicyCalibration(
      [
        comparison({ id: 'worse-a', strategy: 'serena', acrInput: 1100 }),
        comparison({ id: 'worse-b', strategy: 'serena', acrInput: 1100 }),
      ],
      policy,
    );

    expect(report.recommendations[0]?.disposition).toBe('demote');
    expect(report.recommendations[0]?.proposedEstimatedSavingRatio).toBe(0);
  });

  it('keeps control cases and unknown strategies out of calibration recommendations', () => {
    const report = analyzePolicyCalibration(
      [
        comparison({ id: 'control' }),
        comparison({ id: 'unknown', strategy: 'not-in-policy' }),
      ],
      policy,
    );

    expect(report.recommendations).toHaveLength(0);
    expect(report.skippedCases).toHaveLength(2);
    expect(report.skippedCases.map((item) => item.caseId).sort()).toEqual([
      'control',
      'unknown',
    ]);
  });

  it('requires explicit benchmark files and rejects automatic policy mutation flags', () => {
    expect(
      parseCalibrationCliArguments([
        '--file',
        'a.json',
        '--file',
        'b.json',
        '--json',
      ]),
    ).toEqual({ files: ['a.json', 'b.json'], json: true });

    expect(() => parseCalibrationCliArguments([])).toThrow(/Usage:/);
    expect(() =>
      parseCalibrationCliArguments(['--file', 'a.json', '--apply']),
    ).toThrow(/advisory only/i);
    expect(() =>
      parseCalibrationCliArguments(['--file', 'a.json', '--write-policy']),
    ).toThrow(/advisory only/i);
  });

  it('keeps conservative default evidence thresholds', () => {
    expect(DEFAULT_CALIBRATION_THRESHOLDS).toEqual({
      minimumCasesPerStrategy: 2,
      minimumSamplesPerArmPerCase: 3,
      minimumPromoteTokenReductionRatio: 0.05,
      maximumEstimatedSavingRatio: 0.9,
    });
  });
});
