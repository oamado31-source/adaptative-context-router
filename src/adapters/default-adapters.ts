import { CapabilityRegistry } from '../core/capability-registry.js';
import type {
  AdapterApplyRequest,
  AdapterExecutionReceipt,
  AdapterExecutionKind,
  AdapterExecutor,
  AdapterHealth,
  AdapterPlan,
  Capability,
  ContextSnapshot,
  OptimizationAdapter,
  OptimizationEstimate,
  PrecisionRequirement,
  RiskLevel,
  TaskProfile,
  TaskType,
} from '../core/contracts.js';

export type CapabilityResolver = (id: string) => Promise<Capability>;

interface AdapterSpec {
  id: string;
  displayName: string;
  capabilityId?: string;
  kind: AdapterExecutionKind;
  taskTypes: readonly TaskType[];
  forbiddenPrecisions: readonly PrecisionRequirement[];
  risk: RiskLevel;
  estimatedSavingRatio: number;
  external: boolean;
  reversible: boolean;
  requiresApprovalInGuarded: boolean;
  summary: string;
}

function unavailableCapability(id: string): Capability {
  return {
    id,
    name: id,
    status: 'unavailable',
    reason: 'Capability was not found in the supplied snapshot.',
  };
}

export function capabilityResolverFromSnapshot(
  capabilities: readonly Capability[],
): CapabilityResolver {
  const byId = new Map(capabilities.map((capability) => [capability.id, capability]));
  return async (id) => byId.get(id) ?? unavailableCapability(id);
}

export function discoveryCapabilityResolver(
  registry = new CapabilityRegistry(),
): CapabilityResolver {
  let snapshotPromise: Promise<readonly Capability[]> | undefined;

  return async (id) => {
    snapshotPromise ??= registry.discover();
    const snapshot = await snapshotPromise;
    return snapshot.find((capability) => capability.id === id) ?? unavailableCapability(id);
  };
}

