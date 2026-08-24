import { describe, expect, it } from 'vitest';
import {
  BRIDGE_CLI_HELP,
  runBridgeCli,
  type BridgeCliDependencies,
} from '../src/cli/bridges.js';
import type { SerenaMcpBridgeOptions } from '../src/executors/serena-mcp-bridge.js';

function makeDependencies() {
  const output: string[] = [];
  let serenaOptions: SerenaMcpBridgeOptions | undefined;
  let serenaFindOptions: Record<string, unknown> | undefined;

  const deps: BridgeCliDependencies = {
    createRtk: () => ({
      async health() {
        return {
          id: 'rtk',
          name: 'RTK',
          status: 'available',
          version: '0.28.2',
          reason: 'ready',
        };
      },
      async rewrite(command) {
        return {
          disposition: 'rewritten',
          exitCode: 0,
          changed: true,
          rewrittenCommand: `rtk ${command}`,
          version: '0.28.2',
        };
      },
    }),
    createSerena: (options) => {
      serenaOptions = options;
      return {
        async health() {
          return {
            id: 'serena',
            name: 'Serena',
            status: 'available',
            reason: 'ready',
          };
        },
        async findSymbol(options) {
          serenaFindOptions = { ...options };
          return {
            tool: 'find_symbol',
            text: '[{"name_path":"TaskClassifier"}]',
            isError: false,
          };
        },
        async getSymbolsOverview(relativePath, depth) {
          return {
            tool: 'get_symbols_overview',
            text: `${relativePath}:${depth ?? -1}`,
            isError: false,
          };
        },
      };
    },
    cwd: () => '/workspace/acr',
    write: (text) => output.push(text),
  };

  return {
    deps,
    output,
    getSerenaOptions: () => serenaOptions,
    getSerenaFindOptions: () => serenaFindOptions,
  };
}

describe('explicit bridge CLI', () => {
  it('prints bridge help without invoking external tools', async () => {
    const fixture = makeDependencies();

    const code = await runBridgeCli(['help'], fixture.deps);

    expect(code).toBe(0);
    expect(fixture.output).toEqual([BRIDGE_CLI_HELP]);
  });

  it('prints an RTK rewrite while explicitly saying it was not executed', async () => {
    const fixture = makeDependencies();

    const code = await runBridgeCli(
      ['rtk', 'rewrite', '--command', 'git log --oneline'],
      fixture.deps,
    );

    expect(code).toBe(0);
    expect(fixture.output.join('\n')).toContain('rewritten-command: rtk git log --oneline');
    expect(fixture.output.join('\n')).toContain('executed: no');
  });

  it('marks RTK JSON rewrite output as not executed', async () => {
    const fixture = makeDependencies();

    await runBridgeCli(
      ['rtk', 'rewrite', '--command', 'git status', '--json'],
      fixture.deps,
    );

    const payload = JSON.parse(fixture.output[0] ?? '{}') as {
      executed?: boolean;
      rewrittenCommand?: string;
    };
    expect(payload.executed).toBe(false);
    expect(payload.rewrittenCommand).toBe('rtk git status');
  });

  it('uses cwd as the default Serena project and forwards symbolic options', async () => {
    const fixture = makeDependencies();

    const code = await runBridgeCli(
      [
        'serena',
        'find-symbol',
        '--symbol',
        'TaskClassifier',
        '--relative-path',
        'src/core/task-classifier.ts',
        '--include-info',
        '--depth',
        '1',
      ],
      fixture.deps,
    );

    expect(code).toBe(0);
    expect(fixture.getSerenaOptions()).toEqual({
      projectPath: '/workspace/acr',
    });
    expect(fixture.getSerenaFindOptions()).toMatchObject({
      namePathPattern: 'TaskClassifier',
      relativePath: 'src/core/task-classifier.ts',
      includeInfo: true,
      depth: 1,
    });
  });

  it('passes Serena executable overrides as argv components', async () => {
    const fixture = makeDependencies();

    await runBridgeCli(
      [
        'serena',
        'health',
        '--project',
        '/repo',
        '--serena-command',
        'uvx',
        '--serena-prefix-arg',
        '--from',
        '--serena-prefix-arg',
        'serena-agent',
        '--json',
      ],
      fixture.deps,
    );

    expect(fixture.getSerenaOptions()).toEqual({
      projectPath: '/repo',
      command: 'uvx',
      commandPrefixArgs: ['--from', 'serena-agent'],
    });
  });

  it('rejects Serena find-symbol without a symbol pattern', async () => {
    const fixture = makeDependencies();

    await expect(
      runBridgeCli(['serena', 'find-symbol'], fixture.deps),
    ).rejects.toThrow('--symbol');
  });
});
