import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { loadBenchmarkCorpus } from '../benchmark/corpus.js';
import {
  createBenchmarkExperiment,
  finalizeBenchmarkExperiment,
  loadBenchmarkExperimentPlan,
  recordBenchmarkExperimentResult,
  summarizeBenchmarkExperiment,
  type BenchmarkExperimentPlan,
} from '../benchmark/experiment.js';

interface PrepareOptions {
  corpusPath: string;
  caseId: string;
  model: string;
  outputPath: string;
  json: boolean;
}

interface InspectOptions {
  filePath: string;
  json: boolean;
}

interface RecordOptions {
  filePath: string;
  slotId: string;
  resultPath: string;
  qualityScore: number;
  reviewBlinded: boolean;
  outputPath: string;
  json: boolean;
}

interface FinalizeOptions {
  filePath: string;
  outputPath: string;
  json: boolean;
}

function printHelp(): void {
  console.log(`ACR real A/B benchmark experiments

Usage:
  acr benchmark experiment prepare --corpus <corpus.json> --case <caseId> --model <model> --output <experiment.json> [--json]
  acr benchmark experiment inspect --file <experiment.json> [--json]
  acr benchmark experiment record --file <experiment.json> --slot <slotId> --result <claude-result.json> --quality-score <0..1> --review-blinded --output <experiment.json> [--json]
  acr benchmark experiment finalize --file <experiment.json> --output <benchmark.json> [--json]

Safety boundary:
  M14 is an operator-managed evidence ledger; it never executes Claude Code or external adapters.
  The model is explicitly operator-pinned and is not inferred from provider JSON.
  Each recorded result must come from a fresh Claude session and a blinded rubric review.
  Record follows the plan's alternating next-slot order; skipping ahead is rejected.
  Raw Claude result content is not persisted in the experiment ledger.
  Claude Code total_cost_usd remains a client estimate and is not emitted as measured benchmark cost.`);
}

function requiredValue(args: readonly string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value) throw new Error(`${option} requires a value.`);
  return value;
}

function parseQualityScore(text: string): number {
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error('--quality-score must be a number between 0 and 1.');
  }
  return value;
}

function parsePrepareOptions(args: readonly string[]): PrepareOptions {
  let corpusPath: string | undefined;
  let caseId: string | undefined;
  let model: string | undefined;
  let outputPath: string | undefined;
  let json = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case '--corpus':
        corpusPath = requiredValue(args, index, '--corpus');
        index += 1;
        break;
      case '--case':
        caseId = requiredValue(args, index, '--case');
        index += 1;
        break;
      case '--model':
        model = requiredValue(args, index, '--model');
        index += 1;
        break;
      case '--output':
        outputPath = requiredValue(args, index, '--output');
        index += 1;
        break;
      case '--json':
        json = true;
        break;
      default:
        throw new Error(`Unknown benchmark experiment prepare option: ${arg ?? ''}`);
    }
  }

  if (!corpusPath || !caseId || !model || !outputPath) {
    throw new Error(
      'Usage: acr benchmark experiment prepare --corpus <corpus.json> --case <caseId> --model <model> --output <experiment.json> [--json]',
    );
  }
  return { corpusPath, caseId, model, outputPath, json };
}

function parseInspectOptions(args: readonly string[]): InspectOptions {
  let filePath: string | undefined;
  let json = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--file') {
      filePath = requiredValue(args, index, '--file');
      index += 1;
      continue;
    }
    if (arg === '--json') {
      json = true;
      continue;
    }
    throw new Error(`Unknown benchmark experiment inspect option: ${arg ?? ''}`);
  }

  if (!filePath) {
    throw new Error('Usage: acr benchmark experiment inspect --file <experiment.json> [--json]');
  }
  return { filePath, json };
}

function parseRecordOptions(args: readonly string[]): RecordOptions {
  let filePath: string | undefined;
  let slotId: string | undefined;
  let resultPath: string | undefined;
  let qualityScore: number | undefined;
  let reviewBlinded = false;
  let outputPath: string | undefined;
  let json = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case '--file':
        filePath = requiredValue(args, index, '--file');
        index += 1;
        break;
      case '--slot':
        slotId = requiredValue(args, index, '--slot');
        index += 1;
        break;
      case '--result':
        resultPath = requiredValue(args, index, '--result');
        index += 1;
        break;
      case '--quality-score':
        qualityScore = parseQualityScore(requiredValue(args, index, '--quality-score'));
        index += 1;
        break;
      case '--review-blinded':
        reviewBlinded = true;
        break;
      case '--output':
        outputPath = requiredValue(args, index, '--output');
        index += 1;
        break;
      case '--json':
        json = true;
        break;
      default:
        throw new Error(`Unknown benchmark experiment record option: ${arg ?? ''}`);
    }
  }

  if (!filePath || !slotId || !resultPath || qualityScore === undefined || !outputPath) {
    throw new Error(
      'Usage: acr benchmark experiment record --file <experiment.json> --slot <slotId> --result <claude-result.json> --quality-score <0..1> --review-blinded --output <experiment.json> [--json]',
    );
  }
  if (!reviewBlinded) {
    throw new Error('Experiment record requires explicit --review-blinded confirmation.');
  }
  return {
    filePath,
    slotId,
    resultPath,
    qualityScore,
    reviewBlinded,
    outputPath,
    json,
  };
}

