import { readFile } from 'node:fs/promises';

import type { ProviderMeasurement } from '../measurement/contracts.js';
import type {
  BenchmarkCampaign,
  BenchmarkCampaignRun,
} from './campaign.js';
import type {
  BenchmarkInput,
  BenchmarkObservation,
} from './contracts.js';

export interface BenchmarkEvidenceRecord {
  runId: string;
  caseId: string;
  arm: BenchmarkCampaignRun['arm'];
  repetition: number;
  provider: 'claude-code';
  providerSource: 'claude-code-json';
  measured: true;
  model: string;
  modelProvenance: 'campaign-pinned';
  targetRevision: string;
  taskFingerprint: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  latencyMs: number;
  apiLatencyMs?: number;
  estimatedCostUsd?: number;
  costProvenance: ProviderMeasurement['costProvenance'];
  success: boolean;
  turns?: number;
  sessionFingerprint?: string;
  qualityScore: number;
}

export interface BenchmarkEvidenceLedger {
  schemaVersion: 1;
  campaignId: string;
  evidenceMode: 'real';
  records: readonly BenchmarkEvidenceRecord[];
}

export function createBenchmarkEvidenceLedger(
  campaign: BenchmarkCampaign,
): BenchmarkEvidenceLedger {
  return {
    schemaVersion: 1,
    campaignId: campaign.id,
    evidenceMode: 'real',
    records: [],
  };
}

function assertQualityScore(score: number): void {
  if (!Number.isFinite(score) || score < 0 || score > 1) {
    throw new Error('qualityScore must be between 0 and 1.');
  }
}

function assertLedgerMatchesCampaign(
  campaign: BenchmarkCampaign,
  ledger: BenchmarkEvidenceLedger,
): void {
  if (ledger.campaignId !== campaign.id) {
    throw new Error(
      `Evidence ledger campaign ${ledger.campaignId} does not match ${campaign.id}.`,
    );
  }
}

function plannedRun(
  campaign: BenchmarkCampaign,
  runId: string,
): BenchmarkCampaignRun {
  const run = campaign.runs.find((item) => item.id === runId);
  if (!run) throw new Error(`Campaign run ${runId} was not found.`);
  return run;
}

export function recordBenchmarkEvidence(
  campaign: BenchmarkCampaign,
  ledger: BenchmarkEvidenceLedger,
  runId: string,
  measurement: ProviderMeasurement,
  qualityScore: number,
): BenchmarkEvidenceLedger {
  assertLedgerMatchesCampaign(campaign, ledger);
  assertQualityScore(qualityScore);
  if (ledger.records.some((record) => record.runId === runId)) {
    throw new Error(`Campaign run ${runId} already has recorded evidence.`);
  }
  if (
    measurement.measured !== true ||
    measurement.provider !== 'claude-code' ||
    measurement.source !== 'claude-code-json'
  ) {
    throw new Error('Campaign evidence must be measured Claude Code JSON usage.');
  }

  const run = plannedRun(campaign, runId);
  const record: BenchmarkEvidenceRecord = {
    runId: run.id,
    caseId: run.caseId,
    arm: run.arm,
    repetition: run.repetition,
    provider: 'claude-code',
    providerSource: 'claude-code-json',
    measured: true,
    model: campaign.model,
    modelProvenance: 'campaign-pinned',
    targetRevision: campaign.target.revision,
    taskFingerprint: run.taskFingerprint,
    inputTokens: measurement.inputTokens,
    outputTokens: measurement.outputTokens,
    cacheReadTokens: measurement.cacheReadTokens,
    cacheWriteTokens: measurement.cacheWriteTokens,
    latencyMs: measurement.latencyMs,
    ...(measurement.apiLatencyMs === undefined
      ? {}
      : { apiLatencyMs: measurement.apiLatencyMs }),
    ...(measurement.estimatedCostUsd === undefined
      ? {}
      : { estimatedCostUsd: measurement.estimatedCostUsd }),
    costProvenance: measurement.costProvenance,
    success: measurement.success,
    ...(measurement.turns === undefined ? {} : { turns: measurement.turns }),
    ...(measurement.sessionFingerprint === undefined
      ? {}
      : { sessionFingerprint: measurement.sessionFingerprint }),
    qualityScore,
  };

  return {
    ...ledger,
    records: [...ledger.records, record],
  };
}

