import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { parseClaudeCodeJsonText } from '../measurement/claude-code-json.js';
import type { ProviderMeasurement } from '../measurement/contracts.js';
import type {
  BenchmarkArm,
  BenchmarkInput,
  BenchmarkObservation,
} from './contracts.js';
import {
  parseBenchmarkCorpus,
  type BenchmarkCorpusCase,
  type BenchmarkCorpusControls,
  type BenchmarkCorpusManifest,
  type BenchmarkCorpusTarget,
} from './corpus.js';

export type BenchmarkExperimentProtocol =
  | 'direct-provider'
  | 'acr-guided'
  | 'acr-no-optimization-control';

export interface BenchmarkExperimentRecord {
  provider: 'claude-code';
  source: 'claude-code-json';
  measured: true;
  measurement: ProviderMeasurement;
  qualityScore: number;
  qualitySource: 'blinded-rubric';
  reviewBlinded: true;
  resultFingerprint: string;
}

export interface BenchmarkExperimentSlot {
  id: string;
  sequence: number;
  repetition: number;
  arm: BenchmarkArm;
  protocol: BenchmarkExperimentProtocol;
  plannedStrategy: string;
  status: 'pending' | 'recorded';
  record?: BenchmarkExperimentRecord;
}

export interface BenchmarkExperimentPlan {
  schemaVersion: 1;
  id: string;
  evidenceMode: 'real';
  execution: false;
  provider: 'claude-code';
  model: string;
  modelProvenance: 'operator-pinned';
  corpusId: string;
  target: BenchmarkCorpusTarget;
  controls: BenchmarkCorpusControls;
  case: BenchmarkCorpusCase;
  promptFingerprint: string;
  qualityRubricFingerprint: string;
  slots: readonly BenchmarkExperimentSlot[];
}

export interface BenchmarkExperimentSummary {
  id: string;
  evidenceMode: 'real';
  execution: false;
  caseId: string;
  model: string;
  targetRevision: string;
  expectedStrategy: string;
  repetitionsPerArm: number;
  totalSlots: number;
  recordedSlots: number;
  pendingSlots: number;
  nextSlot?: {
    id: string;
    sequence: number;
    repetition: number;
    arm: BenchmarkArm;
    protocol: BenchmarkExperimentProtocol;
    plannedStrategy: string;
  };
}

function fingerprint(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableQualityFingerprint(benchmarkCase: BenchmarkCorpusCase): string {
  return fingerprint(
    JSON.stringify({
      minimumScore: benchmarkCase.quality.minimumScore,
      assertions: [...benchmarkCase.quality.assertions],
    }),
  );
}

function experimentId(
  corpus: BenchmarkCorpusManifest,
  benchmarkCase: BenchmarkCorpusCase,
  model: string,
): string {
  const suffix = fingerprint(
    `${corpus.id}\n${benchmarkCase.id}\n${corpus.target.revision}\n${model}`,
  ).slice(0, 12);
  return `${corpus.id}:${benchmarkCase.id}:${suffix}`;
}

function protocolFor(
  arm: BenchmarkArm,
  expectedStrategy: string,
): BenchmarkExperimentProtocol {
  if (arm === 'baseline') return 'direct-provider';
  return expectedStrategy === 'NO_OPTIMIZATION'
    ? 'acr-no-optimization-control'
    : 'acr-guided';
}

function plannedStrategyFor(arm: BenchmarkArm, expectedStrategy: string): string {
  return arm === 'baseline' ? 'baseline' : expectedStrategy;
}

function buildSlots(
  benchmarkCase: BenchmarkCorpusCase,
  controls: BenchmarkCorpusControls,
): readonly BenchmarkExperimentSlot[] {
  const slots: BenchmarkExperimentSlot[] = [];
  let sequence = 1;

  for (let repetition = 1; repetition <= controls.repetitionsPerArm; repetition += 1) {
    const arms: readonly BenchmarkArm[] =
      repetition % 2 === 1 ? ['baseline', 'acr'] : ['acr', 'baseline'];

    for (const arm of arms) {
      slots.push({
        id: `${benchmarkCase.id}:r${repetition}:${arm}`,
        sequence,
        repetition,
        arm,
        protocol: protocolFor(arm, benchmarkCase.expectedStrategy),
        plannedStrategy: plannedStrategyFor(arm, benchmarkCase.expectedStrategy),
        status: 'pending',
      });
      sequence += 1;
    }
  }

  return slots;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`);
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function requireFiniteNonNegative(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite non-negative number.`);
  }
  return value;
}

