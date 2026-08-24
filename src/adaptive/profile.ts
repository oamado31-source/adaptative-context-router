import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import type {
  CalibrationRecommendation,
  CalibrationReport,
} from '../calibration/contracts.js';
import type { PolicyConfig, StrategyPolicy } from '../core/policy-config.js';
import type {
  AdaptiveRoutingProfile,
  AdaptiveRoutingProvenance,
  AdaptiveStrategyRule,
} from './contracts.js';

type RuntimeStrategyPolicy = StrategyPolicy & {
  adaptiveBlockedReason?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Adaptive profile field ${key} must be a non-empty string.`);
  }
  return value;
}

function requireNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Adaptive profile field ${key} must be a finite number.`);
  }
  return value;
}

function parseRule(value: unknown): AdaptiveStrategyRule {
  if (!isRecord(value)) {
    throw new Error('Each adaptive profile rule must be an object.');
  }

  const disposition = value.disposition;
  if (disposition !== 'promote' && disposition !== 'hold' && disposition !== 'demote') {
    throw new Error(`Unsupported adaptive disposition: ${String(disposition)}`);
  }

  const action = value.action;
  if (action !== 'tune' && action !== 'block') {
    throw new Error(`Unsupported adaptive action: ${String(action)}`);
  }

  const estimatedSavingRatio =
    typeof value.estimatedSavingRatio === 'number'
      ? value.estimatedSavingRatio
      : undefined;
  if (
    estimatedSavingRatio !== undefined &&
    (!Number.isFinite(estimatedSavingRatio) ||
      estimatedSavingRatio < 0 ||
      estimatedSavingRatio > 0.9)
  ) {
    throw new Error('Adaptive estimatedSavingRatio must be between 0 and 0.9.');
  }
  if (action === 'tune' && estimatedSavingRatio === undefined) {
    throw new Error('Adaptive tune rules require estimatedSavingRatio.');
  }

  const rationale = value.rationale;
  if (!Array.isArray(rationale) || !rationale.every((item) => typeof item === 'string')) {
    throw new Error('Adaptive profile rule rationale must be an array of strings.');
  }

  return {
    strategyId: requireString(value, 'strategyId'),
    disposition,
    action,
    ...(estimatedSavingRatio !== undefined ? { estimatedSavingRatio } : {}),
    evidenceCases: requireNumber(value, 'evidenceCases'),
    baselineSamples: requireNumber(value, 'baselineSamples'),
    acrSamples: requireNumber(value, 'acrSamples'),
    qualityFailures: requireNumber(value, 'qualityFailures'),
    rationale,
  };
}

export function parseAdaptiveRoutingProfile(value: unknown): AdaptiveRoutingProfile {
  if (!isRecord(value)) {
    throw new Error('Adaptive routing profile must contain an object.');
  }
  if (value.kind !== 'acr-adaptive-routing-profile' || value.version !== 1) {
    throw new Error('Unsupported adaptive routing profile kind/version.');
  }
  if (value.source !== 'm12-calibration' || value.evidenceMode !== 'measured') {
    throw new Error('Adaptive routing profiles must originate from measured M12 calibration evidence.');
  }
  if (value.approved !== true) {
    throw new Error('Adaptive routing profile must be explicitly approved before runtime use.');
  }
  if (!Array.isArray(value.rules)) {
    throw new Error('Adaptive routing profile rules must be an array.');
  }

  const rules = value.rules.map(parseRule);
  const seen = new Set<string>();
  for (const rule of rules) {
    if (seen.has(rule.strategyId)) {
      throw new Error(`Duplicate adaptive strategy rule: ${rule.strategyId}`);
    }
    seen.add(rule.strategyId);
    if (rule.evidenceCases < 2 || rule.baselineSamples < 6 || rule.acrSamples < 6) {
      throw new Error(
        `Adaptive strategy ${rule.strategyId} does not meet the minimum measured evidence floor.`,
      );
    }
    if (rule.action === 'tune' && rule.qualityFailures > 0) {
      throw new Error(
        `Adaptive strategy ${rule.strategyId} cannot be tuned when measured quality failures exist.`,
      );
    }
  }

  return {
    kind: 'acr-adaptive-routing-profile',
    version: 1,
    profileId: requireString(value, 'profileId'),
    source: 'm12-calibration',
    evidenceMode: 'measured',
    approved: true,
    createdAt: requireString(value, 'createdAt'),
    rules,
  };
}

