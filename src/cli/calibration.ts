import { compareBenchmark } from '../benchmark/harness.js';
import { loadBenchmarkInput } from '../benchmark/io.js';
import { analyzePolicyCalibration } from '../calibration/analyzer.js';
import { loadPolicyConfig } from '../core/policy-config.js';

interface CalibrationCliOptions {
  files: string[];
  json: boolean;
}

function usage(): string {
  return 'Usage: acr calibrate analyze --file <benchmark.json> [--file <benchmark.json> ...] [--json]';
}

export function parseCalibrationCliArguments(args: readonly string[]): CalibrationCliOptions {
  const files: string[] = [];
  let json = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--file') {
      const value = args[index + 1];
      if (value === undefined) throw new Error(usage());
      files.push(value);
      index += 1;
      continue;
    }
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--apply' || arg === '--write-policy') {
      throw new Error('Calibration is advisory only; automatic policy mutation is not supported.');
    }
    throw new Error(`Unknown calibration option: ${arg}. ${usage()}`);
  }

  if (files.length === 0) throw new Error(usage());
  return { files, json };
}

export async function runCalibrationCli(args: readonly string[]): Promise<number> {
  const [subcommand = 'help', ...rest] = args;
  if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    console.log(`ACR policy calibration\n\n${usage()}\n\nSafety boundary:\n  Accepts measured benchmark inputs only.\n  Produces advisory recommendations only.\n  It does not modify policies/default.yaml or any runtime policy.`);
    return 0;
  }
  if (subcommand !== 'analyze') throw new Error(usage());

  const options = parseCalibrationCliArguments(rest);
  const inputs = await Promise.all(options.files.map(loadBenchmarkInput));
  const comparisons = inputs.map(compareBenchmark);
  const policy = await loadPolicyConfig();
  const report = analyzePolicyCalibration(comparisons, policy);

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }

  console.log('ACR policy calibration');
  console.log('evidence: measured');
  console.log('policy-mutation: no');
  console.log(`comparisons: ${report.comparisons.length}`);
  console.log(`recommendations: ${report.recommendations.length}`);
  for (const item of report.recommendations) {
    console.log(`- ${item.strategyId}: ${item.disposition}`);
    console.log(`  cases: ${item.evidenceCases}`);
    console.log(`  token-delta: ${(item.meanTotalTokenReductionRatio * 100).toFixed(1)}% reduction`);
    console.log(`  current-estimated-saving: ${(item.currentEstimatedSavingRatio * 100).toFixed(1)}%`);
    if (item.proposedEstimatedSavingRatio !== undefined) {
      console.log(`  proposed-estimated-saving: ${(item.proposedEstimatedSavingRatio * 100).toFixed(1)}%`);
    }
  }
  if (report.skippedCases.length > 0) {
    console.log('skipped-cases:');
    for (const item of report.skippedCases) {
      console.log(`- ${item.caseId}: ${item.reason}`);
    }
  }
  return 0;
}
