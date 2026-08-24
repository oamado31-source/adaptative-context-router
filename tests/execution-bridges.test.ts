import { describe, expect, it } from 'vitest';
import type {
  AdapterApplyRequest,
  AdapterPlan,
} from '../src/core/contracts.js';
import {
  RtkCommandBridge,
} from '../src/executors/rtk-bridge.js';
import type {
  CommandRunOptions,
  CommandRunResult,
  CommandRunner,
} from '../src/executors/process-runner.js';
import {
  SerenaMcpBridge,
  type SerenaSession,
  type SerenaSessionFactory,
  type SerenaSessionOptions,
} from '../src/executors/serena-mcp-bridge.js';

function commandResult(
  overrides: Partial<CommandRunResult> = {},
): CommandRunResult {
  return {
    exitCode: 0,
    signal: null,
    stdout: '',
    stderr: '',
    timedOut: false,
    truncated: false,
    ...overrides,
  };
}

class FakeRunner implements CommandRunner {
  readonly calls: Array<{
    command: string;
    args: readonly string[];
    options?: CommandRunOptions;
  }> = [];
  readonly responses: Array<CommandRunResult | Error> = [];

  async run(
    command: string,
    args: readonly string[],
    options?: CommandRunOptions,
  ): Promise<CommandRunResult> {
    this.calls.push({ command, args, ...(options ? { options } : {}) });
    const response = this.responses.shift();
    if (!response) throw new Error('FakeRunner has no queued response.');
    if (response instanceof Error) throw response;
    return response;
  }
}

const rtkPlan: AdapterPlan = {
  adapterId: 'rtk',
  displayName: 'RTK',
  actions: [
    {
      id: 'rtk:primary',
      kind: 'command-rewrite',
      summary: 'rewrite',
      capabilityId: 'rtk',
      external: true,
      destructive: false,
    },
  ],
  risk: 'low',
  requiresExternalExecution: true,
  requiresApproval: false,
  reversible: false,
  blocked: false,
  reasons: [],
};

const bridgeRequest = (input: string): AdapterApplyRequest => ({
  task: {
    taskType: 'large_logs',
    precision: 'semantic',
    risk: 'low',
    confidence: 0.95,
    requiresExactIdentifiers: false,
  },
  context: {
    estimatedTokens: 20_000,
    contextWindowTokens: 32_000,
    utilizationRatio: 0.625,
    source: 'estimated',
  },
  mode: 'auto',
  input,
});

describe('RTK real execution bridge', () => {
  it('probes a supported RTK version', async () => {
    const runner = new FakeRunner();
    runner.responses.push(commandResult({ stdout: 'rtk 0.28.2\n' }));

    const health = await new RtkCommandBridge(runner).health();

    expect(health.status).toBe('available');
    expect(health.version).toBe('0.28.2');
    expect(runner.calls[0]).toMatchObject({
      command: 'rtk',
      args: ['--version'],
    });
  });

  it('uses an argument terminator before the raw command', async () => {
    const runner = new FakeRunner();
    runner.responses.push(
      commandResult({ stdout: 'rtk 0.28.2\n' }),
      commandResult({ stdout: 'rtk raw --help\n' }),
    );

    const result = await new RtkCommandBridge(runner).rewrite('--help');

    expect(result.disposition).toBe('rewritten');
    expect(runner.calls[1]).toMatchObject({
      command: 'rtk',
      args: ['rewrite', '--', '--help'],
    });
  });

  it('refuses incompatible RTK versions before rewrite execution', async () => {
    const runner = new FakeRunner();
    runner.responses.push(commandResult({ stdout: 'rtk 0.22.9\n' }));

    await expect(new RtkCommandBridge(runner).rewrite('git status')).rejects.toThrow(
      'requires >= 0.23.0',
    );
    expect(runner.calls).toHaveLength(1);
  });

  it('does not put the raw shell command into executor metadata', async () => {
    const runner = new FakeRunner();
    runner.responses.push(
      commandResult({ stdout: 'rtk 0.28.2\n' }),
      commandResult({ stdout: 'rtk git log --oneline\n' }),
    );
    const secretLikeInput = 'git log --token=do-not-persist';

    const result = await new RtkCommandBridge(runner).execute(
      rtkPlan,
      bridgeRequest(secretLikeInput),
    );

    expect(result.success).toBe(true);
    expect(JSON.stringify(result.metadata)).not.toContain('do-not-persist');
    expect(result.metadata).toMatchObject({
      disposition: 'rewritten',
      rewriteChanged: true,
      rtkExitCode: 0,
    });
  });

  it('does not override an RTK deny disposition', async () => {
    const runner = new FakeRunner();
    runner.responses.push(
      commandResult({ stdout: 'rtk 0.28.2\n' }),
      commandResult({ exitCode: 2 }),
    );

    const result = await new RtkCommandBridge(runner).execute(
      rtkPlan,
      bridgeRequest('rm -rf example'),
    );

    expect(result.success).toBe(false);
    expect(result.metadata).toMatchObject({ disposition: 'denied', rtkExitCode: 2 });
  });
});

