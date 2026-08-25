import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import {
  buildBenchmarkCampaign,
  loadBenchmarkCampaign,
} from '../benchmark/campaign.js';
import {
  assembleBenchmarkInput,
  createBenchmarkEvidenceLedger,
  loadBenchmarkEvidenceLedger,
  recordBenchmarkEvidence,
} from '../benchmark/evidence.js';
import { loadBenchmarkCorpus } from '../benchmark/corpus.js';
import { CapabilityRegistry } from '../core/capability-registry.js';
import { parseClaudeCodeJsonText } from '../measurement/claude-code-json.js';

interface ParsedArguments {
  values: Map<string, string>;
  flags: Set<string>;
}

function parseArguments(args: readonly string[]): ParsedArguments {
  const values = new Map<string, string>();
  const flags = new Set<string>();

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token?.startsWith('--')) {
      throw new Error(`Unexpected argument: ${token ?? ''}`);
    }
    if (token === '--json') {
      flags.add(token);
      continue;
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`${token} requires a value.`);
    }
    values.set(token, value);
    index += 1;
  }

  return { values, flags };
}

function requiredValue(parsed: ParsedArguments, key: string): string {
  const value = parsed.values.get(key);
  if (!value) throw new Error(`${key} is required.`);
  return value;
}

function parseQualityScore(value: string): number {
  const score = Number(value);
  if (!Number.isFinite(score) || score < 0 || score > 1) {
    throw new Error('--quality-score must be between 0 and 1.');
  }
  return score;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function prepareCampaign(parsed: ParsedArguments): Promise<unknown> {
  const corpusPath = requiredValue(parsed, '--corpus');
  const model = requiredValue(parsed, '--model');
  const output = requiredValue(parsed, '--output');
  const corpus = await loadBenchmarkCorpus(corpusPath);
  const explicitAvailable = parsed.values.get('--available');
  const availableCapabilities = explicitAvailable
    ? explicitAvailable
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : (await new CapabilityRegistry().discover())
        .filter((capability) => capability.status === 'available')
        .map((capability) => capability.id);
  const campaign = buildBenchmarkCampaign(corpus, {
    model,
    availableCapabilities,
  });
  await writeJson(output, campaign);

  const blocked = campaign.cases
    .filter((item) => item.status === 'blocked')
    .map((item) => ({
      caseId: item.id,
      missingCapabilities: item.missingCapabilities,
    }));
  return {
    campaignId: campaign.id,
    evidenceMode: campaign.evidenceMode,
    model: campaign.model,
    targetRevision: campaign.target.revision,
    readyCases: campaign.cases.filter((item) => item.status === 'ready').length,
    blockedCases: blocked.length,
    blocked,
    plannedRuns: campaign.runs.length,
    externalExecution: campaign.externalExecution,
    output,
  };
}

async function loadOrCreateLedger(
  campaignPath: string,
  evidencePath: string,
) {
  const campaign = await loadBenchmarkCampaign(campaignPath);
  try {
    return {
      campaign,
      ledger: await loadBenchmarkEvidenceLedger(evidencePath),
    };
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String(error.code)
        : undefined;
    if (code !== 'ENOENT') throw error;
    return {
      campaign,
      ledger: createBenchmarkEvidenceLedger(campaign),
    };
  }
}

async function recordEvidence(parsed: ParsedArguments): Promise<unknown> {
  const campaignPath = requiredValue(parsed, '--campaign');
  const runId = requiredValue(parsed, '--run');
  const providerResultPath = requiredValue(parsed, '--provider-result');
  const evidencePath = requiredValue(parsed, '--evidence');
  const qualityScore = parseQualityScore(
    requiredValue(parsed, '--quality-score'),
  );
  const { campaign, ledger } = await loadOrCreateLedger(
    campaignPath,
    evidencePath,
  );
  const rawProviderResult = await readFile(providerResultPath, 'utf8');
  const measurement = parseClaudeCodeJsonText(rawProviderResult);
  const nextLedger = recordBenchmarkEvidence(
    campaign,
    ledger,
    runId,
    measurement,
    qualityScore,
  );
  await writeJson(evidencePath, nextLedger);
  return {
    campaignId: campaign.id,
    runId,
    recorded: true,
    measured: true,
    qualityScore,
    evidenceRecords: nextLedger.records.length,
    estimatedCostUsd: measurement.estimatedCostUsd ?? null,
    measuredCostUsd: null,
    evidence: evidencePath,
  };
}

async function assembleCase(parsed: ParsedArguments): Promise<unknown> {
  const campaignPath = requiredValue(parsed, '--campaign');
  const evidencePath = requiredValue(parsed, '--evidence');
  const caseId = requiredValue(parsed, '--case');
  const output = requiredValue(parsed, '--output');
  const campaign = await loadBenchmarkCampaign(campaignPath);
  const ledger = await loadBenchmarkEvidenceLedger(evidencePath);
  const benchmark = assembleBenchmarkInput(campaign, ledger, caseId);
  await writeJson(output, benchmark);
  return {
    campaignId: campaign.id,
    caseId,
    baselineSamples: benchmark.baseline.length,
    acrSamples: benchmark.acr.length,
    minimumQualityScore: benchmark.case.minimumQualityScore ?? null,
    measured: true,
    output,
  };
}

function printHelp(): void {
  console.log(`ACR real benchmark campaign\n\nUsage:\n  acr benchmark campaign prepare --corpus <corpus.json> --model <model> --output <campaign.json> [--available <ids>] [--json]\n  acr benchmark campaign record --campaign <campaign.json> --run <runId> --provider-result <result.json> --quality-score <0..1> --evidence <evidence.json> [--json]\n  acr benchmark campaign assemble --campaign <campaign.json> --evidence <evidence.json> --case <caseId> --output <benchmark.json> [--json]\n\nSafety boundary:\n  prepare never executes Claude or optimization tools.\n  record stores only parsed provider usage plus blinded quality, never raw result text.\n  Claude client cost estimates remain estimates and are not promoted to measured benchmark cost.\n  blocked capability cases do not produce benchmark runs or evidence.`);
}

export async function runBenchmarkCampaignCli(
  args: readonly string[],
): Promise<number> {
  const [subcommand = 'help', ...rest] = args;
  if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    printHelp();
    return 0;
  }

  const parsed = parseArguments(rest);
  let result: unknown;
  if (subcommand === 'prepare') {
    result = await prepareCampaign(parsed);
  } else if (subcommand === 'record') {
    result = await recordEvidence(parsed);
  } else if (subcommand === 'assemble') {
    result = await assembleCase(parsed);
  } else {
    throw new Error('Expected benchmark campaign prepare, record, assemble, or help.');
  }

  if (parsed.flags.has('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(result);
  }
  return 0;
}