function requireQualityScore(value: unknown, label: string): number {
  const score = requireFiniteNonNegative(value, label);
  if (score > 1) throw new Error(`${label} must be between 0 and 1.`);
  return score;
}

function requireInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be an integer >= 1.`);
  }
  return value;
}

function requireFingerprint(value: unknown, label: string): string {
  const text = requireString(value, label);
  if (!/^[0-9a-f]{64}$/u.test(text)) {
    throw new Error(`${label} must be a SHA-256 hex fingerprint.`);
  }
  return text;
}

function parseNormalizedMeasurement(value: unknown): ProviderMeasurement {
  const record = requireRecord(value, 'experiment slot measurement');
  if (record.provider !== 'claude-code') {
    throw new Error('experiment slot measurement.provider must be claude-code.');
  }
  if (record.source !== 'claude-code-json') {
    throw new Error('experiment slot measurement.source must be claude-code-json.');
  }
  if (record.measured !== true) {
    throw new Error('experiment slot measurement.measured must be true.');
  }
  if (record.tokenProvenance !== 'provider-reported') {
    throw new Error('experiment slot token provenance must be provider-reported.');
  }
  if (record.latencyProvenance !== 'provider-reported') {
    throw new Error('experiment slot latency provenance must be provider-reported.');
  }
  if (
    record.costProvenance !== 'claude-code-client-estimate' &&
    record.costProvenance !== 'unavailable'
  ) {
    throw new Error('experiment slot cost provenance is invalid.');
  }
  if (typeof record.success !== 'boolean') {
    throw new Error('experiment slot measurement.success must be boolean.');
  }

  const sessionFingerprint = requireFingerprint(
    record.sessionFingerprint,
    'experiment slot measurement.sessionFingerprint',
  );
  const apiLatencyMs =
    record.apiLatencyMs === undefined
      ? undefined
      : requireFiniteNonNegative(record.apiLatencyMs, 'experiment slot measurement.apiLatencyMs');
  const estimatedCostUsd =
    record.estimatedCostUsd === undefined
      ? undefined
      : requireFiniteNonNegative(
          record.estimatedCostUsd,
          'experiment slot measurement.estimatedCostUsd',
        );
  const turns =
    record.turns === undefined
      ? undefined
      : requireInteger(record.turns, 'experiment slot measurement.turns');

  return {
    provider: 'claude-code',
    source: 'claude-code-json',
    measured: true,
    inputTokens: requireFiniteNonNegative(
      record.inputTokens,
      'experiment slot measurement.inputTokens',
    ),
    outputTokens: requireFiniteNonNegative(
      record.outputTokens,
      'experiment slot measurement.outputTokens',
    ),
    cacheReadTokens: requireFiniteNonNegative(
      record.cacheReadTokens,
      'experiment slot measurement.cacheReadTokens',
    ),
    cacheWriteTokens: requireFiniteNonNegative(
      record.cacheWriteTokens,
      'experiment slot measurement.cacheWriteTokens',
    ),
    latencyMs: requireFiniteNonNegative(
      record.latencyMs,
      'experiment slot measurement.latencyMs',
    ),
    ...(apiLatencyMs === undefined ? {} : { apiLatencyMs }),
    ...(estimatedCostUsd === undefined ? {} : { estimatedCostUsd }),
    tokenProvenance: 'provider-reported',
    latencyProvenance: 'provider-reported',
    costProvenance: record.costProvenance,
    success: record.success,
    ...(turns === undefined ? {} : { turns }),
    sessionFingerprint,
  };
}

function parseExperimentRecord(value: unknown): BenchmarkExperimentRecord {
  const record = requireRecord(value, 'experiment slot record');
  if (record.provider !== 'claude-code' || record.source !== 'claude-code-json') {
    throw new Error('experiment slot record must use Claude Code JSON evidence.');
  }
  if (record.measured !== true) {
    throw new Error('experiment slot record.measured must be true.');
  }
  if (record.qualitySource !== 'blinded-rubric' || record.reviewBlinded !== true) {
    throw new Error('experiment slot quality must come from a blinded rubric review.');
  }

  return {
    provider: 'claude-code',
    source: 'claude-code-json',
    measured: true,
    measurement: parseNormalizedMeasurement(record.measurement),
    qualityScore: requireQualityScore(
      record.qualityScore,
      'experiment slot record.qualityScore',
    ),
    qualitySource: 'blinded-rubric',
    reviewBlinded: true,
    resultFingerprint: requireFingerprint(
      record.resultFingerprint,
      'experiment slot record.resultFingerprint',
    ),
  };
}

function validateSlotSchedule(
  slotsValue: unknown,
  benchmarkCase: BenchmarkCorpusCase,
  controls: BenchmarkCorpusControls,
): readonly BenchmarkExperimentSlot[] {
  if (!Array.isArray(slotsValue)) {
    throw new Error('experiment.slots must be an array.');
  }

  const expected = buildSlots(benchmarkCase, controls);
  if (slotsValue.length !== expected.length) {
    throw new Error(`experiment.slots must contain exactly ${expected.length} slots.`);
  }

  return slotsValue.map((value, index) => {
    const record = requireRecord(value, `experiment.slots[${index}]`);
    const expectedSlot = expected[index];
    if (expectedSlot === undefined) {
      throw new Error(`experiment.slots[${index}] is unexpected.`);
    }

    const status = record.status;
    if (status !== 'pending' && status !== 'recorded') {
      throw new Error(`experiment.slots[${index}].status is invalid.`);
    }

    if (
      record.id !== expectedSlot.id ||
      record.sequence !== expectedSlot.sequence ||
      record.repetition !== expectedSlot.repetition ||
      record.arm !== expectedSlot.arm ||
      record.protocol !== expectedSlot.protocol ||
      record.plannedStrategy !== expectedSlot.plannedStrategy
    ) {
      throw new Error(`experiment.slots[${index}] does not match the alternating A/B schedule.`);
    }

    if (status === 'pending') {
      if (record.record !== undefined) {
        throw new Error(`experiment.slots[${index}] is pending but contains a record.`);
      }
      return expectedSlot;
    }

    if (record.record === undefined) {
      throw new Error(`experiment.slots[${index}] is recorded but has no record.`);
    }
    return {
      ...expectedSlot,
      status: 'recorded',
      record: parseExperimentRecord(record.record),
    };
  });
}

function assertUniqueRecordedEvidence(slots: readonly BenchmarkExperimentSlot[]): void {
  const resultFingerprints = new Set<string>();
  const sessionFingerprints = new Set<string>();

  for (const slot of slots) {
    if (slot.status !== 'recorded' || slot.record === undefined) continue;
    const resultFingerprint = slot.record.resultFingerprint;
    if (resultFingerprints.has(resultFingerprint)) {
      throw new Error('experiment contains a duplicate Claude result fingerprint.');
    }
    resultFingerprints.add(resultFingerprint);

    const sessionFingerprint = slot.record.measurement.sessionFingerprint;
    if (sessionFingerprint === undefined) {
      throw new Error('experiment measurements must include a session fingerprint.');
    }
    if (sessionFingerprints.has(sessionFingerprint)) {
      throw new Error('experiment contains a reused Claude session; session persistence must be false.');
    }
    sessionFingerprints.add(sessionFingerprint);
  }
}

export function createBenchmarkExperiment(
  corpus: BenchmarkCorpusManifest,
  caseId: string,
  model: string,
): BenchmarkExperimentPlan {
  const normalizedModel = model.trim();
  if (normalizedModel === '') {
    throw new Error('experiment model must be explicitly pinned.');
  }
  const benchmarkCase = corpus.cases.find((item) => item.id === caseId);
  if (benchmarkCase === undefined) {
    throw new Error(`Benchmark corpus does not contain case ${caseId}.`);
  }

  return {
    schemaVersion: 1,
    id: experimentId(corpus, benchmarkCase, normalizedModel),
    evidenceMode: 'real',
    execution: false,
    provider: 'claude-code',
    model: normalizedModel,
    modelProvenance: 'operator-pinned',
    corpusId: corpus.id,
    target: corpus.target,
    controls: corpus.controls,
    case: benchmarkCase,
    promptFingerprint: fingerprint(benchmarkCase.task),
    qualityRubricFingerprint: stableQualityFingerprint(benchmarkCase),
    slots: buildSlots(benchmarkCase, corpus.controls),
  };
}

export function parseBenchmarkExperimentPlan(value: unknown): BenchmarkExperimentPlan {
  const record = requireRecord(value, 'experiment');
  if (record.schemaVersion !== 1) throw new Error('experiment.schemaVersion must be 1.');
  if (record.evidenceMode !== 'real') throw new Error('experiment.evidenceMode must be real.');
  if (record.execution !== false) {
    throw new Error('experiment.execution must be false; M14 does not execute Claude Code.');
  }
  if (record.provider !== 'claude-code') {
    throw new Error('experiment.provider must be claude-code.');
  }
  if (record.modelProvenance !== 'operator-pinned') {
    throw new Error('experiment.modelProvenance must be operator-pinned.');
  }

  const corpusId = requireString(record.corpusId, 'experiment.corpusId');
  const model = requireString(record.model, 'experiment.model');
  const syntheticCorpus = parseBenchmarkCorpus({
    schemaVersion: 1,
    id: corpusId,
    evidenceMode: 'real',
    provider: 'claude-code',
    target: record.target,
    controls: record.controls,
    cases: [record.case],
  });
  const benchmarkCase = syntheticCorpus.cases[0];
  if (benchmarkCase === undefined) throw new Error('experiment.case is missing.');

  const expectedId = experimentId(syntheticCorpus, benchmarkCase, model);
  if (record.id !== expectedId) {
    throw new Error('experiment.id does not match corpus/case/revision/model provenance.');
  }

  const expectedPromptFingerprint = fingerprint(benchmarkCase.task);
  if (record.promptFingerprint !== expectedPromptFingerprint) {
    throw new Error('experiment.promptFingerprint does not match the corpus task.');
  }
  const expectedQualityFingerprint = stableQualityFingerprint(benchmarkCase);
  if (record.qualityRubricFingerprint !== expectedQualityFingerprint) {
    throw new Error('experiment.qualityRubricFingerprint does not match the corpus rubric.');
  }

  const slots = validateSlotSchedule(record.slots, benchmarkCase, syntheticCorpus.controls);
  assertUniqueRecordedEvidence(slots);

  return {
    schemaVersion: 1,
    id: expectedId,
    evidenceMode: 'real',
    execution: false,
    provider: 'claude-code',
    model,
    modelProvenance: 'operator-pinned',
    corpusId,
    target: syntheticCorpus.target,
    controls: syntheticCorpus.controls,
    case: benchmarkCase,
    promptFingerprint: expectedPromptFingerprint,
    qualityRubricFingerprint: expectedQualityFingerprint,
    slots,
  };
}

export async function loadBenchmarkExperimentPlan(path: string): Promise<BenchmarkExperimentPlan> {
  const raw = await readFile(path, 'utf8');
  return parseBenchmarkExperimentPlan(JSON.parse(raw) as unknown);
}

export function recordBenchmarkExperimentResult(
  plan: BenchmarkExperimentPlan,
  slotId: string,
  claudeResultText: string,
  qualityScore: number,
  reviewBlinded: boolean,
): BenchmarkExperimentPlan {
  const normalized = parseBenchmarkExperimentPlan(plan as unknown);
  if (reviewBlinded !== true) {
    throw new Error('Experiment recording requires explicit blinded rubric confirmation.');
  }
  const score = requireQualityScore(qualityScore, 'qualityScore');
  const slotIndex = normalized.slots.findIndex((slot) => slot.id === slotId);
  if (slotIndex < 0) throw new Error(`Experiment does not contain slot ${slotId}.`);
  const current = normalized.slots[slotIndex];
  if (current === undefined) throw new Error(`Experiment does not contain slot ${slotId}.`);
  if (current.status === 'recorded') {
    throw new Error(`Experiment slot ${slotId} is already recorded.`);
  }

  const measurement = parseClaudeCodeJsonText(claudeResultText);
  if (measurement.sessionFingerprint === undefined) {
    throw new Error('Claude Code experiment results must include session_id for session-isolation evidence.');
  }
  const resultFingerprint = fingerprint(claudeResultText);

  for (const slot of normalized.slots) {
    if (slot.status !== 'recorded' || slot.record === undefined) continue;
    if (slot.record.resultFingerprint === resultFingerprint) {
      throw new Error('This Claude Code result file is already recorded in the experiment.');
    }
    if (slot.record.measurement.sessionFingerprint === measurement.sessionFingerprint) {
      throw new Error('This Claude session is already used in the experiment; start a fresh session.');
    }
  }

  const slots = normalized.slots.map((slot, index) =>
    index === slotIndex
      ? {
          ...slot,
          status: 'recorded' as const,
          record: {
            provider: 'claude-code' as const,
            source: 'claude-code-json' as const,
            measured: true as const,
            measurement,
            qualityScore: score,
            qualitySource: 'blinded-rubric' as const,
            reviewBlinded: true as const,
            resultFingerprint,
          },
        }
      : slot,
  );

  return parseBenchmarkExperimentPlan({ ...normalized, slots });
}

function toBenchmarkObservation(slot: BenchmarkExperimentSlot): BenchmarkObservation {
  if (slot.status !== 'recorded' || slot.record === undefined) {
    throw new Error(`Experiment slot ${slot.id} is not recorded.`);
  }
  const measurement = slot.record.measurement;
  return {
    arm: slot.arm,
    source: 'measured',
    inputTokens: measurement.inputTokens,
    outputTokens: measurement.outputTokens,
    cacheReadTokens: measurement.cacheReadTokens,
    cacheWriteTokens: measurement.cacheWriteTokens,
    latencyMs: measurement.latencyMs,
    success: measurement.success,
    qualityScore: slot.record.qualityScore,
  };
}

export function finalizeBenchmarkExperiment(plan: BenchmarkExperimentPlan): BenchmarkInput {
  const normalized = parseBenchmarkExperimentPlan(plan as unknown);
  const pending = normalized.slots.filter((slot) => slot.status !== 'recorded');
  if (pending.length > 0) {
    throw new Error(`Experiment cannot finalize with ${pending.length} pending slot(s).`);
  }

  const baseline = normalized.slots
    .filter((slot) => slot.arm === 'baseline')
    .map(toBenchmarkObservation);
  const acr = normalized.slots
    .filter((slot) => slot.arm === 'acr')
    .map(toBenchmarkObservation);

  if (
    baseline.length !== normalized.controls.repetitionsPerArm ||
    acr.length !== normalized.controls.repetitionsPerArm
  ) {
    throw new Error('Experiment does not contain the required repetitions for both arms.');
  }

  return {
    case: {
      id: normalized.case.id,
      taskType: normalized.case.taskType,
      ...(normalized.case.expectedStrategy === 'NO_OPTIMIZATION'
        ? {}
        : { strategy: normalized.case.expectedStrategy }),
      taskFingerprint: normalized.promptFingerprint,
      minimumQualityScore: normalized.case.quality.minimumScore,
      notes: `Real A/B experiment ${normalized.id}; corpus ${normalized.corpusId}; revision ${normalized.target.revision}; model ${normalized.model} (${normalized.modelProvenance}). Claude client cost estimates are intentionally excluded from measured benchmark cost.`,
    },
    baseline,
    acr,
  };
}

export function summarizeBenchmarkExperiment(
  plan: BenchmarkExperimentPlan,
): BenchmarkExperimentSummary {
  const normalized = parseBenchmarkExperimentPlan(plan as unknown);
  const recordedSlots = normalized.slots.filter((slot) => slot.status === 'recorded').length;
  const next = normalized.slots.find((slot) => slot.status === 'pending');

  return {
    id: normalized.id,
    evidenceMode: 'real',
    execution: false,
    caseId: normalized.case.id,
    model: normalized.model,
    targetRevision: normalized.target.revision,
    expectedStrategy: normalized.case.expectedStrategy,
    repetitionsPerArm: normalized.controls.repetitionsPerArm,
    totalSlots: normalized.slots.length,
    recordedSlots,
    pendingSlots: normalized.slots.length - recordedSlots,
    ...(next === undefined
      ? {}
      : {
          nextSlot: {
            id: next.id,
            sequence: next.sequence,
            repetition: next.repetition,
            arm: next.arm,
            protocol: next.protocol,
            plannedStrategy: next.plannedStrategy,
          },
        }),
  };
}