interface FakeSerenaState {
  startup?: SerenaSessionOptions;
  closed: boolean;
  calls: Array<{ name: string; args: Readonly<Record<string, unknown>> }>;
}

function fakeSerenaFactory(
  state: FakeSerenaState,
  tools: readonly string[] = ['find_symbol', 'get_symbols_overview'],
  callImplementation?: SerenaSession['callTool'],
): SerenaSessionFactory {
  return async (options) => {
    state.startup = options;
    return {
      async listTools() {
        return tools;
      },
      async callTool(name, args) {
        state.calls.push({ name, args });
        if (callImplementation) return callImplementation(name, args);
        return {
          tool: name,
          text: '[{"name_path":"authenticateUser"}]',
          isError: false,
        };
      },
      async close() {
        state.closed = true;
      },
    };
  };
}

describe('Serena real MCP bridge', () => {
  it('starts Serena in stdio mode and calls the official find_symbol tool shape', async () => {
    const state: FakeSerenaState = { closed: false, calls: [] };
    const bridge = new SerenaMcpBridge({
      projectPath: '/repo',
      sessionFactory: fakeSerenaFactory(state),
    });

    const result = await bridge.findSymbol({
      namePathPattern: 'authenticateUser',
      relativePath: 'src/auth.ts',
      includeInfo: true,
    });

    expect(result.isError).toBe(false);
    expect(state.startup).toEqual({
      command: 'serena',
      args: [
        'start-mcp-server',
        '--context',
        'ide-assistant',
        '--project',
        '/repo',
        '--enable-web-dashboard',
        'false',
        '--open-web-dashboard',
        'false',
      ],
    });
    expect(state.calls).toEqual([
      {
        name: 'find_symbol',
        args: {
          name_path_pattern: 'authenticateUser',
          relative_path: 'src/auth.ts',
          include_body: false,
          include_info: true,
          depth: 0,
          substring_matching: false,
          max_matches: -1,
        },
      },
    ]);
    expect(state.closed).toBe(true);
  });

  it('reports an incompatible Serena server when symbolic tools are missing', async () => {
    const state: FakeSerenaState = { closed: false, calls: [] };
    const bridge = new SerenaMcpBridge({
      projectPath: '/repo',
      sessionFactory: fakeSerenaFactory(state, ['find_symbol']),
    });

    const health = await bridge.health();

    expect(health.status).toBe('incompatible');
    expect(health.reason).toContain('get_symbols_overview');
    expect(state.closed).toBe(true);
  });

  it('closes the MCP session when a Serena tool call throws', async () => {
    const state: FakeSerenaState = { closed: false, calls: [] };
    const bridge = new SerenaMcpBridge({
      projectPath: '/repo',
      sessionFactory: fakeSerenaFactory(
        state,
        undefined,
        async () => {
          throw new Error('tool failed');
        },
      ),
    });

    await expect(
      bridge.findSymbol({ namePathPattern: 'authenticateUser' }),
    ).rejects.toThrow('tool failed');
    expect(state.closed).toBe(true);
  });

  it('returns only result size/tool metadata through AdapterExecutor', async () => {
    const state: FakeSerenaState = { closed: false, calls: [] };
    const bridge = new SerenaMcpBridge({
      projectPath: '/repo',
      sessionFactory: fakeSerenaFactory(state),
    });
    const plan: AdapterPlan = {
      adapterId: 'serena',
      displayName: 'Serena',
      actions: [
        {
          id: 'serena:primary',
          kind: 'mcp-invocation',
          summary: 'symbol retrieval',
          capabilityId: 'serena',
          external: true,
          destructive: false,
        },
      ],
      risk: 'low',
      requiresExternalExecution: true,
      requiresApproval: false,
      reversible: false,
      blocked: false,
      reasons: [],
    };

    const result = await bridge.execute(plan, {
      ...bridgeRequest('authenticateUser'),
      task: {
        ...bridgeRequest('authenticateUser').task,
        taskType: 'targeted_code_search',
        precision: 'structural',
        risk: 'medium',
      },
    });

    expect(result.success).toBe(true);
    expect(result.metadata).toMatchObject({ tool: 'find_symbol' });
    expect(JSON.stringify(result.metadata)).not.toContain('authenticateUser');
  });
});