export async function loadAdaptiveRoutingProfile(path: string): Promise<AdaptiveRoutingProfile> {
  const raw = await readFile(path, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Adaptive routing profile must be valid JSON: ${message}`);
  }
  return parseAdaptiveRoutingProfile(parsed);
}

function recommendationToRule(
  recommendation: CalibrationRecommendation,
): AdaptiveStrategyRule | null {
  if (recommendation.disposition === 'insufficient-evidence') return null;
  if (
    recommendation.evidenceCases < 2 ||
    recommendation.baselineSamples < 6 ||
    recommendation.acrSamples < 6
  ) {
    return null;
  }

  if (recommendation.disposition === 'demote' && recommendation.qualityFailures > 0) {
    return {
      strategyId: recommendation.strategyId,
      disposition: 'demote',
      action: 'block',
      evidenceCases: recommendation.evidenceCases,
      baselineSamples: recommendation.baselineSamples,
      acrSamples: recommendation.acrSamples,
      qualityFailures: recommendation.qualityFailures,
      rationale: recommendation.rationale,
    };
  }

  const proposed = recommendation.proposedEstimatedSavingRatio;
  if (proposed === undefined || proposed < 0 || proposed > 0.9) return null;

  return {
    strategyId: recommendation.strategyId,
    disposition: recommendation.disposition,
    action: proposed === 0 && recommendation.disposition === 'demote' ? 'block' : 'tune',
    ...(proposed > 0 || recommendation.disposition !== 'demote'
      ? { estimatedSavingRatio: proposed }
      : {}),
    evidenceCases: recommendation.evidenceCases,
    baselineSamples: recommendation.baselineSamples,
    acrSamples: recommendation.acrSamples,
    qualityFailures: recommendation.qualityFailures,
    rationale: recommendation.rationale,
  };
}

export function buildAdaptiveRoutingProfile(
  report: CalibrationReport,
  profileId: string,
  approved: boolean,
  now = new Date(),
): AdaptiveRoutingProfile {
  if (!approved) {
    throw new Error('Adaptive profile creation requires explicit approval.');
  }
  if (report.measured !== true || report.policyMutation !== false) {
    throw new Error('Adaptive profile creation requires measured advisory calibration evidence.');
  }

  const rules = report.recommendations
    .map(recommendationToRule)
    .filter((rule): rule is AdaptiveStrategyRule => rule !== null);

  return parseAdaptiveRoutingProfile({
    kind: 'acr-adaptive-routing-profile',
    version: 1,
    profileId,
    source: 'm12-calibration',
    evidenceMode: 'measured',
    approved: true,
    createdAt: now.toISOString(),
    rules,
  });
}

export function fingerprintAdaptiveRoutingProfile(profile: AdaptiveRoutingProfile): string {
  return createHash('sha256').update(JSON.stringify(profile)).digest('hex');
}

export interface AdaptivePolicyApplication {
  config: PolicyConfig;
  provenance: AdaptiveRoutingProvenance;
}

function applyRuleToStrategy(
  strategy: StrategyPolicy,
  rule: AdaptiveStrategyRule,
  profileId: string,
): RuntimeStrategyPolicy {
  if (rule.action === 'block') {
    return {
      ...strategy,
      adaptiveBlockedReason:
        `Adaptive profile ${profileId} blocked ${strategy.id} from measured evidence (${rule.disposition}; quality failures: ${rule.qualityFailures}).`,
      reasons: [
        ...strategy.reasons,
        `Adaptive profile ${profileId}: measured evidence marked this strategy as blocked.`,
      ],
    };
  }

  return {
    ...strategy,
    estimatedSavingRatio: rule.estimatedSavingRatio ?? strategy.estimatedSavingRatio,
    reasons: [
      ...strategy.reasons,
      `Adaptive profile ${profileId}: measured estimated saving ${(rule.estimatedSavingRatio ?? strategy.estimatedSavingRatio) * 100}% (${rule.disposition}).`,
    ],
  };
}

export function applyAdaptiveRoutingProfile(
  config: PolicyConfig,
  profile: AdaptiveRoutingProfile,
): AdaptivePolicyApplication {
  const rules = new Map(profile.rules.map((rule) => [rule.strategyId, rule]));
  const known = new Set(config.strategies.map((strategy) => strategy.id));
  for (const strategyId of rules.keys()) {
    if (!known.has(strategyId)) {
      throw new Error(`Adaptive profile references unknown policy strategy: ${strategyId}`);
    }
  }

  const tunedStrategies: string[] = [];
  const blockedStrategies: string[] = [];
  const strategies: readonly StrategyPolicy[] = config.strategies.map((strategy) => {
    const rule = rules.get(strategy.id);
    if (!rule) return strategy;
    if (rule.action === 'block') blockedStrategies.push(strategy.id);
    else tunedStrategies.push(strategy.id);
    return applyRuleToStrategy(strategy, rule, profile.profileId);
  });

  return {
    config: { ...config, strategies },
    provenance: {
      profileId: profile.profileId,
      profileFingerprint: fingerprintAdaptiveRoutingProfile(profile),
      appliedRules: profile.rules.length,
      tunedStrategies,
      blockedStrategies,
    },
  };
}
