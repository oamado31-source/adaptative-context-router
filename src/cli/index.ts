#!/usr/bin/env node

import { ACR_VERSION, createBootstrapStatus } from '../core/bootstrap-status.js';
import { CapabilityRegistry } from '../core/capability-registry.js';
import type { Capability } from '../core/contracts.js';

function printHelp(): void {
  console.log(`ACR — Adaptative Context Router\n\nUsage:\n  acr doctor [--json]\n  acr status [--json]\n  acr version\n  acr help\n\nCommands:\n  doctor   Detect Claude Code and supported optimization capabilities\n  status   Show ACR bootstrap/runtime status\n  version  Print the ACR version`);
}

function statusGlyph(capability: Capability): string {
  switch (capability.status) {
    case 'available':
      return '✓';
    case 'incompatible':
      return '!';
    case 'unknown':
      return '?';
    case 'unavailable':
      return '·';
  }
}

function printDoctor(capabilities: readonly Capability[]): void {
  console.log('ACR doctor\n');
  for (const capability of capabilities) {
    const version = capability.version ? ` — ${capability.version}` : '';
    console.log(`${statusGlyph(capability)} ${capability.name}: ${capability.status}${version}`);
    if (capability.reason) {
      console.log(`  ${capability.reason}`);
    }
  }

  const available = capabilities.filter(
    (capability) => capability.status === 'available',
  ).length;
  console.log(`\n${available}/${capabilities.length} capabilities detected.`);
}

async function main(argv: readonly string[]): Promise<void> {
  const [command = 'help', ...args] = argv;

  switch (command) {
    case 'doctor': {
      const capabilities = await new CapabilityRegistry().discover();
      if (args.includes('--json')) {
        console.log(JSON.stringify({ capabilities }, null, 2));
      } else {
        printDoctor(capabilities);
      }
      return;
    }
    case 'status': {
      const status = createBootstrapStatus();
      if (args.includes('--json')) {
        console.log(JSON.stringify(status, null, 2));
      } else {
        console.log(`${status.name}\nversion: ${status.version}\nmilestone: ${status.milestone}\nmode: ${status.mode}\nstatus: ${status.status}`);
      }
      return;
    }
    case 'version':
    case '--version':
    case '-v':
      console.log(ACR_VERSION);
      return;
    case 'help':
    case '--help':
    case '-h':
      printHelp();
      return;
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exitCode = 1;
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ACR failed: ${message}`);
  process.exitCode = 1;
});
