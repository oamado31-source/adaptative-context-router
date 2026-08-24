import { createHash } from 'node:crypto';

import type { ProviderMeasurement } from './contracts.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredNumber(
  record: Readonly<Record<string, unknown>>,
  key: string,
): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`Claude Code result is missing a valid non-negative ${key}.`);
  }
  return value;
}

function optionalNumber(
  record: Readonly<Record<string, unknown>>,
  key: string,
): number | undefined {
  const value = record[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`Claude Code result contains an invalid ${key}.`);
  }
  return value;
}

function optionalInteger(
  record: Readonly<Record<string, unknown>>,
  key: string,
): number | undefined {
  const value = optionalNumber(record, key);
  if (value === undefined) return undefined;
  if (!Number.isInteger(value)) {
    throw new Error(`Claude Code result contains a non-integer ${key}.`);
  }
  return value;
}

function fingerprint(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function parseClaudeCodeJson(value: unknown): ProviderMeasurement {
  if (!isRecord(value)) {
    throw new Error(
      'Expected a single Claude Code result object from --output-format json.',
    );
  }

  if (value.type !== 'result') {
    throw new Error('Claude Code JSON must be a result message.');
  }

  if (!isRecord(value.usage)) {
    throw new Error(
      'Claude Code JSON result does not include a structured usage object.',
    );
  }

  const usage = value.usage;
  const inputTokens = requiredNumber(usage, 'input_tokens');
  const outputTokens = requiredNumber(usage, 'output_tokens');
  const cacheReadTokens = optionalNumber(usage, 'cache_read_input_tokens') ?? 0;
  const cacheWriteTokens =
    optionalNumber(usage, 'cache_creation_input_tokens') ?? 0;
  const latencyMs = requiredNumber(value, 'duration_ms');
  const apiLatencyMs = optionalNumber(value, 'duration_api_ms');
  const estimatedCostUsd = optionalNumber(value, 'total_cost_usd');
  const turns = optionalInteger(value, 'num_turns');

  const sessionId =
    typeof value.session_id === 'string' && value.session_id.length > 0
      ? value.session_id
      : undefined;
  const isError = value.is_error === true;

  return {
    provider: 'claude-code',
    source: 'claude-code-json',
    measured: true,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    latencyMs,
    ...(apiLatencyMs === undefined ? {} : { apiLatencyMs }),
    ...(estimatedCostUsd === undefined ? {} : { estimatedCostUsd }),
    tokenProvenance: 'provider-reported',
    latencyProvenance: 'provider-reported',
    costProvenance:
      estimatedCostUsd === undefined
        ? 'unavailable'
        : 'claude-code-client-estimate',
    success: !isError,
    ...(turns === undefined ? {} : { turns }),
    ...(sessionId === undefined
      ? {}
      : { sessionFingerprint: fingerprint(sessionId) }),
  };
}

export function parseClaudeCodeJsonText(text: string): ProviderMeasurement {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new Error('Claude Code measurement file is not valid JSON.');
  }
  return parseClaudeCodeJson(value);
}
