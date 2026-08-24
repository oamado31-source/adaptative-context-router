import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import type { CalibrationReport } from '../calibration/contracts.js';
import {
  buildAdaptiveRoutingProfile,
  fingerprintAdaptiveRoutingProfile,
  loadAdaptiveRoutingProfile,
} from '../adaptive/profile.js';

interface CreateOptions {
  calibrationPath: string;
  profileId: string;
  outputPath: string;
  approve: boolean;
  json: boolean;
}

interface InspectOptions {
  filePath: string;
  json: boolean;
}

function printHelp(): void {
  console.log(`ACR adaptive routing

Usage:
  acr adaptive profile create --calibration <report.json> --id <profileId> --output <profile.json> --approve [--json]
  acr adaptive profile inspect --file <profile.json> [--json]

Safety boundary:
  Adaptive profiles require measured M12 calibration evidence and explicit --approve.
  Profile creation writes only the explicit --output artifact.
  It does not modify policies/default.yaml or enable a profile automatically.
  Runtime use remains opt-in through --adaptive-profile <profile.json>.`);
}

function parseCreateOptions(args: readonly string[]): CreateOptions {
  let calibrationPath: string | undefined;
  let profileId: string | undefined;
  let outputPath: string | undefined;
  let approve = false;
  let json = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case '--calibration': {
        const value = args[index + 1];
        if (!value) throw new Error('--calibration requires a file path.');
        calibrationPath = value;
        index += 1;
        break;
      }
      case '--id': {
        const value = args[index + 1];
        if (!value) throw new Error('--id requires a profile ID.');
        profileId = value;
        index += 1;
        break;
      }
      case '--output': {
        const value = args[index + 1];
        if (!value) throw new Error('--output requires a file path.');
        outputPath = value;
        index += 1;
        break;
      }
      case '--approve':
        approve = true;
        break;
      case '--json':
        json = true;
        break;
      default:
        throw new Error(`Unknown adaptive profile create option: ${arg ?? ''}`);
    }
  }

  if (!calibrationPath || !profileId || !outputPath) {
    throw new Error(
      'Usage: acr adaptive profile create --calibration <report.json> --id <profileId> --output <profile.json> --approve [--json]',
    );
  }
  if (!approve) {
    throw new Error('Adaptive profile creation requires explicit --approve.');
  }

  return { calibrationPath, profileId, outputPath, approve, json };
}

function parseInspectOptions(args: readonly string[]): InspectOptions {
  let filePath: string | undefined;
  let json = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--file') {
      const value = args[index + 1];
      if (!value) throw new Error('--file requires a file path.');
      filePath = value;
      index += 1;
      continue;
    }
    if (arg === '--json') {
      json = true;
      continue;
    }
    throw new Error(`Unknown adaptive profile inspect option: ${arg ?? ''}`);
  }

  if (!filePath) {
    throw new Error('Usage: acr adaptive profile inspect --file <profile.json> [--json]');
  }
  return { filePath, json };
}

async function loadCalibrationReport(path: string): Promise<CalibrationReport> {
  const raw = await readFile(path, 'utf8');
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Calibration report must be valid JSON: ${message}`);
  }

  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    (value as Record<string, unknown>).measured !== true ||
    (value as Record<string, unknown>).policyMutation !== false ||
    !Array.isArray((value as Record<string, unknown>).recommendations)
  ) {
    throw new Error(
      'Adaptive profile creation requires a measured advisory M12 calibration report.',
    );
  }

  return value as CalibrationReport;
}

function profileSummary(
  profile: Awaited<ReturnType<typeof loadAdaptiveRoutingProfile>>,
  path?: string,
) {
  return {
    profileId: profile.profileId,
    approved: profile.approved,
    evidenceMode: profile.evidenceMode,
    source: profile.source,
    rules: profile.rules.length,
    tunedStrategies: profile.rules
      .filter((rule) => rule.action === 'tune')
      .map((rule) => rule.strategyId),
    blockedStrategies: profile.rules
      .filter((rule) => rule.action === 'block')
      .map((rule) => rule.strategyId),
    fingerprint: fingerprintAdaptiveRoutingProfile(profile),
    ...(path ? { path: resolve(path) } : {}),
  };
}

async function createProfile(args: readonly string[]): Promise<number> {
  const options = parseCreateOptions(args);
  const report = await loadCalibrationReport(options.calibrationPath);
  const profile = buildAdaptiveRoutingProfile(
    report,
    options.profileId,
    options.approve,
  );

  const outputPath = resolve(options.outputPath);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(profile, null, 2)}\n`, 'utf8');

  const summary = profileSummary(profile, outputPath);
  if (options.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log('ACR adaptive profile create\n');
    console.log(`profile: ${summary.profileId}`);
    console.log(`approved: ${summary.approved ? 'yes' : 'no'}`);
    console.log(`evidence: ${summary.evidenceMode}`);
    console.log(`rules: ${summary.rules}`);
    console.log(`fingerprint: ${summary.fingerprint}`);
    console.log(`output: ${summary.path}`);
  }
  return 0;
}

async function inspectProfile(args: readonly string[]): Promise<number> {
  const options = parseInspectOptions(args);
  const profile = await loadAdaptiveRoutingProfile(options.filePath);
  const summary = profileSummary(profile, options.filePath);

  if (options.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log('ACR adaptive profile inspect\n');
    console.log(`profile: ${summary.profileId}`);
    console.log(`approved: ${summary.approved ? 'yes' : 'no'}`);
    console.log(`evidence: ${summary.evidenceMode}`);
    console.log(`rules: ${summary.rules}`);
    console.log(`tuned: ${summary.tunedStrategies.join(', ') || 'none'}`);
    console.log(`blocked: ${summary.blockedStrategies.join(', ') || 'none'}`);
    console.log(`fingerprint: ${summary.fingerprint}`);
  }
  return 0;
}

export async function runAdaptiveCli(args: readonly string[]): Promise<number> {
  const [section = 'help', subcommand = 'help', ...rest] = args;
  if (section === 'help' || section === '--help' || section === '-h') {
    printHelp();
    return 0;
  }
  if (section !== 'profile') {
    throw new Error(`Unknown adaptive section: ${section}`);
  }
  if (subcommand === 'create') return createProfile(rest);
  if (subcommand === 'inspect') return inspectProfile(rest);
  if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    printHelp();
    return 0;
  }
  throw new Error(`Unknown adaptive profile command: ${subcommand}`);
}
