import { describe, expect, it } from 'vitest';

import type { Capability, ContextSnapshot } from '../src/core/contracts.js';
import { PolicyEngine } from '../src/core/policy-engine.js';
import { classifyTask } from '../src/core/task-classifier.js';

function context(utilizationRatio: number): ContextSnapshot {
  return {
    estimatedTokens: Math.round(200_000 * utilizationRatio),
    contextWindowTokens: 200_000,
    utilizationRatio,
    source: 'estimated',
  };
}

function capabilities(...availableIds: string[]): readonly Capability[] {
  const known = [
    'serena',
    'jcodemunch',
    'rtk',
    'context-mode',
    'token-optimizer',
    'pxpipe',
  ];

  return known.map((id) => ({
    id,
    name: id,
    status: availableIds.includes(id) ? 'available' : 'unavailable',
  }));
}

describe('PolicyEngine', () => {
  it('selects Serena for targeted code search when available', async () => {
    const engine = await PolicyEngine.createDefault();
    const task = classifyTask('Find where authenticateUser is defined.').profile;

    const decision = engine.evaluate({
      task,
      context: context(0.61),
      capabilities: capabilities('serena', 'jcodemunch'),
    });

    expect(decision.selected?.id).toBe('serena');
    expect(decision.selected?.blocked).toBe(false);
    expect(decision.selected?.utilityScore).toBeGreaterThan(60);
  });

  it('selects RTK for large logs when available', async () => {
    const engine = await PolicyEngine.createDefault();
    const task = classifyTask('Analyze 40k lines of npm test output and find the failures.').profile;

    const decision = engine.evaluate({
      task,
      context: context(0.72),
      capabilities: capabilities('rtk', 'context-mode'),
    });

    expect(decision.selected?.id).toBe('rtk');
  });

  it('selects Context Mode for large structured data', async () => {
    const engine = await PolicyEngine.createDefault();
    const task = classifyTask('Analyze this huge JSON API response with thousands of records.').profile;

    const decision = engine.evaluate({
      task,
      context: context(0.68),
      capabilities: capabilities('context-mode'),
    });

    expect(decision.selected?.id).toBe('context-mode');
  });

  it('selects pxpipe only for sufficiently large semantic context', async () => {
    const engine = await PolicyEngine.createDefault();
    const task = classifyTask('Analyze this long research report and synthesize the main themes.').profile;

    const decision = engine.evaluate({
      task,
      context: context(0.70),
      capabilities: capabilities('pxpipe'),
    });

    expect(task.precision).toBe('semantic');
    expect(decision.selected?.id).toBe('pxpipe');
  });

  it('blocks pxpipe when semantic-long-context work also requires exact identifiers', async () => {
    const engine = await PolicyEngine.createDefault();
    const task = classifyTask(
      'Analyze this long research report while preserving the SHA-256 hash exactly.',
    ).profile;

    const decision = engine.evaluate({
      task,
      context: context(0.75),
      capabilities: capabilities('pxpipe'),
    });

    expect(task.taskType).toBe('semantic_long_context');
    expect(task.precision).toBe('exact');
    expect(decision.selected?.id).toBe('native-progressive-disclosure');
    expect(
      decision.rejected.find((candidate) => candidate.id === 'pxpipe')?.blocked,
    ).toBe(true);
  });

  it('chooses NO_OPTIMIZATION for a simple task at low context utilization', async () => {
    const engine = await PolicyEngine.createDefault();
    const task = classifyTask('Change the button color.').profile;

    const decision = engine.evaluate({
      task,
      context: context(0.11),
      capabilities: capabilities('serena', 'rtk', 'pxpipe'),
    });

    expect(decision.selected).toBeNull();
    expect(decision.rationale).toContain('Decision: NO_OPTIMIZATION.');
  });

  it('chooses NO_OPTIMIZATION for secret-sensitive work', async () => {
    const engine = await PolicyEngine.createDefault();
    const task = classifyTask('Verify this API key and access token exactly.').profile;

    const decision = engine.evaluate({
      task,
      context: context(0.83),
      capabilities: capabilities(
        'serena',
        'rtk',
        'context-mode',
        'token-optimizer',
        'pxpipe',
      ),
    });

    expect(task.precision).toBe('secret-sensitive');
    expect(decision.selected).toBeNull();
    expect(decision.rationale[0]).toMatch(/Secret-sensitive/u);
  });

  it('falls back to native progressive disclosure when specialized code tools are unavailable', async () => {
    const engine = await PolicyEngine.createDefault();
    const task = classifyTask('Find where authenticateUser is defined.').profile;

    const decision = engine.evaluate({
      task,
      context: context(0.58),
      capabilities: capabilities(),
    });

    expect(decision.selected?.id).toBe('native-progressive-disclosure');
    expect(
      decision.rejected.find((candidate) => candidate.id === 'serena')?.blocked,
    ).toBe(true);
  });

  it('chooses NO_OPTIMIZATION when no strategy matches a structured-data workload', async () => {
    const engine = await PolicyEngine.createDefault();
    const task = classifyTask('Analyze this huge JSON payload with thousands of records.').profile;

    const decision = engine.evaluate({
      task,
      context: context(0.62),
      capabilities: capabilities(),
    });

    expect(decision.selected).toBeNull();
    expect(decision.rationale).toContain('Decision: NO_OPTIMIZATION.');
  });
});
