import { describe, expect, it } from 'vitest';

import {
  buildBenchmarkCampaign,
  type BenchmarkCampaign,
} from '../src/benchmark/campaign.js';
import { loadBenchmarkCorpus } from '../src/benchmark/corpus.js';
import {
  assembleBenchmarkInput,
  createBenchmarkEvidenceLedger,
  recordBenchmarkEvidence,
} from '../src/benchmark/evidence.js';
import { compareBenchmark } from '../src/benchmark/harness.js';
import type {
  BenchmarkInput,
  BenchmarkObservation,
} from '../src/benchmark/contracts.js';
import { parseClaudeCodeJson } from '../src/measurement/claude-code-json.js';

async function realCampaign(): Promise<BenchmarkCampaign> {
  const corpus = await loadBenchmarkCorpus('benchmarks/corpus/real-v1.json');
  return buildBenchmarkCampaign(corpus, {
    model: 'claude-test-pinned',
    availableCapabilities: ['serena'],
  });
}

function providerResult(inputTokens: number, outputTokens = 100) {
  return parseClaudeCodeJson({
    type: 'result',
    subtype: 'success',
    is_error: false,
    duration_ms: 1200,
    duration_api_ms: 1000,
    num_turns: 2,
    result: 'RAW_PROVIDER_RESULT_MUST_NOT_BE_PERSISTED',
    session_id: 'raw-provider-session-secret',
    total_cost_usd: 0.031,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_read_input_tokens: 40,
      cache_creation_input_tokens: 10,
    },
  });
}

function observation(
  arm: BenchmarkObservation['arm'],
  inputTokens: number,
  qualityScore: number,
): BenchmarkObservation {
  return {
    arm,
    source: 'measured',
    inputTokens,
    outputTokens: 100,
    latencyMs: 1000,
    success: true,
    qualityScore,
  };
}

