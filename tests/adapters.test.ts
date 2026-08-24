import { describe, expect, it, vi } from 'vitest';

import {
  capabilityResolverFromSnapshot,
  createDefaultAdapters,
} from '../src/adapters/default-adapters.js';
import { AdapterRegistry } from '../src/adapters/registry.js';
import type {
  AdapterExecutor,
  Capability,
  RoutingDecision,
  TaskProfile,
} from '../src/core/contracts.js';
import { PipelineExecutor } from '../src/core/pipeline-executor.js';

const context = {
  estimatedTokens: 120_000,
  contextWindowTokens: 200_000,
  utilizationRatio: 0.6,
  source: 'estimated' as const,
};

function task(
  taskType: TaskProfile['taskType'],
  precision: TaskProfile['precision'] = 'semantic',
): TaskProfile {
  return {
    taskType,
    precision,
    risk:
      precision === 'secret-sensitive'
        ? 'critical'
        : precision === 'exact'
          ? 'high'
          : precision === 'structural'
            ? 'medium'
            : 'low',
    confidence: 0.95,
    requiresExactIdentifiers:
      precision === 'exact' || precision === 'secret-sensitive',
    expectedOutputSize: 'medium',
  };
}

function capabilities(...available: string[]): readonly Capability[] {
  const ids = [
    'serena',
    'jcodemunch',
    'rtk',
    'context-mode',
    'token-optimizer',
    'pxpipe',
  ];
  return ids.map((id) => ({
    id,
    name: id,
    status: available.includes(id) ? 'available' : 'unavailable',
  }));
}

function decision(
  adapterIds: string | readonly string[] | null,
  profile: TaskProfile,
  mode: RoutingDecision['mode'] = 'guarded',
): RoutingDecision {
  const adapters =
    adapterIds === null
      ? null
      : typeof adapterIds === 'string'
        ? [adapterIds]
        : adapterIds;

  return {
    task: profile,
    context,
    mode,
    selected:
      adapters === null
        ? null
        : {
            id: adapters.join('+'),
            adapters,
            estimatedSavingRatio: 0.5,
            risk: 'low',
            overheadScore: 0.1,
            confidence: 0.9,
            utilityScore: 50,
            blocked: false,
            reasons: ['test strategy'],
          },
    rejected: [],
    rationale: [],
    createdAt: new Date().toISOString(),
  };
}

describe('default adapters', () => {
  it('registers every default adapter used by policy strategies', () => {
    const registry = AdapterRegistry.createDefault(
      capabilityResolverFromSnapshot(capabilities()),
    );

    expect(registry.list().map((adapter) => adapter.id)).toEqual([
      'native-claude',
      'serena',
      'jcodemunch',
      'rtk',
      'context-mode',
      'token-optimizer',
      'pxpipe',
    ]);
  });

  it('blocks pxpipe for exact precision even when installed', async () => {
    const adapters = createDefaultAdapters(
      capabilityResolverFromSnapshot(capabilities('pxpipe')),
    );
    const pxpipe = adapters.find((adapter) => adapter.id === 'pxpipe');
    expect(pxpipe).toBeDefined();

    const plan = await pxpipe!.plan({
      task: task('semantic_long_context', 'exact'),
      context,
      mode: 'auto',
    });

    expect(plan.blocked).toBe(true);
    expect(plan.reasons.join(' ')).toContain('Blocked for exact precision');
  });

  it('applies native progressive disclosure without external execution', async () => {
    const registry = AdapterRegistry.createDefault(
      capabilityResolverFromSnapshot(capabilities()),
    );
    const native = registry.get('native-claude');
    expect(native).toBeDefined();

    const receipt = await native!.apply({
      task: task('debugging', 'structural'),
      context,
      mode: 'guarded',
    });

    expect(receipt.status).toBe('applied');
    expect(receipt.externalExecutionAttempted).toBe(false);
  });

  it('keeps approval-gated external adapters planned in guarded mode', async () => {
    const registry = AdapterRegistry.createDefault(
      capabilityResolverFromSnapshot(capabilities('pxpipe')),
    );
    const pxpipe = registry.get('pxpipe');
    expect(pxpipe).toBeDefined();

    const executor: AdapterExecutor = {
      execute: vi.fn(async () => ({ success: true })),
    };

    const receipt = await pxpipe!.apply(
      {
        task: task('semantic_long_context', 'semantic'),
        context,
        mode: 'guarded',
      },
      executor,
    );

    expect(receipt.status).toBe('planned');
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it('executes safe external adapters in auto mode when a bridge is supplied', async () => {
    const registry = AdapterRegistry.createDefault(
      capabilityResolverFromSnapshot(capabilities('serena')),
    );
    const serena = registry.get('serena');
    expect(serena).toBeDefined();

    const executor: AdapterExecutor = {
      execute: vi.fn(async () => ({
        success: true,
        detail: 'Serena retrieval completed.',
      })),
    };

    const receipt = await serena!.apply(
      {
        task: task('targeted_code_search', 'structural'),
        context,
        mode: 'auto',
      },
      executor,
    );

    expect(receipt.status).toBe('applied');
    expect(receipt.externalExecutionAttempted).toBe(true);
    expect(executor.execute).toHaveBeenCalledTimes(1);
  });
});

describe('PipelineExecutor', () => {
  it('returns no-optimization without invoking adapters', async () => {
    const registry = AdapterRegistry.createDefault(
      capabilityResolverFromSnapshot(capabilities()),
    );
    const pipeline = new PipelineExecutor(registry);

    const result = await pipeline.execute(
      decision(null, task('simple_operation', 'semantic')),
    );

    expect(result.status).toBe('no-optimization');
    expect(result.receipts).toHaveLength(0);
  });

  it('plans an external pipeline when no bridge is available', async () => {
    const registry = AdapterRegistry.createDefault(
      capabilityResolverFromSnapshot(capabilities('serena')),
    );
    const pipeline = new PipelineExecutor(registry);

    const result = await pipeline.execute(
      decision('serena', task('targeted_code_search', 'structural')),
    );

    expect(result.status).toBe('planned');
    expect(result.receipts[0]?.adapterId).toBe('serena');
  });

  it('halts a multi-adapter pipeline when an upstream adapter is only planned', async () => {
    const registry = AdapterRegistry.createDefault(
      capabilityResolverFromSnapshot(capabilities('serena')),
    );
    const pipeline = new PipelineExecutor(registry);

    const executor: AdapterExecutor = {
      execute: vi.fn(async () => ({ success: true })),
    };

    const result = await pipeline.execute(
      decision(
        ['serena', 'native-claude'],
        task('targeted_code_search', 'structural'),
        'guarded',
      ),
      undefined,
    );

    expect(result.status).toBe('planned');
    expect(result.receipts.map((receipt) => receipt.adapterId)).toEqual([
      'serena',
    ]);
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it('fails safely if policy references an unknown adapter', async () => {
    const registry = AdapterRegistry.createDefault(
      capabilityResolverFromSnapshot(capabilities()),
    );
    const pipeline = new PipelineExecutor(registry);

    const result = await pipeline.execute(
      decision('missing-adapter', task('debugging', 'structural')),
    );

    expect(result.status).toBe('failed');
    expect(result.detail).toContain('not registered');
  });
});
