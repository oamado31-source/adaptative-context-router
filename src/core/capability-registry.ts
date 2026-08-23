import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { Capability } from './contracts.js';
import {
  CAPABILITY_DEFINITIONS,
  type CapabilityDefinition,
} from './capability-definitions.js';

const execFileAsync = promisify(execFile);

export interface BinaryProbeResult {
  available: boolean;
  version?: string;
}

export interface ConfigDocument {
  label: string;
  content: string;
}

export interface CapabilityDiscoveryDependencies {
  probeBinary: (binary: string) => Promise<BinaryProbeResult>;
  readConfigDocuments: () => Promise<readonly ConfigDocument[]>;
}

function firstNonEmptyLine(value: string): string | undefined {
  return value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find(Boolean);
}

export async function probeBinary(binary: string): Promise<BinaryProbeResult> {
  try {
    const { stdout, stderr } = await execFileAsync(binary, ['--version'], {
      timeout: 2_500,
      windowsHide: true,
    });
    const version = firstNonEmptyLine(`${stdout}\n${stderr}`);
    return { available: true, version };
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String(error.code)
        : undefined;

    if (code === 'ENOENT') {
      return { available: false };
    }

    // A command can exist while rejecting --version. Treat that as present.
    return { available: true };
  }
}

function defaultConfigCandidates(): readonly { path: string; label: string }[] {
  const home = homedir();
  const cwd = process.cwd();

  return [
    { path: join(home, '.claude.json'), label: '~/.claude.json' },
    {
      path: join(home, '.claude', 'settings.json'),
      label: '~/.claude/settings.json',
    },
    { path: join(cwd, '.mcp.json'), label: './.mcp.json' },
    {
      path: join(cwd, '.claude', 'settings.json'),
      label: './.claude/settings.json',
    },
  ];
}

export async function readConfigDocuments(): Promise<readonly ConfigDocument[]> {
  const documents: ConfigDocument[] = [];

  for (const candidate of defaultConfigCandidates()) {
    try {
      const content = await readFile(candidate.path, 'utf8');
      documents.push({ label: candidate.label, content });
    } catch {
      // Missing or unreadable config files are normal and intentionally ignored.
    }
  }

  return documents;
}

function configMatch(
  definition: CapabilityDefinition,
  documents: readonly ConfigDocument[],
): ConfigDocument | undefined {
  if (definition.configTokens.length === 0) {
    return undefined;
  }

  return documents.find((document) => {
    const normalized = document.content.toLowerCase();
    return definition.configTokens.some((token) =>
      normalized.includes(token.toLowerCase()),
    );
  });
}

async function detectCapability(
  definition: CapabilityDefinition,
  documents: readonly ConfigDocument[],
  dependencies: CapabilityDiscoveryDependencies,
): Promise<Capability> {
  for (const binary of definition.binaries) {
    const probe = await dependencies.probeBinary(binary);
    if (probe.available) {
      return {
        id: definition.id,
        name: definition.name,
        status: 'available',
        version: probe.version,
        reason: `Detected executable: ${binary}`,
        metadata: {
          detectionMethod: 'binary',
          executable: binary,
        },
      };
    }
  }

  const matchedConfig = configMatch(definition, documents);
  if (matchedConfig) {
    return {
      id: definition.id,
      name: definition.name,
      status: 'available',
      reason: `Referenced by ${matchedConfig.label}`,
      metadata: {
        detectionMethod: 'config',
        configSource: matchedConfig.label,
      },
    };
  }

  return {
    id: definition.id,
    name: definition.name,
    status: 'unavailable',
    reason: 'No executable or Claude/MCP configuration reference detected.',
  };
}

const DEFAULT_DEPENDENCIES: CapabilityDiscoveryDependencies = {
  probeBinary,
  readConfigDocuments,
};

export class CapabilityRegistry {
  readonly #dependencies: CapabilityDiscoveryDependencies;
  readonly #definitions: readonly CapabilityDefinition[];

  constructor(
    dependencies: CapabilityDiscoveryDependencies = DEFAULT_DEPENDENCIES,
    definitions: readonly CapabilityDefinition[] = CAPABILITY_DEFINITIONS,
  ) {
    this.#dependencies = dependencies;
    this.#definitions = definitions;
  }

  async discover(): Promise<readonly Capability[]> {
    const documents = await this.#dependencies.readConfigDocuments();
    const capabilities: Capability[] = [];

    for (const definition of this.#definitions) {
      capabilities.push(
        await detectCapability(definition, documents, this.#dependencies),
      );
    }

    return capabilities;
  }
}
