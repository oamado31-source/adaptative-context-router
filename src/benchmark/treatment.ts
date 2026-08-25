import { createHash } from 'node:crypto';

import type { TaskType } from '../core/contracts.js';
import { SerenaMcpBridge } from '../executors/serena-mcp-bridge.js';

export type BenchmarkTreatmentMethod =
  | 'no-optimization'
  | 'serena-symbol'
  | 'serena-pattern';

export interface BenchmarkTreatmentRequest {
  task: string;
  taskType: TaskType;
  expectedStrategy: string;
}

export interface BenchmarkTreatmentResult {
  strategy: string;
  applied: boolean;
  method: BenchmarkTreatmentMethod;
  context: string;
  contextChars: number;
  queryFingerprint?: string;
  tool?: string;
}

export interface SerenaBenchmarkTreatmentOptions {
  bridge: SerenaMcpBridge;
  maxContextChars?: number;
}

const DEFAULT_MAX_CONTEXT_CHARS = 12_000;

const STOP_WORDS = new Set([
  'about',
  'after',
  'also',
  'between',
  'code',
  'current',
  'describe',
  'explain',
  'find',
  'flow',
  'from',
  'implementation',
  'into',
  'project',
  'repository',
  'show',
  'summarize',
  'that',
  'their',
  'then',
  'through',
  'using',
  'what',
  'where',
  'which',
  'with',
]);

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function clampContext(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n[ACR benchmark context truncated]`;
}

function validateLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1_000 || limit > 50_000) {
    throw new Error('maxContextChars must be an integer between 1000 and 50000.');
  }
  return limit;
}

function explicitIdentifier(task: string): string | undefined {
  const backticked = [...task.matchAll(/`([A-Za-z_$][A-Za-z0-9_$]*)`/gu)]
    .map((match) => match[1])
    .find(Boolean);
  if (backticked) return backticked;

  return [...task.matchAll(/\b[A-Za-z_$][A-Za-z0-9_$]*\b/gu)]
    .map((match) => match[0])
    .find((token) =>
      /[a-z][A-Z]/u.test(token) || token.includes('_') || token.includes('$'),
    );
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function significantTerms(task: string): readonly string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const match of task.matchAll(/\b[A-Za-z][A-Za-z0-9_-]{3,}\b/gu)) {
    const original = match[0];
    const normalized = original.toLowerCase();
    if (STOP_WORDS.has(normalized) || seen.has(normalized)) continue;
    seen.add(normalized);
    terms.push(original);
    if (terms.length >= 8) break;
  }
  return terms;
}

function requireUsefulResult(text: string, method: string): void {
  if (text.trim() === '') {
    throw new Error(`${method} returned no context; benchmark treatment was not applied.`);
  }
}

export async function buildBenchmarkTreatment(
  request: BenchmarkTreatmentRequest,
  options: SerenaBenchmarkTreatmentOptions,
): Promise<BenchmarkTreatmentResult> {
  if (request.task.trim() === '') throw new Error('benchmark treatment task is required.');
  const limit = validateLimit(options.maxContextChars ?? DEFAULT_MAX_CONTEXT_CHARS);

  if (request.expectedStrategy === 'NO_OPTIMIZATION') {
    return {
      strategy: 'NO_OPTIMIZATION',
      applied: false,
      method: 'no-optimization',
      context: '',
      contextChars: 0,
    };
  }
  if (request.expectedStrategy !== 'serena') {
    throw new Error(
      `No real benchmark treatment is implemented for strategy ${request.expectedStrategy}.`,
    );
  }

  const identifier = explicitIdentifier(request.task);
  if (identifier && request.taskType === 'targeted_code_search') {
    const result = await options.bridge.findSymbol({
      namePathPattern: identifier,
      includeBody: true,
      includeInfo: true,
      substringMatching: false,
      maxMatches: 8,
      maxAnswerChars: limit,
    });
    if (result.isError) {
      throw new Error('Serena find_symbol reported a tool-level error.');
    }
    requireUsefulResult(result.text, 'Serena find_symbol');
    const context = clampContext(result.text, limit);
    return {
      strategy: 'serena',
      applied: true,
      method: 'serena-symbol',
      context,
      contextChars: context.length,
      queryFingerprint: sha256(identifier),
      tool: result.tool,
    };
  }

  const terms = significantTerms(request.task);
  if (terms.length === 0) {
    throw new Error('Could not derive a Serena search query from the benchmark task.');
  }
  const pattern = terms.map(escapeRegex).join('|');
  const result = await options.bridge.searchForPattern({
    substringPattern: pattern,
    contextLinesBefore: 2,
    contextLinesAfter: 2,
    restrictSearchToCodeFiles: true,
    maxAnswerChars: limit,
  });
  if (result.isError) {
    throw new Error('Serena search_for_pattern reported a tool-level error.');
  }
  requireUsefulResult(result.text, 'Serena search_for_pattern');
  const context = clampContext(result.text, limit);
  return {
    strategy: 'serena',
    applied: true,
    method: 'serena-pattern',
    context,
    contextChars: context.length,
    queryFingerprint: sha256(pattern),
    tool: result.tool,
  };
}
