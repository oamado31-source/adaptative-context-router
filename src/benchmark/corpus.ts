import { readFile } from 'node:fs/promises';

import { CAPABILITY_DEFINITIONS } from '../core/capability-definitions.js';
import type { TaskType } from '../core/contracts.js';

export type BenchmarkCorpusEvidenceMode = 'real';
export type BenchmarkCorpusProvider = 'claude-code';
export type BenchmarkCorpusOrder = 'alternating';
export type BenchmarkQualityEvaluation = 'blinded-rubric';

export interface BenchmarkCorpusTarget {
  repository: string;
  revision: string;
}

export interface BenchmarkCorpusControls {
  repetitionsPerArm: number;
  samePrompt: true;
  sameProviderModel: true;
  sessionPersistence: false;
  order: BenchmarkCorpusOrder;
  qualityEvaluation: BenchmarkQualityEvaluation;
}

export interface BenchmarkCorpusQuality {
  minimumScore: number;
  assertions: readonly string[];
}

export interface BenchmarkCorpusCase {
  id: string;
  title: string;
  taskType: TaskType;
  task: string;
  routingContextRatio: number;
  targetPaths: readonly string[];
  requiredCapabilities: readonly string[];
  expectedStrategy: string;
  quality: BenchmarkCorpusQuality;
  notes?: string;
}

export interface BenchmarkCorpusManifest {
  schemaVersion: 1;
  id: string;
  evidenceMode: BenchmarkCorpusEvidenceMode;
  provider: BenchmarkCorpusProvider;
  target: BenchmarkCorpusTarget;
  controls: BenchmarkCorpusControls;
  cases: readonly BenchmarkCorpusCase[];
  coverageNotes?: readonly string[];
}

export interface BenchmarkCorpusSummary {
  id: string;
  evidenceMode: BenchmarkCorpusEvidenceMode;
  provider: BenchmarkCorpusProvider;
  repository: string;
  revision: string;
  repetitionsPerArm: number;
  totalCases: number;
  noOptimizationCases: number;
  taskTypes: Readonly<Record<string, number>>;
  requiredCapabilities: Readonly<Record<string, number>>;
  coverageNotes: readonly string[];
}

const TASK_TYPES = new Set<TaskType>([
  'targeted_code_search',
  'repository_exploration',
  'large_logs',
  'large_structured_data',
  'semantic_long_context',
  'exact_data',
  'implementation',
  'debugging',
  'simple_operation',
  'general_reasoning',
  'unknown',
]);

const CAPABILITY_IDS = new Set(
  CAPABILITY_DEFINITIONS.map((definition) => definition.id),
);

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

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  return requireString(value, label);
}

function requireUniqueStrings(
  value: unknown,
  label: string,
  minimumItems = 1,
): readonly string[] {
  if (!Array.isArray(value) || value.length < minimumItems) {
    throw new Error(`${label} must contain at least ${minimumItems} item(s).`);
  }

  const items = value.map((item, index) =>
    requireString(item, `${label}[${index}]`),
  );
  if (new Set(items).size !== items.length) {
    throw new Error(`${label} must not contain duplicates.`);
  }
  return items;
}

function parseTargetPath(value: string, label: string): string {
  if (
    value.startsWith('/') ||
    /^[A-Za-z]:[\\/]/u.test(value) ||
    value.split(/[\\/]/u).some((part) => part === '..')
  ) {
    throw new Error(`${label} must be a repository-relative path without traversal.`);
  }
  return value;
}

function parseTarget(value: unknown): BenchmarkCorpusTarget {
  const record = requireRecord(value, 'corpus.target');
  const repository = requireString(record.repository, 'corpus.target.repository');
  if (!/^[^/\s]+\/[^/\s]+$/u.test(repository)) {
    throw new Error('corpus.target.repository must be in owner/name form.');
  }

  const revision = requireString(record.revision, 'corpus.target.revision');
  if (!/^[0-9a-f]{40}$/u.test(revision)) {
    throw new Error('corpus.target.revision must be a full 40-character commit SHA.');
  }

  return { repository, revision };
}

function parseControls(value: unknown): BenchmarkCorpusControls {
  const record = requireRecord(value, 'corpus.controls');
  const repetitionsPerArm = record.repetitionsPerArm;
  if (
    typeof repetitionsPerArm !== 'number' ||
    !Number.isInteger(repetitionsPerArm) ||
    repetitionsPerArm < 3
  ) {
    throw new Error('corpus.controls.repetitionsPerArm must be an integer >= 3.');
  }
  if (record.samePrompt !== true) {
    throw new Error('corpus.controls.samePrompt must be true.');
  }
  if (record.sameProviderModel !== true) {
    throw new Error('corpus.controls.sameProviderModel must be true.');
  }
  if (record.sessionPersistence !== false) {
    throw new Error('corpus.controls.sessionPersistence must be false.');
  }
  if (record.order !== 'alternating') {
    throw new Error('corpus.controls.order must be alternating.');
  }
  if (record.qualityEvaluation !== 'blinded-rubric') {
    throw new Error('corpus.controls.qualityEvaluation must be blinded-rubric.');
  }

  return {
    repetitionsPerArm,
    samePrompt: true,
    sameProviderModel: true,
    sessionPersistence: false,
    order: 'alternating',
    qualityEvaluation: 'blinded-rubric',
  };
}

