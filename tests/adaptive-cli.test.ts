import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadAdaptiveRoutingProfile } from '../src/adaptive/profile.js';
import { runAdaptiveCli } from '../src/cli/adaptive.js';

const tempDirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'acr-adaptive-'));
  tempDirs.push(dir);
  return dir;
}

async function writeCalibrationReport(path: string): Promise<void> {
  await writeFile(
    path,
    `${JSON.stringify(
      {
        measured: true,
        policyMutation: false,
        comparisons: [],
        recommendations: [
          {
            strategyId: 'serena',
            disposition: 'promote',
            evidenceCases: 2,
            baselineSamples: 6,
            acrSamples: 6,
            qualityFailures: 0,
            meanTotalTokenReductionRatio: 0.25,
            meanLatencyReductionRatio: 0.1,
            currentEstimatedSavingRatio: 0.62,
            proposedEstimatedSavingRatio: 0.25,
            policyMutation: false,
            rationale: ['Synthetic CLI fixture only.'],
          },
        ],
        skippedCases: [],
        thresholds: {
          minimumCasesPerStrategy: 2,
          minimumSamplesPerArmPerCase: 3,
          minimumPromoteTokenReductionRatio: 0.05,
          maximumEstimatedSavingRatio: 0.9,
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe('adaptive profile CLI', () => {
  it('refuses to create a runtime profile without explicit approval', async () => {
    const dir = await tempDir();
    const calibrationPath = join(dir, 'calibration.json');
    const outputPath = join(dir, 'profile.json');
    await writeCalibrationReport(calibrationPath);

    await expect(
      runAdaptiveCli([
        'profile',
        'create',
        '--calibration',
        calibrationPath,
        '--id',
        'cli-profile',
        '--output',
        outputPath,
      ]),
    ).rejects.toThrow(/explicit --approve/i);

    await expect(readFile(outputPath, 'utf8')).rejects.toThrow();
  });

  it('creates and inspects an explicitly approved measured-evidence profile', async () => {
    const dir = await tempDir();
    const calibrationPath = join(dir, 'calibration.json');
    const outputPath = join(dir, 'profile.json');
    await writeCalibrationReport(calibrationPath);

    await expect(
      runAdaptiveCli([
        'profile',
        'create',
        '--calibration',
        calibrationPath,
        '--id',
        'cli-profile',
        '--output',
        outputPath,
        '--approve',
        '--json',
      ]),
    ).resolves.toBe(0);

    const profile = await loadAdaptiveRoutingProfile(outputPath);
    expect(profile).toMatchObject({
      profileId: 'cli-profile',
      approved: true,
      evidenceMode: 'measured',
      source: 'm12-calibration',
    });
    expect(profile.rules).toHaveLength(1);
    expect(profile.rules[0]).toMatchObject({
      strategyId: 'serena',
      action: 'tune',
      estimatedSavingRatio: 0.25,
    });

    await expect(
      runAdaptiveCli(['profile', 'inspect', '--file', outputPath, '--json']),
    ).resolves.toBe(0);
  });

  it('rejects calibration input that is not measured advisory evidence', async () => {
    const dir = await tempDir();
    const calibrationPath = join(dir, 'invalid.json');
    const outputPath = join(dir, 'profile.json');
    await writeFile(
      calibrationPath,
      JSON.stringify({ measured: false, policyMutation: false, recommendations: [] }),
      'utf8',
    );

    await expect(
      runAdaptiveCli([
        'profile',
        'create',
        '--calibration',
        calibrationPath,
        '--id',
        'invalid-profile',
        '--output',
        outputPath,
        '--approve',
      ]),
    ).rejects.toThrow(/measured advisory M12 calibration report/i);
  });
});
