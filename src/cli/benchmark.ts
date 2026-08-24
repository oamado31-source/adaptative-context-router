import type { BenchmarkComparison } from '../benchmark/contracts.js';
import { compareBenchmark } from '../benchmark/harness.js';
import { loadBenchmarkInput } from '../benchmark/io.js';

export interface BenchmarkCliArguments {
  json: boolean;
  path: string;
}

export function parseBenchmarkCliArguments(
  args: readonly string[],
): BenchmarkCliArguments {
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
      if (!raw) throw new Error('--file requires a benchmark JSON path.');
      path = raw;
      index += 1;
      continue;
    }
    throw new Error(`Unknown benchmark option: ${arg ?? ''}`);
  }

  if (!path) {
    throw new Error('Usage: acr benchmark compare --file <benchmark.json> [--json]');
  }

  return { json, path };
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function printBenchmarkComparison(
  comparison: BenchmarkComparison,
): void {
  console.log('ACR benchmark compare\n');
  console.log(`case: ${comparison.case.id}`);
  console.log(`task-type: ${comparison.case.taskType}`);
  console.log(`strategy: ${comparison.case.strategy ?? 'unspecified'}`);
  console.log('evidence: measured');
  console.log(`outcome: ${comparison.outcome}`);
  console.log(`quality-gate: ${comparison.qualityGate.passed ? 'PASS' : 'FAIL'}`);
  console.log(
    `samples: baseline=${comparison.baseline.samples}, acr=${comparison.acr.samples}`,
  );
  console.log(
    `mean-total-tokens: baseline=${comparison.baseline.meanTotalTokens.toFixed(1)}, acr=${comparison.acr.meanTotalTokens.toFixed(1)}`,
  );
  console.log(
    `input-token-reduction: ${percent(comparison.deltas.inputTokenReductionRatio)}`,
  );
  console.log(
    `total-token-reduction: ${percent(comparison.deltas.totalTokenReductionRatio)}`,
  );
  console.log(
    `latency-reduction: ${percent(comparison.deltas.latencyReductionRatio)}`,
  );
  console.log(
    `cost-reduction: ${comparison.deltas.costReductionRatio === undefined ? 'not-comparable' : percent(comparison.deltas.costReductionRatio)}`,
  );
  console.log(`quality-delta: ${comparison.deltas.qualityDelta.toFixed(3)}`);
  console.log(
    `success-rate-delta: ${(comparison.deltas.successRateDelta * 100).toFixed(1)}pp`,
  );

  console.log('\nrationale:');
  for (const item of comparison.rationale) {
    console.log(`- ${item}`);
  }
}

export async function runBenchmarkComparison(
  options: BenchmarkCliArguments,
): Promise<BenchmarkComparison> {
  return compareBenchmark(await loadBenchmarkInput(options.path));
}