describe('real benchmark campaign', () => {
  it('plans only capability-ready cases with pinned model and alternating A/B order', async () => {
    const campaign = await realCampaign();
    const ready = campaign.cases.filter((item) => item.status === 'ready');
    const blocked = campaign.cases.filter((item) => item.status === 'blocked');

    expect(ready).toHaveLength(4);
    expect(blocked).toHaveLength(2);
    expect(blocked.map((item) => item.missingCapabilities)).toEqual([
      ['pxpipe'],
      ['token-optimizer'],
    ]);
    expect(campaign.runs).toHaveLength(24);
    expect(campaign.externalExecution).toBe(false);
    expect(new Set(campaign.runs.map((run) => run.model))).toEqual(
      new Set(['claude-test-pinned']),
    );
    expect(campaign.runs.slice(0, 6).map((run) => run.arm)).toEqual([
      'baseline',
      'acr',
      'acr',
      'baseline',
      'baseline',
      'acr',
    ]);
  });

  it('records sanitized provider usage, rejects duplicates, and keeps client cost estimated', async () => {
    const campaign = await realCampaign();
    const run = campaign.runs[0];
    expect(run).toBeDefined();
    if (!run) return;

    const measurement = providerResult(1000);
    const ledger = recordBenchmarkEvidence(
      campaign,
      createBenchmarkEvidenceLedger(campaign),
      run.id,
      measurement,
      0.98,
    );
    const serialized = JSON.stringify(ledger);

    expect(serialized).not.toContain('RAW_PROVIDER_RESULT_MUST_NOT_BE_PERSISTED');
    expect(serialized).not.toContain('raw-provider-session-secret');
    expect(ledger.records[0]).toMatchObject({
      measured: true,
      estimatedCostUsd: 0.031,
      costProvenance: 'claude-code-client-estimate',
      model: 'claude-test-pinned',
      modelProvenance: 'campaign-pinned',
      qualityScore: 0.98,
    });
    expect(ledger.records[0]?.sessionFingerprint).toMatch(/^[0-9a-f]{64}$/u);
    expect(() =>
      recordBenchmarkEvidence(campaign, ledger, run.id, measurement, 0.98),
    ).toThrow(/already has recorded evidence/u);
  });

  it('refuses to assemble incomplete or capability-blocked cases', async () => {
    const campaign = await realCampaign();
    const ledger = createBenchmarkEvidenceLedger(campaign);

    expect(() =>
      assembleBenchmarkInput(campaign, ledger, 'acr-symbol-classifier-profile'),
    ).toThrow(/incomplete/u);
    expect(() =>
      assembleBenchmarkInput(campaign, ledger, 'acr-semantic-architecture-synthesis'),
    ).toThrow(/blocked/u);
  });

  it('assembles exactly three measured samples per arm without promoting estimated cost', async () => {
    const campaign = await realCampaign();
    const caseId = 'acr-symbol-classifier-profile';
    let ledger = createBenchmarkEvidenceLedger(campaign);

    for (const run of campaign.runs.filter((item) => item.caseId === caseId)) {
      ledger = recordBenchmarkEvidence(
        campaign,
        ledger,
        run.id,
        providerResult(run.arm === 'baseline' ? 1000 : 800),
        0.98,
      );
    }

    const benchmark = assembleBenchmarkInput(campaign, ledger, caseId);
    expect(benchmark.case.strategy).toBe('serena');
    expect(benchmark.case.minimumQualityScore).toBe(0.95);
    expect(benchmark.baseline).toHaveLength(3);
    expect(benchmark.acr).toHaveLength(3);
    expect(
      [...benchmark.baseline, ...benchmark.acr].every(
        (item) => !('costUsd' in item),
      ),
    ).toBe(true);
    expect(compareBenchmark(benchmark).outcome).toBe('acr-better');
  });

  it('keeps NO_OPTIMIZATION cases as controls without a strategy label', async () => {
    const campaign = await realCampaign();
    const caseId = 'acr-exact-release-identity';
    let ledger = createBenchmarkEvidenceLedger(campaign);

    for (const run of campaign.runs.filter((item) => item.caseId === caseId)) {
      ledger = recordBenchmarkEvidence(
        campaign,
        ledger,
        run.id,
        providerResult(700),
        1,
      );
    }

    const benchmark = assembleBenchmarkInput(campaign, ledger, caseId);
    expect(benchmark.case.strategy).toBeUndefined();
    expect(benchmark.case.minimumQualityScore).toBe(1);
  });
});

describe('absolute benchmark quality floor', () => {
  it('rejects an experiment whose baseline itself misses the corpus minimum', () => {
    const input: BenchmarkInput = {
      case: {
        id: 'invalid-baseline',
        taskType: 'targeted_code_search',
        minimumQualityScore: 0.95,
      },
      baseline: [
        observation('baseline', 1000, 0.9),
        observation('baseline', 1000, 0.9),
        observation('baseline', 1000, 0.9),
      ],
      acr: [
        observation('acr', 700, 0.96),
        observation('acr', 700, 0.96),
        observation('acr', 700, 0.96),
      ],
    };

    expect(() => compareBenchmark(input)).toThrow(/not valid evidence/u);
  });

  it('marks quality regression when ACR saves tokens but misses the absolute floor', () => {
    const input: BenchmarkInput = {
      case: {
        id: 'absolute-floor-regression',
        taskType: 'targeted_code_search',
        qualityTolerance: 0.1,
        minimumQualityScore: 0.95,
      },
      baseline: [
        observation('baseline', 1000, 0.98),
        observation('baseline', 1000, 0.98),
        observation('baseline', 1000, 0.98),
      ],
      acr: [
        observation('acr', 500, 0.94),
        observation('acr', 500, 0.94),
        observation('acr', 500, 0.94),
      ],
    };

    const comparison = compareBenchmark(input);
    expect(comparison.deltas.totalTokenReductionRatio).toBeGreaterThan(0);
    expect(comparison.qualityGate).toMatchObject({
      absoluteMinimum: 0.95,
      minimumAcceptedQuality: 0.95,
      passed: false,
    });
    expect(comparison.outcome).toBe('quality-regression');
  });
});
