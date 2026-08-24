import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { importClaudeMeasurement } from '../src/cli/measurement.js';
import {
  parseClaudeCodeJson,
  parseClaudeCodeJsonText,
} from '../src/measurement/claude-code-json.js';
import { summarizeTelemetry } from '../src/telemetry/recorder.js';
import { JsonlTelemetryStore } from '../src/telemetry/store.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

function syntheticClaudeResult(): Record<string, unknown> {
  return {
    type: 'result',
    subtype: 'success',
    is_error: false,
    duration_ms: 2480,
    duration_api_ms: 2110,
    num_turns: 3,
    result: 'SYNTHETIC RESPONSE CONTENT THAT MUST NOT BE PERSISTED',
    session_id: 'synthetic-session-secret-value',
    total_cost_usd: 0.042,
    usage: {
      input_tokens: 1200,
      output_tokens: 180,
      cache_read_input_tokens: 640,
      cache_creation_input_tokens: 90,
    },
  };
}

describe('Claude Code provider measurement', () => {
  it('parses provider-reported usage while labeling cost as a client estimate', () => {
    const measurement = parseClaudeCodeJson(syntheticClaudeResult());

    expect(measurement).toMatchObject({
      provider: 'claude-code',
      source: 'claude-code-json',
      measured: true,
      inputTokens: 1200,
      outputTokens: 180,
      cacheReadTokens: 640,
      cacheWriteTokens: 90,
      latencyMs: 2480,
      apiLatencyMs: 2110,
      estimatedCostUsd: 0.042,
      tokenProvenance: 'provider-reported',
      latencyProvenance: 'provider-reported',
      costProvenance: 'claude-code-client-estimate',
      success: true,
      turns: 3,
    });
    expect(measurement.sessionFingerprint).toMatch(/^[0-9a-f]{64}$/u);
    expect(JSON.stringify(measurement)).not.toContain(
      'synthetic-session-secret-value',
    );
    expect(JSON.stringify(measurement)).not.toContain(
      'SYNTHETIC RESPONSE CONTENT THAT MUST NOT BE PERSISTED',
    );
  });

  it('keeps missing provider cost explicitly unavailable', () => {
    const value = syntheticClaudeResult();
    delete value.total_cost_usd;

    const measurement = parseClaudeCodeJson(value);

    expect(measurement.estimatedCostUsd).toBeUndefined();
    expect(measurement.costProvenance).toBe('unavailable');
  });

  it('rejects malformed or non-result provider payloads', () => {
    expect(() => parseClaudeCodeJson([])).toThrow(/single Claude Code result/u);
    expect(() => parseClaudeCodeJson({ type: 'assistant' })).toThrow(
      /result message/u,
    );
    expect(() =>
      parseClaudeCodeJson({ type: 'result', duration_ms: 1 }),
    ).toThrow(/usage object/u);
    expect(() =>
      parseClaudeCodeJson({
        ...syntheticClaudeResult(),
        usage: {
          input_tokens: -1,
          output_tokens: 10,
        },
      }),
    ).toThrow(/input_tokens/u);
    expect(() => parseClaudeCodeJsonText('{not-json')).toThrow(/not valid JSON/u);
  });

  it('imports a Claude result into telemetry without promoting estimated cost to measured cost', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'acr-provider-measurement-'));
    tempDirs.push(directory);
    const inputPath = join(directory, 'claude-result.json');
    const telemetryPath = join(directory, 'events.jsonl');
    const rawResult = JSON.stringify(syntheticClaudeResult());
    await writeFile(inputPath, rawResult, 'utf8');

    const result = await importClaudeMeasurement({
      file: inputPath,
      runId: 'run-provider-measurement-test',
      telemetryPath,
      json: true,
    });

    expect(result.estimatedCostUsd).toBe(0.042);
    expect(result.costProvenance).toBe('claude-code-client-estimate');

    const store = new JsonlTelemetryStore(telemetryPath);
    const events = await store.list();
    expect(events).toHaveLength(1);
    const event = events[0];
    expect(event?.type).toBe('measurement');
    expect(event?.measured).toBe(true);
    expect(event?.source).toBe('claude-code');
    expect(event?.payload.costUsd).toBeNull();
    expect(event?.payload.estimatedCostUsd).toBe(0.042);
    expect(event?.payload.inputTokens).toBe(1200);
    expect(event?.payload.cacheReadTokens).toBe(640);
    expect(event?.payload.costProvenance).toBe(
      'claude-code-client-estimate',
    );

    const persisted = await readFile(telemetryPath, 'utf8');
    expect(persisted).not.toContain('synthetic-session-secret-value');
    expect(persisted).not.toContain(
      'SYNTHETIC RESPONSE CONTENT THAT MUST NOT BE PERSISTED',
    );

    const summary = summarizeTelemetry(events);
    expect(summary.measuredCostUsd).toBe(0);
    expect(summary.providerEstimatedCostUsd).toBeCloseTo(0.042);
  });
});
