import { AdapterRegistry } from '../adapters/registry.js';
import type {
  AdapterExecutionReceipt,
  AdapterExecutor,
  RoutingDecision,
} from './contracts.js';

export type PipelineExecutionStatus =
  | 'no-optimization'
  | 'planned'
  | 'applied'
  | 'blocked'
  | 'failed';

export interface PipelineExecutionResult {
  status: PipelineExecutionStatus;
  receipts: readonly AdapterExecutionReceipt[];
  rolledBack: readonly AdapterExecutionReceipt[];
  detail: string;
}

export class PipelineExecutor {
  readonly #registry: AdapterRegistry;

  constructor(registry: AdapterRegistry) {
    this.#registry = registry;
  }

  async execute(
    decision: RoutingDecision,
    executor?: AdapterExecutor,
  ): Promise<PipelineExecutionResult> {
    if (!decision.selected) {
      return {
        status: 'no-optimization',
        receipts: [],
        rolledBack: [],
        detail: 'Routing decision selected NO_OPTIMIZATION.',
      };
    }

    const receipts: AdapterExecutionReceipt[] = [];

    try {
      for (const adapterId of decision.selected.adapters) {
        const adapter = this.#registry.get(adapterId);
        if (!adapter) {
          const rolledBack = await this.#rollbackApplied(receipts, executor);
          return {
            status: 'failed',
            receipts,
            rolledBack,
            detail: `Selected adapter is not registered: ${adapterId}.`,
          };
        }

        const receipt = await adapter.apply(
          {
            task: decision.task,
            context: decision.context,
            mode: decision.mode,
            strategy: decision.selected,
          },
          executor,
        );
        receipts.push(receipt);

        if (receipt.status === 'blocked' || receipt.status === 'failed') {
          const rolledBack = await this.#rollbackApplied(receipts, executor);
          return {
            status: receipt.status,
            receipts,
            rolledBack,
            detail:
              receipt.detail ??
              `Pipeline stopped because ${adapterId} returned ${receipt.status}.`,
          };
        }
      }
    } catch (error) {
      const rolledBack = await this.#rollbackApplied(receipts, executor);
      return {
        status: 'failed',
        receipts,
        rolledBack,
        detail: error instanceof Error ? error.message : String(error),
      };
    }

    const hasPlanned = receipts.some((receipt) => receipt.status === 'planned');
    return {
      status: hasPlanned ? 'planned' : 'applied',
      receipts,
      rolledBack: [],
      detail: hasPlanned
        ? 'Pipeline is valid but requires approval and/or an external execution bridge.'
        : 'Pipeline applied successfully.',
    };
  }

  async #rollbackApplied(
    receipts: readonly AdapterExecutionReceipt[],
    executor?: AdapterExecutor,
  ): Promise<readonly AdapterExecutionReceipt[]> {
    const rolledBack: AdapterExecutionReceipt[] = [];

    for (const receipt of [...receipts].reverse()) {
      if (receipt.status !== 'applied') continue;
      const adapter = this.#registry.get(receipt.adapterId);
      if (!adapter) continue;
      const result = await adapter.rollback(receipt, executor);
      if (result.status === 'rolled-back') {
        rolledBack.push(result);
      }
    }

    return rolledBack;
  }
}
