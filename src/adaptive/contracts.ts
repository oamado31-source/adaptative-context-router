import type { CalibrationDisposition } from '../calibration/contracts.js';

export type AdaptiveRuleAction = 'tune' | 'block';

export interface AdaptiveStrategyRule {
  strategyId: string;
  disposition: Exclude<CalibrationDisposition, 'insufficient-evidence'>;
  action: AdaptiveRuleAction;
  estimatedSavingRatio?: number;
  evidenceCases: number;
  baselineSamples: number;
  acrSamples: number;
  qualityFailures: number;
  rationale: readonly string[];
}

export interface AdaptiveRoutingProfile {
  kind: 'acr-adaptive-routing-profile';
  version: 1;
  profileId: string;
  source: 'm12-calibration';
  evidenceMode: 'measured';
  approved: true;
  createdAt: string;
  rules: readonly AdaptiveStrategyRule[];
}

export interface AdaptiveRoutingProvenance {
  profileId: string;
  profileFingerprint: string;
  appliedRules: number;
  tunedStrategies: readonly string[];
  blockedStrategies: readonly string[];
}
