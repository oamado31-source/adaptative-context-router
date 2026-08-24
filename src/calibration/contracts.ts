import type { BenchmarkComparison } from '../benchmark/contracts.js';

export type CalibrationDisposition =
  | 'promote'
  | 'hold'
  | 'demote'
  | 'insufficient-evidence';

export interface CalibrationThresholds {
  minimumCasesPerStrategy: number;
  minimumSamplesPerArmPerCase: number;
  minimumPromoteTokenReductionRatio: number;
  maximumEstimatedSavingRatio: number;
}

export interface CalibrationRecommendation {
  strategyId: string;
  disposition: CalibrationDisposition;
  evidenceCases: number;
  baselineSamples: number;
  acrSamples: number;
  qualityFailures: number;
  meanTotalTokenReductionRatio: number;
  meanLatencyReductionRatio: number;
  currentEstimatedSavingRatio: number;
  proposedEstimatedSavingRatio?: number;
  policyMutation: false;
  rationale: readonly string[];
}

export interface CalibrationReport {
  measured: true;
  policyMutation: false;
  comparisons: readonly BenchmarkComparison[];
  recommendations: readonly CalibrationRecommendation[];
  skippedCases: readonly {
    caseId: string;
    reason: string;
  }[];
  thresholds: CalibrationThresholds;
}