function parseFinalizeOptions(args: readonly string[]): FinalizeOptions {
  let filePath: string | undefined;
  let outputPath: string | undefined;
  let json = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--file') {
      filePath = requiredValue(args, index, '--file');
      index += 1;
      continue;
    }
    if (arg === '--output') {
      outputPath = requiredValue(args, index, '--output');
      index += 1;
      continue;
    }
    if (arg === '--json') {
      json = true;
      continue;
    }
    throw new Error(`Unknown benchmark experiment finalize option: ${arg ?? ''}`);
  }

  if (!filePath || !outputPath) {
    throw new Error(
      'Usage: acr benchmark experiment finalize --file <experiment.json> --output <benchmark.json> [--json]',
    );
  }
  return { filePath, outputPath, json };
}

async function writeJson(path: string, value: unknown): Promise<string> {
  const outputPath = resolve(path);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return outputPath;
}

function summaryWithPath(plan: BenchmarkExperimentPlan, path?: string) {
  const summary = summarizeBenchmarkExperiment(plan);
  return {
    ...summary,
    ...(path ? { path: resolve(path) } : {}),
  };
}

function printSummary(label: string, summary: ReturnType<typeof summaryWithPath>): void {
  console.log(`${label}\n`);
  console.log(`experiment: ${summary.id}`);
  console.log(`case: ${summary.caseId}`);
  console.log(`model: ${summary.model} (operator-pinned)`);
  console.log(`revision: ${summary.targetRevision}`);
  console.log(`expected-strategy: ${summary.expectedStrategy}`);
  console.log(`execution: ${summary.execution ? 'yes' : 'no'}`);
  console.log(`recorded: ${summary.recordedSlots}/${summary.totalSlots}`);
  console.log(`pending: ${summary.pendingSlots}`);
  if (summary.nextSlot) {
    console.log(
      `next: ${summary.nextSlot.id} [${summary.nextSlot.arm}; ${summary.nextSlot.protocol}; ${summary.nextSlot.plannedStrategy}]`,
    );
  } else {
    console.log('next: none');
  }
  if (summary.path) console.log(`path: ${summary.path}`);
}

async function prepareExperiment(args: readonly string[]): Promise<number> {
  const options = parsePrepareOptions(args);
  const corpus = await loadBenchmarkCorpus(options.corpusPath);
  const plan = createBenchmarkExperiment(corpus, options.caseId, options.model);
  const outputPath = await writeJson(options.outputPath, plan);
  const summary = summaryWithPath(plan, outputPath);

  if (options.json) console.log(JSON.stringify(summary, null, 2));
  else printSummary('ACR benchmark experiment prepare', summary);
  return 0;
}

async function inspectExperiment(args: readonly string[]): Promise<number> {
  const options = parseInspectOptions(args);
  const plan = await loadBenchmarkExperimentPlan(options.filePath);
  const summary = summaryWithPath(plan, options.filePath);

  if (options.json) console.log(JSON.stringify(summary, null, 2));
  else printSummary('ACR benchmark experiment inspect', summary);
  return 0;
}

async function recordExperiment(args: readonly string[]): Promise<number> {
  const options = parseRecordOptions(args);
  const plan = await loadBenchmarkExperimentPlan(options.filePath);
  const nextSlot = plan.slots.find((slot) => slot.status === 'pending');
  if (nextSlot === undefined) {
    throw new Error('Experiment is already complete; there is no pending slot to record.');
  }
  if (options.slotId !== nextSlot.id) {
    throw new Error(
      `Experiment order violation: next slot is ${nextSlot.id}; received ${options.slotId}.`,
    );
  }

  const claudeResultText = await readFile(options.resultPath, 'utf8');
  const updated = recordBenchmarkExperimentResult(
    plan,
    options.slotId,
    claudeResultText,
    options.qualityScore,
    options.reviewBlinded,
  );
  const outputPath = await writeJson(options.outputPath, updated);
  const summary = summaryWithPath(updated, outputPath);

  if (options.json) console.log(JSON.stringify(summary, null, 2));
  else printSummary('ACR benchmark experiment record', summary);
  return 0;
}

async function finalizeExperiment(args: readonly string[]): Promise<number> {
  const options = parseFinalizeOptions(args);
  const plan = await loadBenchmarkExperimentPlan(options.filePath);
  const benchmark = finalizeBenchmarkExperiment(plan);
  const outputPath = await writeJson(options.outputPath, benchmark);
  const result = {
    experimentId: plan.id,
    caseId: benchmark.case.id,
    evidenceMode: 'real' as const,
    execution: false as const,
    baselineSamples: benchmark.baseline.length,
    acrSamples: benchmark.acr.length,
    minimumQualityScore: benchmark.case.minimumQualityScore,
    costIncluded: benchmark.baseline.some((item) => item.costUsd !== undefined) ||
      benchmark.acr.some((item) => item.costUsd !== undefined),
    path: outputPath,
  };

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log('ACR benchmark experiment finalize\n');
    console.log(`experiment: ${result.experimentId}`);
    console.log(`case: ${result.caseId}`);
    console.log(`evidence: ${result.evidenceMode}`);
    console.log(`execution: ${result.execution ? 'yes' : 'no'}`);
    console.log(`samples: baseline=${result.baselineSamples}, acr=${result.acrSamples}`);
    console.log(`minimum-quality: ${result.minimumQualityScore ?? 'none'}`);
    console.log(`measured-cost: ${result.costIncluded ? 'included' : 'omitted'}`);
    console.log(`output: ${result.path}`);
  }
  return 0;
}

export async function runBenchmarkExperimentCli(args: readonly string[]): Promise<number> {
  const [subcommand = 'help', ...rest] = args;
  if (subcommand === 'prepare') return prepareExperiment(rest);
  if (subcommand === 'inspect') return inspectExperiment(rest);
  if (subcommand === 'record') return recordExperiment(rest);
  if (subcommand === 'finalize') return finalizeExperiment(rest);
  if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    printHelp();
    return 0;
  }
  throw new Error(`Unknown benchmark experiment command: ${subcommand}`);
}
