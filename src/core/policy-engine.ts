import type {
  Capability,
  ContextSnapshot,
  OptimizationMode,
  RoutingDecision,
  StrategyCandidate,
  TaskProfile,
} from './contracts.js';
import type { PolicyConfig, StrategyPolicy } from './policy-config.js';
import { loadPolicyConfig } from './policy-config.js';

export interface PolicyEvaluationInput {
  task: TaskProfile;
  context: ContextSnapshot;
  capabilities: readonly Capability[];
  mode?: OptimizationMode;
}

function contextUtilization(context: ContextSnapshot): number | undefined {
  if (context.utilizationRatio !== undefined) return context.utilizationRatio;
  if (
    context.contextWindowTokens !== undefined &&
    context.contextWindowTokens > 0
  ) {
    return context.estimatedTokens / context.contextWindowTokens;
  }
  return undefined;
}

function availableCapabilityIds(
  capabilities: readonly Capability[],
): ReadonlySet<string> {
  return new Set(
    capabilities
      .filter((capability) => capability.status === 'available')
      .map((capability) => capability.id),
  );
}

function scoreStrategy(
  policy: StrategyPolicy,
  config: PolicyConfig,
): number {
  return (
    policy.baseScore +
    policy.estimatedSavingRatio * config.weights.saving -
    config.weights.risk[policy.risk] -
    policy.overheadScore * config.weights.overhead +
    policy.confidence * config.weights.confidence
  );
}

function evaluateStrategy(
  policy: StrategyPolicy,
  task: TaskProfile,
  context: ContextSnapshot,
  capabilityIds: ReadonlySet<string>,
  config: PolicyConfig,
): StrategyCandidate | null {
  if (!policy.taskTypes.includes(task.taskType)) return null;

  const reasons = [...policy.reasons];
  let blocked = false;

  const missingCapabilities = policy.requiredCapabilities.filter(
    (capability) => !capabilityIds.has(capability),
  );
  if (missingCapabilities.length > 0) {
    blocked = true;
    reasons.push(
      `Required capability unavailable: ${missingCapabilities.join(', ')}.`,
    );
  }

  if (policy.forbiddenPrecisions.includes(task.precision)) {
    blocked = true;
    reasons.push(`Blocked for ${task.precision} precision.`);
  }

  const utilization = contextUtilization(context);
  if (policy.minContextUtilization !== undefined) {
    if (utilization === undefined) {
      blocked = true;
      reasons.push('Context utilization is unknown; minimum threshold cannot be verified.');
    } else if (utilization < policy.minContextUtilization) {
      blocked = true;
      reasons.push(
        `Context utilization ${(utilization * 100).toFixed(1)}% is below the ${(policy.minContextUtilization * 100).toFixed(1)}% minimum.`,
      );
    }
  }

  if (
    policy.maxContextUtilization !== undefined &&
    utilization !== undefined &&
    utilization > policy.maxContextUtilization
  ) {
    blocked = true;
    reasons.push(
      `Context utilization ${(utilization * 100).toFixed(1)}% exceeds the ${(policy.maxContextUtilization * 100).toFixed(1)}% maximum.`,
    );
  }

  return {
    id: policy.id,
    adapters: policy.adapters,
    estimatedSavingRatio: policy.estimatedSavingRatio,
    risk: policy.risk,
    overheadScore: policy.overheadScore,
    confidence: policy.confidence,
    utilityScore: Number(scoreStrategy(policy, config).toFixed(2)),
    blocked,
    reasons,
  };
}

function noOptimizationReason(
  input: PolicyEvaluationInput,
  config: PolicyConfig,
): string | undefined {
  const utilization = contextUtilization(input.context);

  if (input.task.precision === 'secret-sensitive') {
    return 'Secret-sensitive task: optimization is disabled by the default guarded policy.';
  }

  if (
    input.task.taskType === 'simple_operation' &&
    utilization !== undefined &&
    utilization <= config.noOptimization.simpleTaskMaxContextUtilization
  ) {
    return `Simple bounded task at ${(utilization * 100).toFixed(1)}% context utilization: optimization overhead is not justified.`;
  }

  if (
    input.task.taskType === 'general_reasoning' &&
    utilization !== undefined &&
    utilization <= config.noOptimization.generalReasoningMaxContextUtilization
  ) {
    return `General reasoning at ${(utilization * 100).toFixed(1)}% context utilization: optimization overhead is not justified.`;
  }

  return undefined;
}

export class PolicyEngine {
  readonly #config: PolicyConfig;

  constructor(config: PolicyConfig) {
    this.#config = config;
  }

  static async createDefault(): Promise<PolicyEngine> {
    return new PolicyEngine(await loadPolicyConfig());
  }

  evaluate(input: PolicyEvaluationInput): RoutingDecision {
    const mode = input.mode ?? 'guarded';
    const rationale: string[] = [];
    const earlyNoOptimization = noOptimizationReason(input, this.#config);

    if (earlyNoOptimization) {
      return {
        task: input.task,
        context: input.context,
        mode,
        selected: null,
        rejected: [],
        rationale: [earlyNoOptimization, 'Decision: NO_OPTIMIZATION.'],
        createdAt: new Date().toISOString(),
      };
    }

    const capabilityIds = availableCapabilityIds(input.capabilities);
    const candidates = this.#config.strategies
      .map((policy) =>
        evaluateStrategy(
          policy,
          input.task,
          input.context,
          capabilityIds,
          this.#config,
        ),
      )
      .filter((candidate): candidate is StrategyCandidate => candidate !== null);

    const eligible = candidates
      .filter((candidate) => !candidate.blocked)
      .sort((a, b) => (b.utilityScore ?? 0) - (a.utilityScore ?? 0));

    const selected = eligible[0] ?? null;
    const threshold = this.#config.noOptimization.minimumUtilityScore;

    if (!selected || (selected.utilityScore ?? 0) < threshold) {
      rationale.push(
        selected
          ? `Best strategy score ${(selected.utilityScore ?? 0).toFixed(2)} is below the minimum utility threshold ${threshold.toFixed(2)}.`
          : 'No eligible optimization strategy is available for this workload.',
      );
      rationale.push('Decision: NO_OPTIMIZATION.');

      return {
        task: input.task,
        context: input.context,
        mode,
        selected: null,
        rejected: candidates,
        rationale,
        createdAt: new Date().toISOString(),
      };
    }

    rationale.push(
      `Selected ${selected.id} with utility score ${(selected.utilityScore ?? 0).toFixed(2)}.`,
    );
    rationale.push(
      `Estimated saving ${(selected.estimatedSavingRatio ?? 0) * 100}% with ${selected.risk} strategy risk.`,
    );

    const rejected = candidates.map((candidate) => {
      if (candidate.id === selected.id) return candidate;
      if (candidate.blocked) return candidate;
      return {
        ...candidate,
        reasons: [
          ...candidate.reasons,
          `Lower utility score than selected strategy ${selected.id}.`,
        ],
      };
    });

    return {
      task: input.task,
      context: input.context,
      mode,
      selected,
      rejected: rejected.filter((candidate) => candidate.id !== selected.id),
      rationale,
      createdAt: new Date().toISOString(),
    };
  }
}
