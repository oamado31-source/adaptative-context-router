import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { TelemetryEvent } from '../src/core/contracts.js';
import { buildDashboard } from '../src/cli/dashboard.js';
import {
  buildDashboardModel,
  summarizeRuns,
} from '../src/dashboard/model.js';
import { renderDashboardHtml } from '../src/dashboard/render.js';

function event(
  id: string,
  type: TelemetryEvent['type'],
  payload: Readonly<Record<string, unknown>>,
  measured = false,
): TelemetryEvent {
  return {
    id,
    timestamp: `2026-01-01T12:00:0${id.length}.000Z`,
    type,
    source: 'test',
    measured,
    payload,
  };
}

function localEvents(): readonly TelemetryEvent[] {
  return [
    event('c1', 'classification', {
      runId: 'run-1',
      taskType: 'targeted_code_search',
      precision: 'structural',
      risk: 'medium',
    }),
    event('d1', 'decision', {
      runId: 'run-1',
      selectedStrategy: 'serena',
      estimatedSavingRatio: 0.62,
      context: { utilizationRatio: 0.61 },
    }),
    event('e1', 'execution', {
      runId: 'run-1',
      pipelineStatus: 'planned',
    }),
    event(
      'm1',
      'measurement',
      {
        runId: 'run-1',
        inputTokens: 6100,
        outputTokens: 1000,
        latencyMs: 3450,
        costUsd: 0.08,
        success: true,
        qualityScore: 0.95,
      },
      true,
    ),
    event('c2', 'classification', {
      runId: 'run-2',
      taskType: 'simple_operation',
      precision: 'semantic',
      risk: 'low',
    }),
    event('d2', 'decision', {
      runId: 'run-2',
      selectedStrategy: null,
      estimatedSavingRatio: null,
      context: { utilizationRatio: 0.11 },
    }),
    event('e2', 'execution', {
      runId: 'run-2',
      pipelineStatus: 'no-optimization',
    }),
  ];
}

describe('dashboard model', () => {
  it('keeps estimated routing signals separate from measured run evidence', () => {
    const model = buildDashboardModel(localEvents(), [], {
      generatedAt: '2026-01-01T00:00:00.000Z',
    });

    expect(model.telemetry.totalRuns).toBe(2);
    expect(model.telemetry.measuredRuns).toBe(1);
    expect(model.telemetry.noOptimizationRuns).toBe(1);
    expect(model.measuredCoverageRatio).toBe(0.5);

    const serena = model.runs.find((run) => run.runId === 'run-1');
    expect(serena?.estimatedSavingRatio).toBe(0.62);
    expect(serena?.measured).toBe(true);
    expect(serena?.inputTokens).toBe(6100);

    const noOptimization = model.runs.find((run) => run.runId === 'run-2');
    expect(noOptimization?.selectedStrategy).toBeNull();
    expect(noOptimization?.measured).toBe(false);
  });

  it('summarizes run events independent of input ordering', () => {
    const runs = summarizeRuns([...localEvents()].reverse());
    expect(runs).toHaveLength(2);
    const run = runs.find((item) => item.runId === 'run-1');
    expect(run?.taskType).toBe('targeted_code_search');
    expect(run?.pipelineStatus).toBe('planned');
    expect(run?.qualityScore).toBe(0.95);
  });
});

describe('dashboard renderer', () => {
  it('escapes telemetry-derived strings and uses no remote resources', () => {
    const injected = [
      event('c', 'classification', {
        runId: 'unsafe-run',
        taskType: '<img src=x onerror=alert(1)>',
        precision: 'semantic',
        risk: 'low',
      }),
      event('d', 'decision', {
        runId: 'unsafe-run',
        selectedStrategy: '<script>alert(1)</script>',
        estimatedSavingRatio: 0.5,
        context: { utilizationRatio: 0.5 },
      }),
    ];

    const html = renderDashboardHtml(
      buildDashboardModel(injected, [], {
        generatedAt: '2026-01-01T00:00:00.000Z',
      }),
    );

    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toMatch(/https?:\/\//u);
    expect(html).not.toMatch(/<script[^>]+src=/u);
  });

  it('labels local telemetry as evidence-disciplined rather than benchmark proof', () => {
    const html = renderDashboardHtml(
      buildDashboardModel(localEvents(), [], {
        generatedAt: '2026-01-01T00:00:00.000Z',
      }),
    );
    expect(html).toContain('Local ACR telemetry');
    expect(html).toContain('Routing ≠ proof');
    expect(html).toContain('Only measurement events and measured A/B benchmark inputs are evidence.');
  });
});

describe('dashboard builder', () => {
  it('writes a self-contained synthetic demo with a prominent evidence warning', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'acr-dashboard-'));
    const outputPath = join(directory, 'demo.html');

    try {
      const result = await buildDashboard({
        json: false,
        evidenceMode: 'synthetic-demo',
        telemetryPath: join(directory, 'unused.jsonl'),
        benchmarkPaths: [],
        outputPath,
      });
      const html = await readFile(outputPath, 'utf8');

      expect(result.model.telemetry.totalRuns).toBe(3);
      expect(result.model.telemetry.measuredRuns).toBe(2);
      expect(result.model.telemetry.noOptimizationRuns).toBe(1);
      expect(result.model.benchmarks).toHaveLength(1);
      expect(html).toContain('SYNTHETIC DEMO');
      expect(html).toContain('not project benchmark evidence');
      expect(html).toContain('synthetic-symbol-search');
      expect(html).toContain('NO_OPTIMIZATION');
      expect(html).not.toMatch(/https?:\/\//u);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
