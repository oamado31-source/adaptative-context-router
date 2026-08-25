import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runBenchmarkExperimentCli } from '../src/cli/experiment.js';

const tempDirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'acr-experiment-'));
  tempDirs.push(dir);
  return dir;
}

async function writeCorpus(path: string): Promise<void> {
  await writeFile(
    path,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        id: 'cli-real-v1',
        evidenceMode: 'real',
        provider: 'claude-code',
        target: {
          repository: 'owner/repo',
          revision: '0123456789abcdef0123456789abcdef01234567',
        },
        controls: {
          repetitionsPerArm: 3,
          samePrompt: true,
          sameProviderModel: true,
          sessionPersistence: false,
          armOrder: 'alternating',
          qualityEvaluation: 'blinded-rubric',
        },
        cases: [
          {
            id: 'cli-case',
            taskType: 'targeted_code_search',
            task: 'Find the target symbol.',
            requiredCapabilities: ['serena'],
            expectedStrategy: 'serena',
            targetPaths: ['src/example.ts'],
            quality: {
              minimumScore: 0.95,
              assertions: ['Names the correct file.'],
            },
          },
        ],
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

async function writeClaudeResult(path: string, sequence: number, arm: 'baseline' | 'acr'): Promise<void> {
  await writeFile(
    path,
    `${JSON.stringify({
      type: 'result',
      session_id: `cli-session-${sequence}`,
      is_error: false,
      duration_ms: arm === 'baseline' ? 1200 : 900,
      duration_api_ms: arm === 'baseline' ? 1000 : 700,
      total_cost_usd: 0.01,
      num_turns: 1,
      result: `RAW CLI RESULT ${sequence}`,
      usage: {
        input_tokens: arm === 'baseline' ? 1000 : 700,
        output_tokens: 100,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    })}\n`,
    'utf8',
  );
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe('benchmark experiment CLI', () => {
  it('prepares a non-executing real experiment and inspects it', async () => {
    const dir = await tempDir();
    const corpusPath = join(dir, 'corpus.json');
    const planPath = join(dir, 'experiment.json');
    await writeCorpus(corpusPath);

    await expect(
      runBenchmarkExperimentCli([
        'prepare',
        '--corpus',
        corpusPath,
        '--case',
        'cli-case',
        '--model',
        'claude-model-pinned',
        '--output',
        planPath,
        '--json',
      ]),
    ).resolves.toBe(0);

    const plan = JSON.parse(await readFile(planPath, 'utf8')) as Record<string, unknown>;
    expect(plan.evidenceMode).toBe('real');
    expect(plan.execution).toBe(false);
    expect(plan.modelProvenance).toBe('operator-pinned');
    expect(Array.isArray(plan.slots)).toBe(true);
    expect((plan.slots as unknown[]).length).toBe(6);

    await expect(
      runBenchmarkExperimentCli(['inspect', '--file', planPath, '--json']),
    ).resolves.toBe(0);
  });

  it('requires blinded review and rejects recording out of alternating order', async () => {
    const dir = await tempDir();
    const corpusPath = join(dir, 'corpus.json');
    const planPath = join(dir, 'experiment.json');
    const resultPath = join(dir, 'result.json');
    await writeCorpus(corpusPath);
    await runBenchmarkExperimentCli([
      'prepare',
      '--corpus', corpusPath,
      '--case', 'cli-case',
      '--model', 'claude-model-pinned',
      '--output', planPath,
    ]);
    await writeClaudeResult(resultPath, 1, 'baseline');

    await expect(
      runBenchmarkExperimentCli([
        'record',
        '--file', planPath,
        '--slot', 'cli-case:r1:baseline',
        '--result', resultPath,
        '--quality-score', '0.96',
        '--output', planPath,
      ]),
    ).rejects.toThrow(/--review-blinded/i);

    await expect(
      runBenchmarkExperimentCli([
        'record',
        '--file', planPath,
        '--slot', 'cli-case:r1:acr',
        '--result', resultPath,
        '--quality-score', '0.96',
        '--review-blinded',
        '--output', planPath,
      ]),
    ).rejects.toThrow(/order violation/i);
  });

  it('records all six slots in order and finalizes a measured benchmark without cost promotion', async () => {
    const dir = await tempDir();
    const corpusPath = join(dir, 'corpus.json');
    const planPath = join(dir, 'experiment.json');
    const benchmarkPath = join(dir, 'benchmark.json');
    await writeCorpus(corpusPath);
    await runBenchmarkExperimentCli([
      'prepare',
      '--corpus', corpusPath,
      '--case', 'cli-case',
      '--model', 'claude-model-pinned',
      '--output', planPath,
    ]);

    const schedule: Array<[string, 'baseline' | 'acr']> = [
      ['cli-case:r1:baseline', 'baseline'],
      ['cli-case:r1:acr', 'acr'],
      ['cli-case:r2:acr', 'acr'],
      ['cli-case:r2:baseline', 'baseline'],
      ['cli-case:r3:baseline', 'baseline'],
      ['cli-case:r3:acr', 'acr'],
    ];

    for (let index = 0; index < schedule.length; index += 1) {
      const [slotId, arm] = schedule[index]!;
      const resultPath = join(dir, `result-${index + 1}.json`);
      await writeClaudeResult(resultPath, index + 1, arm);
      await expect(
        runBenchmarkExperimentCli([
          'record',
          '--file', planPath,
          '--slot', slotId,
          '--result', resultPath,
          '--quality-score', '0.96',
          '--review-blinded',
          '--output', planPath,
        ]),
      ).resolves.toBe(0);
    }

    await expect(
      runBenchmarkExperimentCli([
        'finalize',
        '--file', planPath,
        '--output', benchmarkPath,
        '--json',
      ]),
    ).resolves.toBe(0);

    const benchmark = JSON.parse(await readFile(benchmarkPath, 'utf8')) as {
      case: { strategy?: string; minimumQualityScore?: number };
      baseline: Array<{ source: string; costUsd?: number }>;
      acr: Array<{ source: string; costUsd?: number }>;
    };
    expect(benchmark.case.strategy).toBe('serena');
    expect(benchmark.case.minimumQualityScore).toBe(0.95);
    expect(benchmark.baseline).toHaveLength(3);
    expect(benchmark.acr).toHaveLength(3);
    expect(benchmark.baseline.every((item) => item.source === 'measured')).toBe(true);
    expect(benchmark.acr.every((item) => item.source === 'measured')).toBe(true);
    expect(benchmark.baseline.every((item) => item.costUsd === undefined)).toBe(true);
    expect(benchmark.acr.every((item) => item.costUsd === undefined)).toBe(true);

    const serializedPlan = await readFile(planPath, 'utf8');
    expect(serializedPlan).not.toContain('RAW CLI RESULT');
  });
});