class PlannedOptimizationAdapter implements OptimizationAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly #spec: AdapterSpec;
  readonly #resolveCapability: CapabilityResolver;

  constructor(spec: AdapterSpec, resolveCapability: CapabilityResolver) {
    this.id = spec.id;
    this.displayName = spec.displayName;
    this.#spec = spec;
    this.#resolveCapability = resolveCapability;
  }

  async detect(): Promise<Capability> {
    if (!this.#spec.capabilityId) {
      return {
        id: this.id,
        name: this.displayName,
        status: 'available',
        reason: 'Native ACR/Claude strategy; no external capability required.',
      };
    }
    return this.#resolveCapability(this.#spec.capabilityId);
  }

  async health(): Promise<AdapterHealth> {
    const capability = await this.detect();
    return {
      status: capability.status,
      ...(capability.reason ? { detail: capability.reason } : {}),
      checkedAt: new Date().toISOString(),
    };
  }

  async estimate(
    task: TaskProfile,
    _context: ContextSnapshot,
  ): Promise<OptimizationEstimate> {
    const supported = this.#spec.taskTypes.includes(task.taskType);
    const forbidden = this.#spec.forbiddenPrecisions.includes(task.precision);

    return {
      savingRatio: supported && !forbidden ? this.#spec.estimatedSavingRatio : 0,
      risk: this.#spec.risk,
      reasons: [
        supported
          ? `Adapter supports ${task.taskType}.`
          : `Adapter does not target ${task.taskType}.`,
        forbidden
          ? `Adapter is blocked for ${task.precision} precision.`
          : this.#spec.summary,
      ],
    };
  }

  async plan(request: AdapterApplyRequest): Promise<AdapterPlan> {
    const capability = await this.detect();
    const reasons: string[] = [this.#spec.summary];
    let blocked = false;

    if (!this.#spec.taskTypes.includes(request.task.taskType)) {
      blocked = true;
      reasons.push(`Unsupported workload: ${request.task.taskType}.`);
    }

    if (this.#spec.forbiddenPrecisions.includes(request.task.precision)) {
      blocked = true;
      reasons.push(`Blocked for ${request.task.precision} precision.`);
    }

    if (this.#spec.external && capability.status !== 'available') {
      blocked = true;
      reasons.push(`Required capability ${this.#spec.capabilityId ?? this.id} is ${capability.status}.`);
    }

    const requiresApproval =
      request.mode === 'observe' ||
      (request.mode === 'guarded' && this.#spec.requiresApprovalInGuarded);

    return {
      adapterId: this.id,
      displayName: this.displayName,
      actions: [
        {
          id: `${this.id}:primary`,
          kind: this.#spec.kind,
          summary: this.#spec.summary,
          ...(this.#spec.capabilityId
            ? { capabilityId: this.#spec.capabilityId }
            : {}),
          external: this.#spec.external,
          destructive: false,
        },
      ],
      risk: this.#spec.risk,
      requiresExternalExecution: this.#spec.external,
      requiresApproval,
      reversible: this.#spec.reversible,
      blocked,
      reasons,
    };
  }

  async apply(
    request: AdapterApplyRequest,
    executor?: AdapterExecutor,
  ): Promise<AdapterExecutionReceipt> {
    const startedAt = new Date().toISOString();
    const plan = await this.plan(request);

    if (plan.blocked) {
      return {
        adapterId: this.id,
        status: 'blocked',
        plan,
        startedAt,
        completedAt: new Date().toISOString(),
        externalExecutionAttempted: false,
        detail: plan.reasons.join(' '),
      };
    }

    if (request.mode === 'observe') {
      return {
        adapterId: this.id,
        status: 'planned',
        plan,
        startedAt,
        completedAt: new Date().toISOString(),
        externalExecutionAttempted: false,
        detail: 'Observe mode never executes optimization actions.',
      };
    }

    if (!plan.requiresExternalExecution) {
      return {
        adapterId: this.id,
        status: 'applied',
        plan,
        startedAt,
        completedAt: new Date().toISOString(),
        externalExecutionAttempted: false,
        detail: 'Native guidance is safe to apply without an external bridge.',
      };
    }

    if (plan.requiresApproval || !executor) {
      return {
        adapterId: this.id,
        status: 'planned',
        plan,
        startedAt,
        completedAt: new Date().toISOString(),
        externalExecutionAttempted: false,
        detail: plan.requiresApproval
          ? 'Guarded policy requires approval before external execution.'
          : 'No external adapter executor/bridge was provided.',
      };
    }

    const result = await executor.execute(plan, request);
    return {
      adapterId: this.id,
      status: result.success ? 'applied' : 'failed',
      plan,
      startedAt,
      completedAt: new Date().toISOString(),
      externalExecutionAttempted: true,
      ...(result.detail ? { detail: result.detail } : {}),
      ...(result.rollbackToken ? { rollbackToken: result.rollbackToken } : {}),
      ...(result.metadata ? { metadata: result.metadata } : {}),
    };
  }

  async rollback(
    receipt: AdapterExecutionReceipt,
    executor?: AdapterExecutor,
  ): Promise<AdapterExecutionReceipt> {
    if (
      receipt.status !== 'applied' ||
      !receipt.rollbackToken ||
      !executor?.rollback ||
      !receipt.plan.reversible
    ) {
      return receipt;
    }

    await executor.rollback(receipt.rollbackToken);
    return {
      ...receipt,
      status: 'rolled-back',
      completedAt: new Date().toISOString(),
      detail: 'Adapter execution rolled back after downstream pipeline failure.',
    };
  }
}

const DEFAULT_ADAPTER_SPECS: readonly AdapterSpec[] = [
  {
    id: 'native-claude',
    displayName: 'Native Claude Progressive Disclosure',
    kind: 'native-guidance',
    taskTypes: [
      'targeted_code_search',
      'repository_exploration',
      'semantic_long_context',
      'implementation',
      'debugging',
    ],
    forbiddenPrecisions: ['secret-sensitive'],
    risk: 'low',
    estimatedSavingRatio: 0.25,
    external: false,
    reversible: false,
    requiresApprovalInGuarded: false,
    summary: 'Use progressive disclosure: narrow search/overview before broad reads or large context materialization.',
  },
  {
    id: 'serena',
    displayName: 'Serena',
    capabilityId: 'serena',
    kind: 'mcp-invocation',
    taskTypes: ['targeted_code_search', 'repository_exploration'],
    forbiddenPrecisions: ['secret-sensitive'],
    risk: 'low',
    estimatedSavingRatio: 0.62,
    external: true,
    reversible: false,
    requiresApprovalInGuarded: false,
    summary: 'Delegate repository discovery to symbol-aware Serena retrieval instead of broad file reads.',
  },
  {
    id: 'jcodemunch',
    displayName: 'jCodeMunch',
    capabilityId: 'jcodemunch',
    kind: 'mcp-invocation',
    taskTypes: ['targeted_code_search', 'repository_exploration'],
    forbiddenPrecisions: ['secret-sensitive'],
    risk: 'low',
    estimatedSavingRatio: 0.58,
    external: true,
    reversible: false,
    requiresApprovalInGuarded: false,
    summary: 'Use AST/symbol retrieval to avoid loading unrelated source files.',
  },
  {
    id: 'rtk',
    displayName: 'RTK',
    capabilityId: 'rtk',
    kind: 'command-rewrite',
    taskTypes: ['large_logs'],
    forbiddenPrecisions: ['secret-sensitive'],
    risk: 'low',
    estimatedSavingRatio: 0.55,
    external: true,
    reversible: false,
    requiresApprovalInGuarded: false,
    summary: 'Filter large terminal output deterministically before it enters model context.',
  },
  {
    id: 'context-mode',
    displayName: 'Context Mode',
    capabilityId: 'context-mode',
    kind: 'mcp-invocation',
    taskTypes: ['large_logs', 'large_structured_data'],
    forbiddenPrecisions: ['exact', 'secret-sensitive'],
    risk: 'medium',
    estimatedSavingRatio: 0.52,
    external: true,
    reversible: false,
    requiresApprovalInGuarded: true,
    summary: 'Keep bulky tool payloads in a sandbox/search layer and return only relevant slices.',
  },
  {
    id: 'token-optimizer',
    displayName: 'Token Optimizer MCP',
    capabilityId: 'token-optimizer',
    kind: 'hook-orchestration',
    taskTypes: ['large_logs', 'large_structured_data', 'implementation', 'debugging'],
    forbiddenPrecisions: ['secret-sensitive'],
    risk: 'medium',
    estimatedSavingRatio: 0.4,
    external: true,
    reversible: true,
    requiresApprovalInGuarded: true,
    summary: 'Use smart reads, diffs, caching and output controls to reduce repeated context expansion.',
  },
  {
    id: 'pxpipe',
    displayName: 'pxpipe',
    capabilityId: 'pxpipe',
    kind: 'proxy-route',
    taskTypes: ['semantic_long_context'],
    forbiddenPrecisions: ['structural', 'exact', 'secret-sensitive'],
    risk: 'medium',
    estimatedSavingRatio: 0.65,
    external: true,
    reversible: true,
    requiresApprovalInGuarded: true,
    summary: 'Use optical context compression only for large semantic context where byte-level recall is not required.',
  },
] as const;

export function createDefaultAdapters(
  resolveCapability: CapabilityResolver = discoveryCapabilityResolver(),
): readonly OptimizationAdapter[] {
  return DEFAULT_ADAPTER_SPECS.map(
    (spec) => new PlannedOptimizationAdapter(spec, resolveCapability),
  );
}
