import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import type {
  PrecisionRequirement,
  RiskLevel,
  TaskType,
} from './contracts.js';

export interface PolicyWeights {
  saving: number;
  risk: Readonly<Record<RiskLevel, number>>;
  overhead: number;
  confidence: number;
}

export interface NoOptimizationPolicy {
  simpleTaskMaxContextUtilization: number;
  generalReasoningMaxContextUtilization: number;
  minimumUtilityScore: number;
}

export interface StrategyPolicy {
  id: string;
  adapters: readonly string[];
  taskTypes: readonly TaskType[];
  requiredCapabilities: readonly string[];
  forbiddenPrecisions: readonly PrecisionRequirement[];
  minContextUtilization?: number;
  maxContextUtilization?: number;
  estimatedSavingRatio: number;
  risk: RiskLevel;
  overheadScore: number;
  baseScore: number;
  confidence: number;
  reasons: readonly string[];
}

export interface PolicyConfig {
  version: number;
  weights: PolicyWeights;
  noOptimization: NoOptimizationPolicy;
  strategies: readonly StrategyPolicy[];
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

const PRECISIONS = new Set<PrecisionRequirement>([
  'semantic',
  'structural',
  'exact',
  'secret-sensitive',
]);

const RISKS = new Set<RiskLevel>(['low', 'medium', 'high', 'critical']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new Error(`Policy field ${key} must be a number.`);
  }
  return value;
}

function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Policy field ${key} must be a non-empty string.`);
  }
  return value;
}

function requireStringArray(
  record: Record<string, unknown>,
  key: string,
): readonly string[] {
  const value = record[key];
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`Policy field ${key} must be an array of strings.`);
  }
  return value;
}

function parseTaskTypes(value: readonly string[]): readonly TaskType[] {
  for (const item of value) {
    if (!TASK_TYPES.has(item as TaskType)) {
      throw new Error(`Unknown task type in policy: ${item}`);
    }
  }
  return value as readonly TaskType[];
}

function parsePrecisions(
  value: readonly string[],
): readonly PrecisionRequirement[] {
  for (const item of value) {
    if (!PRECISIONS.has(item as PrecisionRequirement)) {
      throw new Error(`Unknown precision requirement in policy: ${item}`);
    }
  }
  return value as readonly PrecisionRequirement[];
}

function parseRisk(value: unknown): RiskLevel {
  if (typeof value !== 'string' || !RISKS.has(value as RiskLevel)) {
    throw new Error(`Unknown risk level in policy: ${String(value)}`);
  }
  return value as RiskLevel;
}

function optionalNumber(
  record: Record<string, unknown>,
  key: string,
): number | undefined {
  if (!(key in record)) return undefined;
  return requireNumber(record, key);
}

function parseStrategy(value: unknown): StrategyPolicy {
  if (!isRecord(value)) {
    throw new Error('Each strategy policy must be an object.');
  }

  const minContextUtilization = optionalNumber(value, 'minContextUtilization');
  const maxContextUtilization = optionalNumber(value, 'maxContextUtilization');

  return {
    id: requireString(value, 'id'),
    adapters: requireStringArray(value, 'adapters'),
    taskTypes: parseTaskTypes(requireStringArray(value, 'taskTypes')),
    requiredCapabilities: requireStringArray(value, 'requiredCapabilities'),
    forbiddenPrecisions: parsePrecisions(
      requireStringArray(value, 'forbiddenPrecisions'),
    ),
    ...(minContextUtilization !== undefined ? { minContextUtilization } : {}),
    ...(maxContextUtilization !== undefined ? { maxContextUtilization } : {}),
    estimatedSavingRatio: requireNumber(value, 'estimatedSavingRatio'),
    risk: parseRisk(value.risk),
    overheadScore: requireNumber(value, 'overheadScore'),
    baseScore: requireNumber(value, 'baseScore'),
    confidence: requireNumber(value, 'confidence'),
    reasons: requireStringArray(value, 'reasons'),
  };
}

export function parsePolicyConfig(value: unknown): PolicyConfig {
  if (!isRecord(value)) {
    throw new Error('Policy document must contain an object.');
  }

  if (!isRecord(value.weights) || !isRecord(value.weights.risk)) {
    throw new Error('Policy weights are missing or invalid.');
  }
  if (!isRecord(value.noOptimization)) {
    throw new Error('Policy noOptimization section is missing or invalid.');
  }
  if (!Array.isArray(value.strategies)) {
    throw new Error('Policy strategies must be an array.');
  }

  const riskWeights = value.weights.risk;

  return {
    version: requireNumber(value, 'version'),
    weights: {
      saving: requireNumber(value.weights, 'saving'),
      risk: {
        low: requireNumber(riskWeights, 'low'),
        medium: requireNumber(riskWeights, 'medium'),
        high: requireNumber(riskWeights, 'high'),
        critical: requireNumber(riskWeights, 'critical'),
      },
      overhead: requireNumber(value.weights, 'overhead'),
      confidence: requireNumber(value.weights, 'confidence'),
    },
    noOptimization: {
      simpleTaskMaxContextUtilization: requireNumber(
        value.noOptimization,
        'simpleTaskMaxContextUtilization',
      ),
      generalReasoningMaxContextUtilization: requireNumber(
        value.noOptimization,
        'generalReasoningMaxContextUtilization',
      ),
      minimumUtilityScore: requireNumber(
        value.noOptimization,
        'minimumUtilityScore',
      ),
    },
    strategies: value.strategies.map(parseStrategy),
  };
}

export const DEFAULT_POLICY_URL = new URL(
  '../../policies/default.yaml',
  import.meta.url,
);

export async function loadPolicyConfig(
  url: URL = DEFAULT_POLICY_URL,
): Promise<PolicyConfig> {
  const content = await readFile(fileURLToPath(url), 'utf8');

  // YAML 1.2 is a superset of JSON. The default policy deliberately uses the
  // JSON-compatible YAML subset so ACR can load it without a runtime parser.
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Policy file must use JSON-compatible YAML: ${message}`);
  }

  return parsePolicyConfig(parsed);
}
