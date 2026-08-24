import type { BenchmarkCorpusSummary } from '../benchmark/corpus.js';
import {
  loadBenchmarkCorpus,
  summarizeBenchmarkCorpus,
} from '../benchmark/corpus.js';

export interface BenchmarkCorpusCliArguments {
  json: boolean;
  path: string;
}

export function parseBenchmarkCorpusCliArguments(
  args: readonly string[],
): BenchmarkCorpusCliArguments {
  let json = false;
  let path: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--file') {
      const raw = args[index + 1];
      if (!raw) throw new Error('--file requires a corpus JSON path.');
      path = raw;
      index += 1;
      continue;
    }
    throw new Error(`Unknown benchmark corpus option: ${arg ?? ''}`);
  }

  if (!path) {
    throw new Error(
      'Usage: acr benchmark corpus validate --file <corpus.json> [--json]',
    );
  }

  return { json, path };
}

function printCounts(title: string, counts: Readonly<Record<string, number>>): void {
  const entries = Object.entries(counts).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  if (entries.length === 0) return;

  console.log(`\n${title}:`);
  for (const [key, count] of entries) {
    console.log(`- ${key}: ${count}`);
  }
}

export function printBenchmarkCorpusSummary(summary: BenchmarkCorpusSummary): void {
  console.log('ACR benchmark corpus validate\n');
  console.log(`corpus: ${summary.id}`);
  console.log(`evidence: ${summary.evidenceMode}`);
  console.log(`provider: ${summary.provider}`);
  console.log(`target: ${summary.repository}@${summary.revision}`);
  console.log(`cases: ${summary.totalCases}`);
  console.log(`repetitions-per-arm: ${summary.repetitionsPerArm}`);
  console.log(`no-optimization-cases: ${summary.noOptimizationCases}`);
  console.log('execution: none — corpus validation only');

  printCounts('task-types', summary.taskTypes);
  printCounts('required-capabilities', summary.requiredCapabilities);

  if (summary.coverageNotes.length > 0) {
    console.log('\ncoverage-notes:');
    for (const note of summary.coverageNotes) {
      console.log(`- ${note}`);
    }
  }
}

function printHelp(): void {
  console.log(`ACR benchmark corpus\n\nUsage:\n  acr benchmark corpus validate --file <corpus.json> [--json]\n\nSafety boundary:\n  Corpus validation reads and validates the manifest only.\n  It does not run Claude Code, execute adapters, or claim token savings.`);
}

export async function runBenchmarkCorpusCli(args: readonly string[]): Promise<number> {
  const [subcommand = 'help', ...rest] = args;
  if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    printHelp();
    return 0;
  }
  if (subcommand !== 'validate') {
    throw new Error(
      'Usage: acr benchmark corpus validate --file <corpus.json> [--json]',
    );
  }

  const options = parseBenchmarkCorpusCliArguments(rest);
  const corpus = await loadBenchmarkCorpus(options.path);
  const summary = summarizeBenchmarkCorpus(corpus);

  if (options.json) {
    console.log(JSON.stringify({ valid: true, execution: false, summary }, null, 2));
  } else {
    printBenchmarkCorpusSummary(summary);
  }
  return 0;
}
