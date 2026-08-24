export type TaskType =
  | 'targeted_code_search'
  | 'repository_exploration'
  | 'large_logs'
  | 'large_structured_data'
  | 'semantic_long_context'
  | 'exact_data'
  | 'implementation'
  | 'debugging'
  | 'simple_operation'
  | 'general_reasoning'
  | 'unknown';

export type PrecisionRequirement =
  | 'semantic'
  | 'structural'
  | 'exact'
  | 'secret-sensitive';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type OptimizationMode = 'observe' | 'guarded' | 'auto';
export type CapabilityStatus =
  | 'available'
  | 'unavailable'
  | 'incompatible'
  | 'unknown';

export interface TaskProfile {
  taskType: TaskType;
  precision: PrecisionRequirement;
  risk: RiskLevel;
  confidence: number;
  requiresExactIdentifiers: boolean;
  expectedTurns?: number;
  expectedOutputSize?: 'small' | 'medium' | 'large';
}

export interface ContextSnapshot {
  estimatedTokens: number;
  contextWindowTokens?: number;
  utilizationRatio?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  source: 'measured' | 'estimated' | 'unknown';
}

export interface Capability {
  id: string;
  name: string;
  status: CapabilityStatus;
  version?: string;
  reason?: string;
  metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface StrategyCandidate {
  id: string;
  adapters: readonly string[];
  estimatedSavingRatio?: number;
  risk: RiskLevel;
  overheadScore: number;
  confidence: number;
  utilityScore?: number;
  blocked: boolean;
  reasons: readonly string[];
}

export interface RoutingDecision {
  task: TaskProfile;
  context: ContextSnapshot;
  mode: OptimizationMode;
  selected: StrategyCandidate | null;
  rejected: readonly StrategyCandidate[];
  rationale: readonly string[];
  createdAt: string;
}

export interface AdapterHealth {
  status: CapabilityStatus;
  detail?: string;
  checkedAt: string;
}

export interface OptimizationEstimate {
  savingRatio?: number;
  latencyOverheadMs?: number;
  risk: RiskLevel;
  reasons: readonly string[];
}

export type AdapterExecutionKind =
  | 'native-guidance'
  | 'mcp-invocation'
  | 'command-rewrite'
  | 'proxy-route'
  | 'hook-orchestration';

export interface AdapterAction {
  id: string;
  kind: AdapterExecutionKind;
  summary: string;
  capabilityId?: string;
  external: boolean;
  destructive: boolean;
  metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface AdapterApplyRequest {
  task: TaskProfile;
  context: ContextSnapshot;
  mode: OptimizationMode;
  strategy?: StrategyCandidate;
  input?: string;
}

export interface AdapterPlan {
  adapterId: string;
  displayName: string;
  actions: readonly AdapterAction[];
  risk: RiskLevel;
  requiresExternalExecution: boolean;
  requiresApproval: boolean;
  reversible: boolean;
  blocked: boolean;
  reasons: readonly string[];
}

export type AdapterExecutionStatus =
  | 'planned'
  | 'applied'
  | 'blocked'
  | 'failed'
  | 'rolled-back';

export interface AdapterExecutorResult {
  success: boolean;
  detail?: string;
  rollbackToken?: string;
  metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface AdapterExecutor {
  execute(
    plan: AdapterPlan,
    request: AdapterApplyRequest,
  ): Promise<AdapterExecutorResult>;
  rollback?(rollbackToken: string): Promise<void>;
}

export interface AdapterExecutionReceipt {
  adapterId: string;
  status: AdapterExecutionStatus;
  plan: AdapterPlan;
  startedAt: string;
  completedAt: string;
  externalExecutionAttempted: boolean;
  detail?: string;
  rollbackToken?: string;
  metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface OptimizationAdapter {
  readonly id: string;
  readonly displayName: string;
  detect(): Promise<Capability>;
  health(): Promise<AdapterHealth>;
  estimate(
    task: TaskProfile,
    context: ContextSnapshot,
  ): Promise<OptimizationEstimate>;
  plan(request: AdapterApplyRequest): Promise<AdapterPlan>;
  apply(
    request: AdapterApplyRequest,
    executor?: AdapterExecutor,
  ): Promise<AdapterExecutionReceipt>;
  rollback(
    receipt: AdapterExecutionReceipt,
    executor?: AdapterExecutor,
  ): Promise<AdapterExecutionReceipt>;
}

export interface TelemetryEvent {
  id: string;
  timestamp: string;
  type: 'classification' | 'decision' | 'execution' | 'measurement' | 'error';
  source: string;
  measured: boolean;
  payload: Readonly<Record<string, unknown>>;
}
