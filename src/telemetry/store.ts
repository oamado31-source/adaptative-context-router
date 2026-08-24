import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { TelemetryEvent } from '../core/contracts.js';

export interface TelemetryStore {
  append(event: TelemetryEvent): Promise<void>;
  list(): Promise<readonly TelemetryEvent[]>;
}

export class MemoryTelemetryStore implements TelemetryStore {
  readonly #events: TelemetryEvent[] = [];

  async append(event: TelemetryEvent): Promise<void> {
    this.#events.push(event);
  }

  async list(): Promise<readonly TelemetryEvent[]> {
    return [...this.#events];
  }
}

export class JsonlTelemetryStore implements TelemetryStore {
  readonly #path: string;

  constructor(path: string) {
    this.#path = path;
  }

  get path(): string {
    return this.#path;
  }

  async append(event: TelemetryEvent): Promise<void> {
    await mkdir(dirname(this.#path), { recursive: true });
    await appendFile(this.#path, `${JSON.stringify(event)}\n`, 'utf8');
  }

  async list(): Promise<readonly TelemetryEvent[]> {
    try {
      const content = await readFile(this.#path, 'utf8');
      return content
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line) as TelemetryEvent);
    } catch (error) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? String(error.code)
          : undefined;

      if (code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }
}
