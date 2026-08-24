import { describe, expect, it } from 'vitest';

import {
  loadBenchmarkCorpus,
  parseBenchmarkCorpus,
  summarizeBenchmarkCorpus,
} from '../src/benchmark/corpus.js';
import { parseBenchmarkCorpusCliArguments } from '../src/cli/corpus.js';

function validCorpus(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: 'test-real-corpus',
    evidenceMode: 'real',
    provider: 'claude-code',
    target: {
      repository: 'oamado31-source/adaptative-context-router',
      revision: '7fb35b8a8777cc39b986ec4661e21b66875b1623',
    },
    controls: {
      repetitionsPerArm: 3,
      samePrompt: true,
      sameProviderModel: true,
      sessionPersistence: false,
      order: 'alternating',
      qualityEvaluation: 'blinded-rubric',
    },
    cases: [
      {
        id: 'case-1',
        title: 'Locate classifier',
        taskType: 'targeted_code_search',
        task: 'Locate classifyTask and explain its result contract.',
        routingContextRatio: 0.6,
        targetPaths: ['src/core/task-classifier.ts'],
        requiredCapabilities: ['serena'],
        expectedStrategy: 'serena',
        quality: {
          minimumScore: 0.9,
          assertions: ['Finds classifyTask.', 'Describes the result contract.'],
        },
      },
    ],
  };
}

describe('real benchmark corpus', () => {
  it('accepts a pinned real corpus with reproducibility controls', () => {
    const corpus = parseBenchmarkCorpus(validCorpus());

    expect(corpus.evidenceMode).toBe('real');
    expect(corpus.provider).toBe('claude-code');
    expect(corpus.controls).toEqual({
      repetitionsPerArm: 3,
      samePrompt: true,
      sameProviderModel: true,
      sessionPersistence: false,
      order: 'alternating',
      qualityEvaluation: 'blinded-rubric',
    });
    expect(corpus.cases[0]?.routingContextRatio).toBe(0.6);
  });

  it('rejects synthetic evidence mode and non-commit target revisions', () => {
    const synthetic = validCorpus();
    synthetic.evidenceMode = 'synthetic';
    expect(() => parseBenchmarkCorpus(synthetic)).toThrow(/must be real/u);

    const branchTarget = validCorpus();
    branchTarget.target = {
      repository: 'oamado31-source/adaptative-context-router',
      revision: 'main',
    };
    expect(() => parseBenchmarkCorpus(branchTarget)).toThrow(/40-character/u);
  });

  it('rejects unsafe repository paths and duplicate case IDs', () => {
    const traversal = validCorpus();
    const traversalCases = traversal.cases as Array<Record<string, unknown>>;
    traversalCases[0] = {
      ...traversalCases[0],
      targetPaths: ['../private.txt'],
    };
    expect(() => parseBenchmarkCorpus(traversal)).toThrow(/without traversal/u);

    const duplicate = validCorpus();
    const duplicateCases = duplicate.cases as Array<Record<string, unknown>>;
    duplicateCases.push({ ...duplicateCases[0] });
    expect(() => parseBenchmarkCorpus(duplicate)).toThrow(/unique case IDs/u);
  });

  it('rejects weakened A/B controls, unknown capabilities and invalid routing context', () => {
    const weakControls = validCorpus();
    weakControls.controls = {
      repetitionsPerArm: 2,
      samePrompt: true,
      sameProviderModel: true,
      sessionPersistence: false,
      order: 'alternating',
      qualityEvaluation: 'blinded-rubric',
    };
    expect(() => parseBenchmarkCorpus(weakControls)).toThrow(/integer >= 3/u);

    const unknownCapability = validCorpus();
    const capabilityCases = unknownCapability.cases as Array<Record<string, unknown>>;
    capabilityCases[0] = {
      ...capabilityCases[0],
      requiredCapabilities: ['invented-optimizer'],
    };
    expect(() => parseBenchmarkCorpus(unknownCapability)).toThrow(
      /unknown capability/u,
    );

    const invalidContext = validCorpus();
    const contextCases = invalidContext.cases as Array<Record<string, unknown>>;
    contextCases[0] = {
      ...contextCases[0],
      routingContextRatio: 1.1,
    };
    expect(() => parseBenchmarkCorpus(invalidContext)).toThrow(/between 0 and 1/u);
  });

  it('validates the pinned real-v1 manifest and reports honest coverage', async () => {
    const corpus = await loadBenchmarkCorpus('benchmarks/corpus/real-v1.json');
    const summary = summarizeBenchmarkCorpus(corpus);

    expect(summary).toMatchObject({
      id: 'acr-real-v1',
      evidenceMode: 'real',
      provider: 'claude-code',
      repository: 'oamado31-source/adaptative-context-router',
      revision: '7fb35b8a8777cc39b986ec4661e21b66875b1623',
      repetitionsPerArm: 3,
      totalCases: 6,
      noOptimizationCases: 2,
    });
    expect(summary.taskTypes).toEqual({
      targeted_code_search: 1,
      repository_exploration: 1,
      exact_data: 1,
      semantic_long_context: 1,
      general_reasoning: 1,
      debugging: 1,
    });
    expect(summary.requiredCapabilities).toEqual({
      serena: 2,
      pxpipe: 1,
      'token-optimizer': 1,
    });
    expect(summary.coverageNotes).toHaveLength(3);
    expect(summary.taskTypes.large_logs).toBeUndefined();
    expect(summary.taskTypes.large_structured_data).toBeUndefined();
    expect(corpus.cases.every((item) => item.routingContextRatio >= 0 && item.routingContextRatio <= 1)).toBe(true);
  });

  it('parses the explicit corpus validation CLI without adding execution behavior', () => {
    expect(
      parseBenchmarkCorpusCliArguments([
        '--file',
        'benchmarks/corpus/real-v1.json',
        '--json',
      ]),
    ).toEqual({
      path: 'benchmarks/corpus/real-v1.json',
      json: true,
    });
    expect(() => parseBenchmarkCorpusCliArguments([])).toThrow(/Usage:/u);
    expect(() =>
      parseBenchmarkCorpusCliArguments(['--execute']),
    ).toThrow(/Unknown benchmark corpus option/u);
  });
});
