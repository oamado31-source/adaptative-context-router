import { describe, expect, it } from 'vitest';

import {
  CapabilityRegistry,
  type CapabilityDiscoveryDependencies,
} from '../src/core/capability-registry.js';

function dependencies(
  binaries: Readonly<Record<string, { available: boolean; version?: string }>>,
  configs: readonly { label: string; content: string }[] = [],
): CapabilityDiscoveryDependencies {
  return {
    probeBinary: async (binary) => binaries[binary] ?? { available: false },
    readConfigDocuments: async () => configs,
  };
}

describe('CapabilityRegistry', () => {
  it('detects an executable capability and preserves its version', async () => {
    const registry = new CapabilityRegistry(
      dependencies({
        claude: { available: true, version: '2.1.0' },
      }),
    );

    const capabilities = await registry.discover();
    const claude = capabilities.find((capability) => capability.id === 'claude-code');

    expect(claude).toMatchObject({
      status: 'available',
      version: '2.1.0',
      metadata: {
        detectionMethod: 'binary',
        executable: 'claude',
      },
    });
  });

  it('detects MCP tools referenced by Claude configuration', async () => {
    const registry = new CapabilityRegistry(
      dependencies(
        {},
        [
          {
            label: '~/.claude.json',
            content: JSON.stringify({
              mcpServers: {
                serena: {
                  command: 'uvx',
                  args: ['serena-mcp-server'],
                },
              },
            }),
          },
        ],
      ),
    );

    const capabilities = await registry.discover();
    const serena = capabilities.find((capability) => capability.id === 'serena');

    expect(serena).toMatchObject({
      status: 'available',
      metadata: {
        detectionMethod: 'config',
        configSource: '~/.claude.json',
      },
    });
  });

  it('reports unsupported capabilities as unavailable without failing discovery', async () => {
    const registry = new CapabilityRegistry(dependencies({}));

    const capabilities = await registry.discover();

    expect(capabilities.length).toBeGreaterThan(0);
    expect(capabilities.every((capability) => capability.status === 'unavailable')).toBe(true);
  });
});
