import { describe, expect, it } from 'vitest';

import {
  applyAdaptiveRoutingProfile,
  buildAdaptiveRoutingProfile,
  fingerprintAdaptiveRoutingProfile,
  parseAdaptiveRoutingProfile,
} from '../src/adaptive/profile.js';
import type {
  CalibrationRecommendation,
  CalibrationReport,
} from '../src/calibration/contracts.js';
import type { Capability, TaskProfile } from '../src/core/contracts.js';
import { loadPolicyConfig } from '../src/core/policy-config.js';
import { PolicyEngine } from '../src/core/policy-engine.js';

function recommendation(
  strategyId: string,
  disposition: CalibrationRecommendation['disposition'],
  proposedEstimatedSavingRatio?: number,
  qualityFailures = 0,
): CalibrationRecommendation {
  return {
    strategyId,
    disposition,
    evidenceCases: 2,
    baselineSamples: 6,
    acrSamples: 6,
    qualityFailures,
    meanTotalTokenReductionRatio: proposedEstimatedSavingRatio ?? 0,
    meanLatencyReductionRatio: 0.1,
    currentEstimatedSavingRatio: 0.62,
    ...(proposedEstimatedSavingRatio !== undefined
      ? { proposedEstimatedSavingRatio }
      : {}),
    policyMutation: false,
    rationale: [`Synthetic ${disposition} recommendation for M13 regression testing.`],
  };
}

function report(
  recommendations: readonly CalibrationRecommendation[],
): CalibrationReport {
  return {
    measured: true,
    policyMutation: false,
    comparisons: [],
    recommendations,
    skippedCases: [],
    thresholds: {
      minimumCasesPerStrategy: 2,
      minimumSamplesPerArmPerCase: 3,
      minimumPromoteTokenReductionRatio: 0.05,
      maximumEstimatedSavingRatio: 0.9,
    },
  };
}

function task(
  precision: TaskProfile['precision'] = 'semantic',
): TaskProfile {
  return {
    taskType: 'targeted_code_search',
    precision,
    risk: precision === 'secret-sensitive' ? 'critical' : 'low',
    confidence: 0.95,
    requiresExactIdentifiers: precision === 'exact' || precision === 'secret-sensitive',
  };
}

const serenaAvailable: readonly Capability[] = [
  {
    id: 'serena',
    name: 'Serena',
    status: 'available',
  },
];

