#!/usr/bin/env node

import { runBridgeCli } from './bridges.js';
import { runBenchmarkCorpusCli } from './corpus.js';
import { runCalibrationCli } from './calibration.js';
import {
  buildDashboard,
  parseDashboardArguments,
  printDashboardBuild,
} from './dashboard.js';
import { runMeasurementCli } from './measurement.js';

function printHelp(): void {
  console.log(`ACR — Adaptative Context Router

Usage:
  acr classify [--json] <task>
  acr route [--json] [--record] [--context-ratio <0..1>] [--available <ids>] [--mode <observe|guarded|auto>] <task>
  acr plan [--json] [--record] [--context-ratio <0..1>] [--available <ids>] [--mode <observe|guarded|auto>] <task>
  acr bridge rtk health [--json]
  acr bridge rtk rewrite --command <shell-command> [--json]
  acr bridge serena health [--project <path>] [--json]
  acr bridge serena find-symbol --symbol <name-path> [--project <path>] [--relative-path <path>] [--include-body] [--include-info] [--json]
  acr bridge serena overview --relative-path <path> [--project <path>] [--depth <n>] [--json]
  acr measurement import-claude --file <result.json> --run <runId> [--telemetry <path>] [--json]
  acr benchmark compare --file <benchmark.json> [--json]
  acr benchmark corpus validate --file <corpus.json> [--json]
  acr calibrate analyze --file <benchmark.json> [--file <benchmark.json> ...] [--json]
  acr telemetry summary [--json] [--path <file>]
  acr dashboard build [--telemetry <file>] [--benchmark <file>] [--output <html>] [--json]
  acr demo dashboard [--output <html>] [--json]
  acr doctor [--json]
  acr status [--json]
  acr version
  acr help

Commands:
  classify    Classify task type, precision requirement and optimization risk
  route       Evaluate routing policy and select/reject optimization strategies
  plan        Convert a routing decision into safe typed adapter execution plans
  bridge      Explicitly invoke validated real execution bridges; never automatic from plan
  measurement Import provider-reported usage from explicit structured result files
  benchmark   Compare measured observations or validate a real benchmark corpus
  calibrate   Produce advisory policy calibration from measured benchmark evidence
  telemetry   Summarize local privacy-safe telemetry
  dashboard   Build a self-contained dashboard from local telemetry and measured benchmarks
  demo        Generate explicitly labeled synthetic demonstration artifacts
  doctor      Detect Claude Code and supported optimization capabilities
  status      Show ACR bootstrap/runtime status
  version     Print the ACR version`);
}

async function runDashboard(
  args: readonly string[],
  evidenceMode: 'local-telemetry' | 'synthetic-demo',
): Promise<void> {
  const options = parseDashboardArguments(args, evidenceMode);
  const result = await buildDashboard(options);
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printDashboardBuild(result);
  }
}

async function main(argv: readonly string[]): Promise<void> {
  const [command = 'help', ...args] = argv;

  if (command === 'bridge') {
    const exitCode = await runBridgeCli(args);
    if (exitCode !== 0) process.exitCode = exitCode;
    return;
  }

  if (command === 'measurement') {
    const exitCode = await runMeasurementCli(args);
    if (exitCode !== 0) process.exitCode = exitCode;
    return;
  }

  if (command === 'calibrate') {
    const exitCode = await runCalibrationCli(args);
    if (exitCode !== 0) process.exitCode = exitCode;
    return;
  }

  if (command === 'benchmark' && args[0] === 'corpus') {
    const exitCode = await runBenchmarkCorpusCli(args.slice(1));
    if (exitCode !== 0) process.exitCode = exitCode;
    return;
  }

  if (command === 'dashboard') {
    const [subcommand = 'build', ...dashboardArgs] = args;
    if (subcommand !== 'build') {
      throw new Error(
        'Usage: acr dashboard build [--telemetry <file>] [--benchmark <file>] [--output <html>] [--json]',
      );
    }
    await runDashboard(dashboardArgs, 'local-telemetry');
    return;
  }

  if (command === 'demo') {
    const [subcommand = 'dashboard', ...demoArgs] = args;
    if (subcommand !== 'dashboard') {
      throw new Error('Usage: acr demo dashboard [--output <html>] [--json]');
    }
    await runDashboard(demoArgs, 'synthetic-demo');
    return;
  }

  if (command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  await import('./index.js');
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ACR failed: ${message}`);
  process.exitCode = 1;
});
