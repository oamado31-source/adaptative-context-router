import { readFile } from 'node:fs/promises';

import { parseClaudeCodeJsonText } from '../measurement/claude-code-json.js';
import { TelemetryRecorder } from '../telemetry/recorder.js';
import { JsonlTelemetryStore } from '../telemetry/store.js';

const DEFAULT_TELEMETRY_PATH = '.acr/telemetry/events.jsonl';

interface ImportClaudeOptions {
  file: string;
  runId: string;
  telemetryPath: string;
  json: boolean;
}

function parseImportClaudeArgs(args: readonly string[]): ImportClaudeOptions {
  let file: string | undefined;
  let runId: string | undefined;
  let telemetryPath = DEFAULT_TELEMETRY_PATH;
  let json = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') {
      json = true;
      continue;
    }

    const next = args[index + 1];
    if (arg === '--file' || arg === '--run' || arg === '--telemetry') {
      if (!next || next.startsWith('--')) {
        throw new Error(`${arg} requires a value.`);
      }
      index += 1;
      if (arg === '--file') file = next;
      if (arg === '--run') runId = next;
      if (arg === '--telemetry') telemetryPath = next;
      continue;
    }

    throw new Error(`Unknown measurement option: ${arg ?? ''}`);
  }

  if (!file) {
    throw new Error('Usage: acr measurement import-claude --file <result.json> --run <runId> [--telemetry <path>] [--json]');
  }
  if (!runId || runId.trim().length === 0) {
    throw new Error('Usage: acr measurement import-claude --file <result.json> --run <runId> [--telemetry <path>] [--json]');
  }

  return { file, runId, telemetryPath, json };
}

export async function importClaudeMeasurement(
  options: ImportClaudeOptions,
): Promise<Readonly<Record<string, unknown>>> {
  const raw = await readFile(options.file, 'utf8');
  const measurement = parseClaudeCodeJsonText(raw);
  const store = new JsonlTelemetryStore(options.telemetryPath);
  const recorder = new TelemetryRecorder(store, 'claude-code');

  await recorder.recordMeasurement({
    runId: options.runId,
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
    success: measurement.success,
    provider: measurement.provider,
    measurementSource: measurement.source,
    tokenProvenance: measurement.tokenProvenance,
    latencyProvenance: measurement.latencyProvenance,
    costProvenance: measurement.costProvenance,
    ...(measurement.turns === undefined ? {} : { turns: measurement.turns }),
    ...(measurement.sessionFingerprint === undefined
      ? {}
      : { sessionFingerprint: measurement.sessionFingerprint }),
  });

  return {
    provider: measurement.provider,
    source: measurement.source,
    runId: options.runId,
    telemetryPath: options.telemetryPath,
    inputTokens: measurement.inputTokens,
    outputTokens: measurement.outputTokens,
    cacheReadTokens: measurement.cacheReadTokens,
    cacheWriteTokens: measurement.cacheWriteTokens,
    latencyMs: measurement.latencyMs,
    apiLatencyMs: measurement.apiLatencyMs ?? null,
    estimatedCostUsd: measurement.estimatedCostUsd ?? null,
    costProvenance: measurement.costProvenance,
    success: measurement.success,
    turns: measurement.turns ?? null,
    sessionFingerprint: measurement.sessionFingerprint ?? null,
  };
}

function printImportResult(result: Readonly<Record<string, unknown>>): void {
  console.log('ACR provider measurement import');
  console.log(`provider: ${String(result.provider)}`);
  console.log(`run: ${String(result.runId)}`);
  console.log(`input tokens: ${String(result.inputTokens)}`);
  console.log(`output tokens: ${String(result.outputTokens)}`);
  console.log(`cache read tokens: ${String(result.cacheReadTokens)}`);
  console.log(`cache write tokens: ${String(result.cacheWriteTokens)}`);
  console.log(`latency ms: ${String(result.latencyMs)}`);
  console.log(`estimated cost usd: ${result.estimatedCostUsd === null ? 'unavailable' : String(result.estimatedCostUsd)}`);
  console.log(`cost provenance: ${String(result.costProvenance)}`);
  console.log(`telemetry: ${String(result.telemetryPath)}`);
}

export async function runMeasurementCli(args: readonly string[]): Promise<number> {
  const [subcommand = 'help', ...subcommandArgs] = args;

  if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    console.log('Usage: acr measurement import-claude --file <result.json> --run <runId> [--telemetry <path>] [--json]');
    return 0;
  }

  if (subcommand !== 'import-claude') {
    throw new Error('Usage: acr measurement import-claude --file <result.json> --run <runId> [--telemetry <path>] [--json]');
  }

  const options = parseImportClaudeArgs(subcommandArgs);
  const result = await importClaudeMeasurement(options);
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printImportResult(result);
  }
  return 0;
}
