#!/usr/bin/env node

import {
  buildDashboard,
  parseDashboardArguments,
  printDashboardBuild,
} from './dashboard.js';

function printHelp(): void {
  console.log(`ACR — Adaptative Context Router

Usage:
  acr classify [--json] <task>
  acr route [--json] [--record] [--context-ratio <0..1>] [--available <ids>] [--mode <observe|guarded|auto>] <task>
  acr plan [--json] [--record] [--context-ratio <0..1>] [--available <ids>] [--mode <observe|guarded|auto>] <task>
  acr benchmark compare --file <benchmark.json> [--json]
  acr telemetry summary [--json] [--path <file>]
  acr dashboard build [--telemetry <file>] [--benchmark <file>] [--output <html>] [--json]
  acr demo dashboard [--output <html>] [--json]
  acr doctor [--json]
  acr status [--json]
  acr version
  acr help

Commands:
  classify  Classify task type, precision requirement and optimization risk
  route     Evaluate routing policy and select/reject optimization strategies
  plan      Convert a routing decision into safe typed adapter execution plans
  benchmark Compare measured baseline vs ACR observations with a quality gate
  telemetry Summarize local privacy-safe telemetry
  dashboard Build a self-contained dashboard from local telemetry and measured benchmarks
  demo      Generate explicitly labeled synthetic demonstration artifacts
  doctor    Detect Claude Code and supported optimization capabilities
  status    Show ACR bootstrap/runtime status
  version   Print the ACR version`);
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
