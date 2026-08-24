import type { BenchmarkComparison } from '../benchmark/contracts.js';
import type { PolicyConfig } from '../core/policy-config.js';
import type {
  CalibrationRecommendation,
  CalibrationReport,
  CalibrationThresholds,
} from './contracts.js';

export const DEFAULT_CALIBRATION_THRESHOLDS: CalibrationThresholds = {
  minimumCasesPerStrategy: 2,
  minimumSamplesPerArmPerCase: 3,
  minimumPromoteTokenReductionRatio: 0.05,
  maximumEstimatedSavingRatio: 0.9,
};

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function recommendStrategy(
  strategyId: string,
  comparisons: readonly BenchmarkComparison[],
  currentEstimatedSavingRatio: number,
  thresholds: CalibrationThresholds,
): CalibrationRecommendation {
  const baselineSamples = comparisons.reduce(
    (sum, item) => sum + item.baseline.samples,
    0,
  );
  const acrSamples = comparisons.reduce((sum, item) => sum + item.acr.samples, 0);
  const qualityFailures = comparisons.filter(
    (item) => !item.qualityGate.passed,
  ).length;
  const sampleDeficit = comparisons.some(
    (item) =>
      item.baseline.samples < thresholds.minimumSamplesPerArmPerCase ||
      item.acr.samples < thresholds.minimumSamplesPerArmPerCase,
  );
  const meanTotalTokenReductionRatio = mean(
    comparisons.map((item) => item.deltas.totalTokenReductionRatio),
  );
  const meanLatencyReductionRatio = mean(
    comparisons.map((item) => item.deltas.latencyReductionRatio),
  );
  const rationale: string[] = [];

  if (
    comparisons.length < thresholds.minimumCasesPerStrategy ||
    sampleDeficit
  ) {
    rationale.push(
      `Insufficient calibration evidence: ${comparisons.length} case(s), ${baselineSamples} baseline sample(s), ${acrSamples} ACR sample(s).`,
    );
    rationale.push(
      `Requires at least ${thresholds.minimumCasesPerStrategy} distinct measured case(s) and ${thresholds.minimumSamplesPerArmPerCase} sample(s) per arm for every case.`,
    );
    return {
      strategyId,
      disposition: 'insufficient-evidence',
      evidenceCases: comparisons.length,
      baselineSamples,
      acrSamples,
      qualityFailures,
      meanTotalTokenReductionRatio,
      meanLatencyReductionRatio,
      currentEstimatedSavingRatio,
      policyMutation: false,
      rationale,
    };
  }

  if (qualityFailures > 0) {
    rationale.push(
      `${qualityFailures} measured case(s) failed the quality/success gate; promotion is prohibited.`,
    );
    return {
      strategyId,
      disposition: 'demote',
      evidenceCases: comparisons.length,
      baselineSamples,
      acrSamples,
      qualityFailures,
      meanTotalTokenReductionRatio,
      meanLatencyReductionRatio,
      currentEstimatedSavingRatio,
      proposedEstimatedSavingRatio: clamp(
        Math.max(0, meanTotalTokenReductionRatio),
        0,
        Math.min(currentEstimatedSavingRatio, thresholds.maximumEstimatedSavingRatio),
      ),
      policyMutation: false,
      rationale,
    };
  }

  if (
    meanTotalTokenReductionRatio >=
    thresholds.minimumPromoteTokenReductionRatio
  ) {
    const proposedEstimatedSavingRatio = clamp(
      meanTotalTokenReductionRatio,
      0,
      thresholds.maximumEstimatedSavingRatio,
    );
    rationale.push(
      `Measured mean total-token reduction is ${(meanTotalTokenReductionRatio * 100).toFixed(1)}% with all quality gates passing.`,
    );
    rationale.push(
      'Recommendation is advisory only; the policy file is not modified automatically.',
    );
    return {
      strategyId,
      disposition: 'promote',
      evidenceCases: comparisons.length,
      baselineSamples,
      acrSamples,
      qualityFailures,
      meanTotalTokenReductionRatio,
      meanLatencyReductionRatio,
      currentEstimatedSavingRatio,
      proposedEstimatedSavingRatio,
      policyMutation: false,
      rationale,
    };
  }

  if (meanTotalTokenReductionRatio <= -0.02) {
    rationale.push(
      `Measured ACR token use is ${(-meanTotalTokenReductionRatio * 100).toFixed(1)}% higher than baseline on average.`,
    );
    return {
      strategyId,
      disposition: 'demote',
      evidenceCases: comparisons.length,
      baselineSamples,
      acrSamples,
      qualityFailures,
      meanTotalTokenReductionRatio,
      meanLatencyReductionRatio,
      currentEstimatedSavingRatio,
      proposedEstimatedSavingRatio: 0,
      policyMutation: false,
      rationale,
    };
  }

  rationale.push(
    `Measured mean total-token delta (${(meanTotalTokenReductionRatio * 100).toFixed(1)}%) is not strong enough to justify changing the current policy estimate.`,
  );
  return {
    strategyId,
    disposition: 'hold',
    evidenceCases: comparisons.length,
    baselineSamples,
    acrSamples,
    qualityFailures,
    meanTotalTokenReductionRatio,
    meanLatencyReductionRatio,
    currentEstimatedSavingRatio,
    policyMutation: false,
    rationale,
  };
}

export function analyzePolicyCalibration(
  comparisons: readonly BenchmarkComparison[],
  policy: PolicyConfig,
  thresholds: CalibrationThresholds = DEFAULT_CALIBRATION_THRESHOLDS,
): CalibrationReport {
  const skippedCases: { caseId: string; reason: string }[] = [];
  const byStrategy = new Map<string, BenchmarkComparison[]>();

  for (const comparison of comparisons) {
    if (!comparison.measured) {
      throw new Error('Calibration accepts measured benchmark comparisons only.');
    }
    const strategyId = comparison.case.strategy;
    if (strategyId === undefined) {
      skippedCases.push({
        caseId: comparison.case.id,
        reason: 'Benchmark case has no strategy; retained as a control and excluded from strategy calibration.',
      });
      continue;
    }
    const bucket = byStrategy.get(strategyId) ?? [];
    bucket.push(comparison);
    byStrategy.set(strategyId, bucket);
  }

  const recommendations: CalibrationRecommendation[] = [];
  for (const [strategyId, evidence] of [...byStrategy.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const strategy = policy.strategies.find((item) => item.id === strategyId);
    if (strategy === undefined) {
      skippedCases.push(
        ...evidence.map((item) => ({
          caseId: item.case.id,
          reason: `Strategy ${strategyId} does not exist in the current policy.`,
        })),
      );
      continue;
    }
    recommendations.push(
      recommendStrategy(
        strategyId,
        evidence,
        strategy.estimatedSavingRatio,
        thresholds,
      ),
    );
  }

  return {
    measured: true,
    policyMutation: false,
    comparisons,
    recommendations,
    skippedCases,
    thresholds,
  };
}
