import type { TaskType } from '../core/contracts.js';

export type BenchmarkArm = 'baseline' | 'acr';
export type BenchmarkEvidenceSource = 'measured';

export interface BenchmarkCase {
  id: string;
  taskType: TaskType;
  strategy?: string;
  taskFingerprint?: string;
  qualityTolerance?: number;
  minimumQualityScore?: number;
  notes?: string;
}

export interface BenchmarkObservation {
  arm: BenchmarkArm;
  source: BenchmarkEvidenceSource;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  latencyMs: number;
  costUsd?: number;
  success: boolean;
  qualityScore: number;
}

export interface BenchmarkInput {
  case: BenchmarkCase;
  baseline: readonly BenchmarkObservation[];
  acr: readonly BenchmarkObservation[];
}

export interface BenchmarkAggregate {
  samples: number;
  meanInputTokens: number;
  meanOutputTokens: number;
  meanTotalTokens: number;
  meanCacheReadTokens: number;
  meanCacheWriteTokens: number;
  meanLatencyMs: number;
  meanCostUsd?: number;
  successRate: number;
  meanQualityScore: number;
}

export interface BenchmarkDeltas {
  inputTokenReductionRatio: number;
  totalTokenReductionRatio: number;
  latencyReductionRatio: number;
  costReductionRatio?: number;
  qualityDelta: number;
  successRateDelta: number;
}

export type BenchmarkOutcome =
  | 'acr-better'
  | 'baseline-better'
  | 'no-material-difference'
  | 'quality-regression';

export interface BenchmarkComparison {
  case: BenchmarkCase;
  baseline: BenchmarkAggregate;
  acr: BenchmarkAggregate;
  deltas: BenchmarkDeltas;
  qualityGate: {
    tolerance: number;
    absoluteMinimum?: number;
    minimumAcceptedQuality: number;
    passed: boolean;
  };
  outcome: BenchmarkOutcome;
  measured: true;
  rationale: readonly string[];
}
