import { readFile } from 'node:fs/promises';

import type { TaskType } from '../core/contracts.js';
import type {
  BenchmarkCase,
  BenchmarkInput,
  BenchmarkObservation,
} from './contracts.js';

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error(`${label} must be a string.`);
  return value;
}

function optionalNumber(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }
  return value;
}

function parseCase(value: unknown): BenchmarkCase {
  if (!isRecord(value)) throw new Error('benchmark.case must be an object.');
  if (typeof value.id !== 'string' || value.id.trim() === '') {
    throw new Error('benchmark.case.id must be a non-empty string.');
  }
  if (typeof value.taskType !== 'string' || !TASK_TYPES.has(value.taskType as TaskType)) {
    throw new Error('benchmark.case.taskType is invalid.');
  }

  const strategy = optionalString(value.strategy, 'benchmark.case.strategy');
  const taskFingerprint = optionalString(
    value.taskFingerprint,
    'benchmark.case.taskFingerprint',
  );
  const qualityTolerance = optionalNumber(
    value.qualityTolerance,
    'benchmark.case.qualityTolerance',
  );
  const minimumQualityScore = optionalNumber(
    value.minimumQualityScore,
    'benchmark.case.minimumQualityScore',
  );
  if (
    minimumQualityScore !== undefined &&
    (minimumQualityScore < 0 || minimumQualityScore > 1)
  ) {
    throw new Error('benchmark.case.minimumQualityScore must be between 0 and 1.');
  }
  const notes = optionalString(value.notes, 'benchmark.case.notes');

  return {
    id: value.id,
    taskType: value.taskType as TaskType,
    ...(strategy !== undefined ? { strategy } : {}),
    ...(taskFingerprint !== undefined ? { taskFingerprint } : {}),
    ...(qualityTolerance !== undefined ? { qualityTolerance } : {}),
    ...(minimumQualityScore !== undefined ? { minimumQualityScore } : {}),
    ...(notes !== undefined ? { notes } : {}),
  };
}

function requiredNumber(
  record: Record<string, unknown>,
  key: string,
  prefix: string,
): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${prefix}.${key} must be a finite number.`);
  }
  return value;
}

function parseObservation(value: unknown, index: number): BenchmarkObservation {
  const prefix = `benchmark observation[${index}]`;
  if (!isRecord(value)) throw new Error(`${prefix} must be an object.`);
  if (value.arm !== 'baseline' && value.arm !== 'acr') {
    throw new Error(`${prefix}.arm must be baseline or acr.`);
  }
  if (value.source !== 'measured') {
    throw new Error(`${prefix}.source must be measured.`);
  }
  if (typeof value.success !== 'boolean') {
    throw new Error(`${prefix}.success must be boolean.`);
  }

  const cacheReadTokens = optionalNumber(
    value.cacheReadTokens,
    `${prefix}.cacheReadTokens`,
  );
  const cacheWriteTokens = optionalNumber(
    value.cacheWriteTokens,
    `${prefix}.cacheWriteTokens`,
  );
  const costUsd = optionalNumber(value.costUsd, `${prefix}.costUsd`);

  return {
    arm: value.arm,
    source: 'measured',
    inputTokens: requiredNumber(value, 'inputTokens', prefix),
    outputTokens: requiredNumber(value, 'outputTokens', prefix),
    ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
    ...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {}),
    latencyMs: requiredNumber(value, 'latencyMs', prefix),
    ...(costUsd !== undefined ? { costUsd } : {}),
    success: value.success,
    qualityScore: requiredNumber(value, 'qualityScore', prefix),
  };
}

export function parseBenchmarkInput(value: unknown): BenchmarkInput {
  if (!isRecord(value)) throw new Error('benchmark input must be an object.');
  if (!Array.isArray(value.baseline)) {
    throw new Error('benchmark.baseline must be an array.');
  }
  if (!Array.isArray(value.acr)) {
    throw new Error('benchmark.acr must be an array.');
  }

  return {
    case: parseCase(value.case),
    baseline: value.baseline.map(parseObservation),
    acr: value.acr.map(parseObservation),
  };
}

export async function loadBenchmarkInput(path: string): Promise<BenchmarkInput> {
  const raw = await readFile(path, 'utf8');
  return parseBenchmarkInput(JSON.parse(raw) as unknown);
}