describe('adaptive routing profiles', () => {
  it('requires explicit approval before a profile can be created or loaded', () => {
    expect(() =>
      buildAdaptiveRoutingProfile(
        report([recommendation('serena', 'promote', 0.25)]),
        'test-profile',
        false,
      ),
    ).toThrow(/explicit approval/i);

    expect(() =>
      parseAdaptiveRoutingProfile({
        kind: 'acr-adaptive-routing-profile',
        version: 1,
        profileId: 'unapproved',
        source: 'm12-calibration',
        evidenceMode: 'measured',
        approved: false,
        createdAt: '2026-08-24T00:00:00.000Z',
        rules: [],
      }),
    ).toThrow(/explicitly approved/i);
  });

  it('turns measured promote evidence into a runtime-only tune rule and skips hold evidence', () => {
    const profile = buildAdaptiveRoutingProfile(
      report([
        recommendation('serena', 'promote', 0.25),
        recommendation('rtk', 'hold'),
      ]),
      'measured-tune',
      true,
      new Date('2026-08-24T00:00:00.000Z'),
    );

    expect(profile.rules).toHaveLength(1);
    expect(profile.rules[0]).toMatchObject({
      strategyId: 'serena',
      disposition: 'promote',
      action: 'tune',
      estimatedSavingRatio: 0.25,
    });
  });

  it('turns measured quality regression into a hard adaptive block', () => {
    const profile = buildAdaptiveRoutingProfile(
      report([recommendation('serena', 'demote', 0.45, 1)]),
      'quality-block',
      true,
      new Date('2026-08-24T00:00:00.000Z'),
    );

    expect(profile.rules[0]).toMatchObject({
      strategyId: 'serena',
      disposition: 'demote',
      action: 'block',
      qualityFailures: 1,
    });
  });

  it('applies tuning immutably and records deterministic provenance', async () => {
    const base = await loadPolicyConfig();
    const originalSerena = base.strategies.find((item) => item.id === 'serena');
    expect(originalSerena?.estimatedSavingRatio).toBe(0.62);

    const profile = buildAdaptiveRoutingProfile(
      report([recommendation('serena', 'promote', 0.25)]),
      'tune-serena',
      true,
      new Date('2026-08-24T00:00:00.000Z'),
    );
    const applied = applyAdaptiveRoutingProfile(base, profile);

    expect(base.strategies.find((item) => item.id === 'serena')?.estimatedSavingRatio).toBe(0.62);
    expect(applied.config.strategies.find((item) => item.id === 'serena')?.estimatedSavingRatio).toBe(0.25);
    expect(applied.provenance).toMatchObject({
      profileId: 'tune-serena',
      appliedRules: 1,
      tunedStrategies: ['serena'],
      blockedStrategies: [],
    });
    expect(applied.provenance.profileFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprintAdaptiveRoutingProfile(profile)).toBe(
      applied.provenance.profileFingerprint,
    );
  });

  it('prevents a quality-blocked strategy from being selected regardless of utility', async () => {
    const base = await loadPolicyConfig();
    const profile = buildAdaptiveRoutingProfile(
      report([recommendation('serena', 'demote', 0.45, 1)]),
      'block-serena',
      true,
      new Date('2026-08-24T00:00:00.000Z'),
    );
    const applied = applyAdaptiveRoutingProfile(base, profile);
    const decision = new PolicyEngine(applied.config).evaluate({
      task: task(),
      context: {
        estimatedTokens: 122_000,
        contextWindowTokens: 200_000,
        utilizationRatio: 0.61,
        source: 'estimated',
      },
      capabilities: serenaAvailable,
      mode: 'guarded',
    });

    expect(decision.selected?.id).not.toBe('serena');
    const rejectedSerena = decision.rejected.find((item) => item.id === 'serena');
    expect(rejectedSerena?.blocked).toBe(true);
    expect(rejectedSerena?.reasons.join(' ')).toMatch(/adaptive profile block-serena blocked serena/i);
  });

  it('preserves secret-sensitive NO_OPTIMIZATION even when an approved profile promotes a strategy', async () => {
    const base = await loadPolicyConfig();
    const profile = buildAdaptiveRoutingProfile(
      report([recommendation('serena', 'promote', 0.9)]),
      'high-saving-serena',
      true,
      new Date('2026-08-24T00:00:00.000Z'),
    );
    const applied = applyAdaptiveRoutingProfile(base, profile);
    const decision = new PolicyEngine(applied.config).evaluate({
      task: task('secret-sensitive'),
      context: {
        estimatedTokens: 150_000,
        contextWindowTokens: 200_000,
        utilizationRatio: 0.75,
        source: 'estimated',
      },
      capabilities: serenaAvailable,
      mode: 'auto',
    });

    expect(decision.selected).toBeNull();
    expect(decision.rationale.join(' ')).toMatch(/secret-sensitive/i);
  });

  it('rejects unknown strategies rather than guessing or extending the base policy', async () => {
    const base = await loadPolicyConfig();
    const profile = parseAdaptiveRoutingProfile({
      kind: 'acr-adaptive-routing-profile',
      version: 1,
      profileId: 'unknown-strategy',
      source: 'm12-calibration',
      evidenceMode: 'measured',
      approved: true,
      createdAt: '2026-08-24T00:00:00.000Z',
      rules: [
        {
          strategyId: 'imaginary-optimizer',
          disposition: 'promote',
          action: 'tune',
          estimatedSavingRatio: 0.5,
          evidenceCases: 2,
          baselineSamples: 6,
          acrSamples: 6,
          qualityFailures: 0,
          rationale: ['Synthetic unknown strategy.'],
        },
      ],
    });

    expect(() => applyAdaptiveRoutingProfile(base, profile)).toThrow(/unknown policy strategy/i);
  });

  it('rejects adaptive tune rules that carry measured quality failures', () => {
    expect(() =>
      parseAdaptiveRoutingProfile({
        kind: 'acr-adaptive-routing-profile',
        version: 1,
        profileId: 'unsafe-tune',
        source: 'm12-calibration',
        evidenceMode: 'measured',
        approved: true,
        createdAt: '2026-08-24T00:00:00.000Z',
        rules: [
          {
            strategyId: 'serena',
            disposition: 'demote',
            action: 'tune',
            estimatedSavingRatio: 0.4,
            evidenceCases: 2,
            baselineSamples: 6,
            acrSamples: 6,
            qualityFailures: 1,
            rationale: ['Unsafe synthetic profile.'],
          },
        ],
      }),
    ).toThrow(/quality failures/i);
  });
});