function parseQuality(value: unknown, prefix: string): BenchmarkCorpusQuality {
  const record = requireRecord(value, `${prefix}.quality`);
  const minimumScore = record.minimumScore;
  if (
    typeof minimumScore !== 'number' ||
    !Number.isFinite(minimumScore) ||
    minimumScore < 0 ||
    minimumScore > 1
  ) {
    throw new Error(`${prefix}.quality.minimumScore must be between 0 and 1.`);
  }

  return {
    minimumScore,
    assertions: requireUniqueStrings(
      record.assertions,
      `${prefix}.quality.assertions`,
      2,
    ),
  };
}

function parseCase(value: unknown, index: number): BenchmarkCorpusCase {
  const prefix = `corpus.cases[${index}]`;
  const record = requireRecord(value, prefix);
  const taskType = record.taskType;
  if (typeof taskType !== 'string' || !TASK_TYPES.has(taskType as TaskType)) {
    throw new Error(`${prefix}.taskType is invalid.`);
  }

  const routingContextRatio = record.routingContextRatio;
  if (
    typeof routingContextRatio !== 'number' ||
    !Number.isFinite(routingContextRatio) ||
    routingContextRatio < 0 ||
    routingContextRatio > 1
  ) {
    throw new Error(`${prefix}.routingContextRatio must be between 0 and 1.`);
  }

  const targetPaths = requireUniqueStrings(record.targetPaths, `${prefix}.targetPaths`)
    .map((item, pathIndex) =>
      parseTargetPath(item, `${prefix}.targetPaths[${pathIndex}]`),
    );
  const requiredCapabilities = requireUniqueStrings(
    record.requiredCapabilities,
    `${prefix}.requiredCapabilities`,
    0,
  );
  for (const capability of requiredCapabilities) {
    if (!CAPABILITY_IDS.has(capability)) {
      throw new Error(`${prefix}.requiredCapabilities contains unknown capability ${capability}.`);
    }
  }

  const notes = optionalString(record.notes, `${prefix}.notes`);
  return {
    id: requireString(record.id, `${prefix}.id`),
    title: requireString(record.title, `${prefix}.title`),
    taskType: taskType as TaskType,
    task: requireString(record.task, `${prefix}.task`),
    routingContextRatio,
    targetPaths,
    requiredCapabilities,
    expectedStrategy: requireString(record.expectedStrategy, `${prefix}.expectedStrategy`),
    quality: parseQuality(record.quality, prefix),
    ...(notes !== undefined ? { notes } : {}),
  };
}

export function parseBenchmarkCorpus(value: unknown): BenchmarkCorpusManifest {
  const record = requireRecord(value, 'corpus');
  if (record.schemaVersion !== 1) {
    throw new Error('corpus.schemaVersion must be 1.');
  }
  if (record.evidenceMode !== 'real') {
    throw new Error('corpus.evidenceMode must be real; synthetic corpora are not evidence.');
  }
  if (record.provider !== 'claude-code') {
    throw new Error('corpus.provider must be claude-code.');
  }
  if (!Array.isArray(record.cases) || record.cases.length === 0) {
    throw new Error('corpus.cases must contain at least one real benchmark case.');
  }

  const cases = record.cases.map(parseCase);
  const caseIds = cases.map((item) => item.id);
  if (new Set(caseIds).size !== caseIds.length) {
    throw new Error('corpus.cases must use unique case IDs.');
  }

  const coverageNotes =
    record.coverageNotes === undefined
      ? undefined
      : requireUniqueStrings(record.coverageNotes, 'corpus.coverageNotes');

  return {
    schemaVersion: 1,
    id: requireString(record.id, 'corpus.id'),
    evidenceMode: 'real',
    provider: 'claude-code',
    target: parseTarget(record.target),
    controls: parseControls(record.controls),
    cases,
    ...(coverageNotes !== undefined ? { coverageNotes } : {}),
  };
}

export async function loadBenchmarkCorpus(path: string): Promise<BenchmarkCorpusManifest> {
  const raw = await readFile(path, 'utf8');
  return parseBenchmarkCorpus(JSON.parse(raw) as unknown);
}

function increment(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

export function summarizeBenchmarkCorpus(
  corpus: BenchmarkCorpusManifest,
): BenchmarkCorpusSummary {
  const taskTypes: Record<string, number> = {};
  const requiredCapabilities: Record<string, number> = {};
  let noOptimizationCases = 0;

  for (const benchmarkCase of corpus.cases) {
    increment(taskTypes, benchmarkCase.taskType);
    for (const capability of benchmarkCase.requiredCapabilities) {
      increment(requiredCapabilities, capability);
    }
    if (benchmarkCase.expectedStrategy === 'NO_OPTIMIZATION') {
      noOptimizationCases += 1;
    }
  }

  return {
    id: corpus.id,
    evidenceMode: corpus.evidenceMode,
    provider: corpus.provider,
    repository: corpus.target.repository,
    revision: corpus.target.revision,
    repetitionsPerArm: corpus.controls.repetitionsPerArm,
    totalCases: corpus.cases.length,
    noOptimizationCases,
    taskTypes,
    requiredCapabilities,
    coverageNotes: corpus.coverageNotes ?? [],
  };
}