function observationFromEvidence(
  record: BenchmarkEvidenceRecord,
): BenchmarkObservation {
  return {
    arm: record.arm,
    source: 'measured',
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
    cacheReadTokens: record.cacheReadTokens,
    cacheWriteTokens: record.cacheWriteTokens,
    latencyMs: record.latencyMs,
    success: record.success,
    qualityScore: record.qualityScore,
  };
}

export function assembleBenchmarkInput(
  campaign: BenchmarkCampaign,
  ledger: BenchmarkEvidenceLedger,
  caseId: string,
): BenchmarkInput {
  assertLedgerMatchesCampaign(campaign, ledger);
  const campaignCase = campaign.cases.find((item) => item.id === caseId);
  if (!campaignCase) throw new Error(`Campaign case ${caseId} was not found.`);
  if (campaignCase.status !== 'ready') {
    throw new Error(
      `Campaign case ${caseId} is blocked by missing capabilities: ${campaignCase.missingCapabilities.join(', ')}.`,
    );
  }

  const runs = campaign.runs.filter((run) => run.caseId === caseId);
  const evidenceByRun = new Map(
    ledger.records.map((record) => [record.runId, record] as const),
  );
  const missingRuns = runs.filter((run) => !evidenceByRun.has(run.id));
  if (missingRuns.length > 0) {
    throw new Error(
      `Campaign case ${caseId} is incomplete; missing evidence for ${missingRuns.map((run) => run.id).join(', ')}.`,
    );
  }

  const records = runs.map((run) => {
    const record = evidenceByRun.get(run.id);
    if (!record) throw new Error(`Evidence for ${run.id} was not found.`);
    if (
      record.caseId !== run.caseId ||
      record.arm !== run.arm ||
      record.repetition !== run.repetition ||
      record.model !== campaign.model ||
      record.targetRevision !== campaign.target.revision ||
      record.taskFingerprint !== run.taskFingerprint
    ) {
      throw new Error(`Evidence for ${run.id} violates campaign provenance.`);
    }
    return record;
  });

  const baseline = records
    .filter((record) => record.arm === 'baseline')
    .sort((left, right) => left.repetition - right.repetition)
    .map(observationFromEvidence);
  const acr = records
    .filter((record) => record.arm === 'acr')
    .sort((left, right) => left.repetition - right.repetition)
    .map(observationFromEvidence);

  if (
    baseline.length !== campaign.controls.repetitionsPerArm ||
    acr.length !== campaign.controls.repetitionsPerArm
  ) {
    throw new Error(
      `Campaign case ${caseId} must contain exactly ${campaign.controls.repetitionsPerArm} measured observations per arm.`,
    );
  }

  return {
    case: {
      id: campaignCase.id,
      taskType: campaignCase.taskType,
      ...(campaignCase.expectedStrategy === 'NO_OPTIMIZATION'
        ? {}
        : { strategy: campaignCase.expectedStrategy }),
      taskFingerprint: campaignCase.taskFingerprint,
      minimumQualityScore: campaignCase.quality.minimumScore,
      notes: `M14 real campaign ${campaign.id}; model ${campaign.model}; target ${campaign.target.revision}. Provider client cost estimates are intentionally excluded from measured benchmark cost.`,
    },
    baseline,
    acr,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function requiredNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite non-negative number.`);
  }
  return value;
}

function optionalNumber(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  return requiredNumber(value, label);
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, label);
}

function parseEvidenceRecord(
  value: unknown,
  index: number,
): BenchmarkEvidenceRecord {
  const prefix = `evidence.records[${index}]`;
  if (!isRecord(value)) throw new Error(`${prefix} must be an object.`);
  if (value.arm !== 'baseline' && value.arm !== 'acr') {
    throw new Error(`${prefix}.arm must be baseline or acr.`);
  }
  if (
    value.provider !== 'claude-code' ||
    value.providerSource !== 'claude-code-json' ||
    value.measured !== true ||
    value.modelProvenance !== 'campaign-pinned'
  ) {
    throw new Error(`${prefix} has invalid evidence provenance.`);
  }
  if (
    value.costProvenance !== 'claude-code-client-estimate' &&
    value.costProvenance !== 'unavailable'
  ) {
    throw new Error(`${prefix}.costProvenance is invalid.`);
  }
  if (typeof value.success !== 'boolean') {
    throw new Error(`${prefix}.success must be boolean.`);
  }
  const repetition = requiredNumber(value.repetition, `${prefix}.repetition`);
  if (!Number.isInteger(repetition) || repetition < 1) {
    throw new Error(`${prefix}.repetition must be a positive integer.`);
  }
  const qualityScore = requiredNumber(value.qualityScore, `${prefix}.qualityScore`);
  assertQualityScore(qualityScore);

  return {
    runId: requiredString(value.runId, `${prefix}.runId`),
    caseId: requiredString(value.caseId, `${prefix}.caseId`),
    arm: value.arm,
    repetition,
    provider: 'claude-code',
    providerSource: 'claude-code-json',
    measured: true,
    model: requiredString(value.model, `${prefix}.model`),
    modelProvenance: 'campaign-pinned',
    targetRevision: requiredString(
      value.targetRevision,
      `${prefix}.targetRevision`,
    ),
    taskFingerprint: requiredString(
      value.taskFingerprint,
      `${prefix}.taskFingerprint`,
    ),
    inputTokens: requiredNumber(value.inputTokens, `${prefix}.inputTokens`),
    outputTokens: requiredNumber(value.outputTokens, `${prefix}.outputTokens`),
    cacheReadTokens: requiredNumber(
      value.cacheReadTokens,
      `${prefix}.cacheReadTokens`,
    ),
    cacheWriteTokens: requiredNumber(
      value.cacheWriteTokens,
      `${prefix}.cacheWriteTokens`,
    ),
    latencyMs: requiredNumber(value.latencyMs, `${prefix}.latencyMs`),
    ...(optionalNumber(value.apiLatencyMs, `${prefix}.apiLatencyMs`) === undefined
      ? {}
      : { apiLatencyMs: value.apiLatencyMs as number }),
    ...(optionalNumber(
      value.estimatedCostUsd,
      `${prefix}.estimatedCostUsd`,
    ) === undefined
      ? {}
      : { estimatedCostUsd: value.estimatedCostUsd as number }),
    costProvenance: value.costProvenance,
    success: value.success,
    ...(optionalNumber(value.turns, `${prefix}.turns`) === undefined
      ? {}
      : { turns: value.turns as number }),
    ...(optionalString(
      value.sessionFingerprint,
      `${prefix}.sessionFingerprint`,
    ) === undefined
      ? {}
      : { sessionFingerprint: value.sessionFingerprint as string }),
    qualityScore,
  };
}

export function parseBenchmarkEvidenceLedger(
  value: unknown,
): BenchmarkEvidenceLedger {
  if (!isRecord(value)) throw new Error('evidence ledger must be an object.');
  if (
    value.schemaVersion !== 1 ||
    value.evidenceMode !== 'real' ||
    !Array.isArray(value.records)
  ) {
    throw new Error('evidence ledger does not match schema version 1 real evidence.');
  }
  const records = value.records.map(parseEvidenceRecord);
  if (new Set(records.map((record) => record.runId)).size !== records.length) {
    throw new Error('evidence ledger contains duplicate run IDs.');
  }
  return {
    schemaVersion: 1,
    campaignId: requiredString(value.campaignId, 'evidence.campaignId'),
    evidenceMode: 'real',
    records,
  };
}

export async function loadBenchmarkEvidenceLedger(
  path: string,
): Promise<BenchmarkEvidenceLedger> {
  const raw = await readFile(path, 'utf8');
  return parseBenchmarkEvidenceLedger(JSON.parse(raw) as unknown);
}
