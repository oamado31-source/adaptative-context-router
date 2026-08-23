#!/usr/bin/env node

import { ACR_VERSION, createBootstrapStatus } from '../core/bootstrap-status.js';

function printHelp(): void {
  console.log(`ACR — Adaptative Context Router\n\nUsage:\n  acr status [--json]\n  acr version\n  acr help\n\nMilestone M0 provides the CLI scaffold. Capability discovery lands in M1.`);
}

function main(argv: readonly string[]): void {
  const [command = 'help', ...args] = argv;

  switch (command) {
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

main(process.argv.slice(2));
