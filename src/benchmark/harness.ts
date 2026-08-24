import type {
  BenchmarkAggregate,
  BenchmarkComparison,
  BenchmarkInput,
  BenchmarkObservation,
} from './contracts.js';

const DEFAULT_QUALITY_TOLERANCE = 0.02;
const MATERIAL_TOKEN_DELTA = 0.02;

function assertFiniteNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite non-negative number.`);
  }
}

function assertObservation(
  observation: BenchmarkObservation,
  expectedArm: BenchmarkObservation['arm'],
): void {
  if (observation.source !== 'measured') {
    throw new Error('Benchmark evidence must be measured; estimates are not accepted.');
  }
  if (observation.arm !== expectedArm) {
    throw new Error(`Expected ${expectedArm} observation but received ${observation.arm}.`);
  }

  assertFiniteNonNegative(observation.inputTokens, 'inputTokens');
  assertFiniteNonNegative(observation.outputTokens, 'outputTokens');
  assertFiniteNonNegative(observation.cacheReadTokens ?? 0, 'cacheReadTokens');
  assertFiniteNonNegative(observation.cacheWriteTokens ?? 0, 'cacheWriteTokens');
  assertFiniteNonNegative(observation.latencyMs, 'latencyMs');
  if (observation.costUsd !== undefined) {
    assertFiniteNonNegative(observation.costUsd, 'costUsd');
  }
  if (
    !Number.isFinite(observation.qualityScore) ||
    observation.qualityScore < 0 ||
    observation.qualityScore > 1
  ) {
    throw new Error('qualityScore must be between 0 and 1.');
  }
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function aggregate(
  observations: readonly BenchmarkObservation[],
  arm: BenchmarkObservation['arm'],
): BenchmarkAggregate {
  if (observations.length === 0) {
    throw new Error(`${arm} requires at least one measured observation.`);
  }
  for (const observation of observations) {
    assertObservation(observation, arm);
  }

  const costs = observations
    .map((observation) => observation.costUsd)
    .filter((value): value is number => value !== undefined);

  const meanInputTokens = mean(observations.map((item) => item.inputTokens));
  const meanOutputTokens = mean(observations.map((item) => item.outputTokens));

  return {
    samples: observations.length,
    meanInputTokens,
    meanOutputTokens,
    meanTotalTokens: meanInputTokens + meanOutputTokens,
    meanCacheReadTokens: mean(
      observations.map((item) => item.cacheReadTokens ?? 0),
    ),
    meanCacheWriteTokens: mean(
      observations.map((item) => item.cacheWriteTokens ?? 0),
    ),
    meanLatencyMs: mean(observations.map((item) => item.latencyMs)),
    ...(costs.length === observations.length
      ? { meanCostUsd: mean(costs) }
      : {}),
    successRate:
      observations.filter((item) => item.success).length / observations.length,
    meanQualityScore: mean(observations.map((item) => item.qualityScore)),
  };
}

function reductionRatio(baseline: number, candidate: number): number {
  if (baseline === 0) return candidate === 0 ? 0 : -1;
  return (baseline - candidate) / baseline;
}

export function compareBenchmark(input: BenchmarkInput): BenchmarkComparison {
  const baseline = aggregate(input.baseline, 'baseline');
  const acr = aggregate(input.acr, 'acr');
  const tolerance = input.case.qualityTolerance ?? DEFAULT_QUALITY_TOLERANCE;

  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 1) {
    throw new Error('qualityTolerance must be between 0 and 1.');
  }

  const minimumAcceptedQuality = Math.max(
    0,
    baseline.meanQualityScore - tolerance,
  );
  const qualityPassed =
    acr.meanQualityScore >= minimumAcceptedQuality &&
    acr.successRate >= baseline.successRate;

  const inputTokenReductionRatio = reductionRatio(
    baseline.meanInputTokens,
    acr.meanInputTokens,
  );
  const totalTokenReductionRatio = reductionRatio(
    baseline.meanTotalTokens,
    acr.meanTotalTokens,
  );
  const latencyReductionRatio = reductionRatio(
    baseline.meanLatencyMs,
    acr.meanLatencyMs,
  );
  const costReductionRatio =
    baseline.meanCostUsd !== undefined && acr.meanCostUsd !== undefined
      ? reductionRatio(baseline.meanCostUsd, acr.meanCostUsd)
      : undefined;

  const deltas = {
    inputTokenReductionRatio,
    totalTokenReductionRatio,
    latencyReductionRatio,
    ...(costReductionRatio !== undefined ? { costReductionRatio } : {}),
    qualityDelta: acr.meanQualityScore - baseline.meanQualityScore,
    successRateDelta: acr.successRate - baseline.successRate,
  };

  const rationale: string[] = [];
  let outcome: BenchmarkComparison['outcome'];

  if (!qualityPassed) {
    outcome = 'quality-regression';
    rationale.push(
      `ACR quality/success failed the gate: quality ${acr.meanQualityScore.toFixed(3)} vs minimum ${minimumAcceptedQuality.toFixed(3)}, success ${(acr.successRate * 100).toFixed(1)}% vs baseline ${(baseline.successRate * 100).toFixed(1)}%.`,
    );
  } else if (totalTokenReductionRatio >= MATERIAL_TOKEN_DELTA) {
    outcome = 'acr-better';
    rationale.push(
      `Measured total-token reduction is ${(totalTokenReductionRatio * 100).toFixed(1)}% while the quality gate passes.`,
    );
  } else if (totalTokenReductionRatio <= -MATERIAL_TOKEN_DELTA) {
    outcome = 'baseline-better';
    rationale.push(
      `ACR used ${(-totalTokenReductionRatio * 100).toFixed(1)}% more measured total tokens than baseline.`,
    );
  } else {
    outcome = 'no-material-difference';
    rationale.push(
      `Measured total-token delta is within ±${(MATERIAL_TOKEN_DELTA * 100).toFixed(0)}%.`,
    );
  }

  if (costReductionRatio === undefined) {
    rationale.push('Cost comparison omitted because complete measured cost data was not supplied for both arms.');
  } else {
    rationale.push(
      `Measured cost delta: ${(costReductionRatio * 100).toFixed(1)}% reduction relative to baseline.`,
    );
  }

  return {
    case: input.case,
    baseline,
    acr,
    deltas,
    qualityGate: {
      tolerance,
      minimumAcceptedQuality,
      passed: qualityPassed,
    },
    outcome,
    measured: true,
    rationale,
  };
}
