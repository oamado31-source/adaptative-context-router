import type {
  AdapterHealth,
  OptimizationAdapter,
} from '../core/contracts.js';
import {
  createDefaultAdapters,
  type CapabilityResolver,
} from './default-adapters.js';

export interface AdapterStatus {
  id: string;
  displayName: string;
  health: AdapterHealth;
}

export class AdapterRegistry {
  readonly #adapters: ReadonlyMap<string, OptimizationAdapter>;

  constructor(adapters: readonly OptimizationAdapter[]) {
    this.#adapters = new Map(adapters.map((adapter) => [adapter.id, adapter]));
  }

  static createDefault(resolveCapability?: CapabilityResolver): AdapterRegistry {
    return new AdapterRegistry(createDefaultAdapters(resolveCapability));
  }

  get(id: string): OptimizationAdapter | undefined {
    return this.#adapters.get(id);
  }

  list(): readonly OptimizationAdapter[] {
    return [...this.#adapters.values()];
  }

  async health(): Promise<readonly AdapterStatus[]> {
    return Promise.all(
      this.list().map(async (adapter) => ({
        id: adapter.id,
        displayName: adapter.displayName,
        health: await adapter.health(),
      })),
    );
  }
}
