import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import type {
  AdapterApplyRequest,
  AdapterExecutor,
  AdapterExecutorResult,
  AdapterPlan,
  Capability,
} from '../core/contracts.js';

export interface SerenaToolResult {
  tool: string;
  text: string;
  isError: boolean;
  structuredContent?: Readonly<Record<string, unknown>>;
}

export interface SerenaFindSymbolOptions {
  namePathPattern: string;
  relativePath?: string;
  includeBody?: boolean;
  includeInfo?: boolean;
  depth?: number;
  substringMatching?: boolean;
  maxMatches?: number;
}

export interface SerenaSession {
  listTools(): Promise<readonly string[]>;
  callTool(
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<SerenaToolResult>;
  close(): Promise<void>;
}

export interface SerenaSessionOptions {
  command: string;
  args: readonly string[];
}

export type SerenaSessionFactory = (
  options: SerenaSessionOptions,
) => Promise<SerenaSession>;

export interface SerenaMcpBridgeOptions {
  projectPath: string;
  command?: string;
  commandPrefixArgs?: readonly string[];
  context?: string;
  sessionFactory?: SerenaSessionFactory;
}

function asStructuredContent(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function extractText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .filter(
      (item): item is { type: 'text'; text: string } =>
        Boolean(
          item &&
            typeof item === 'object' &&
            (item as { type?: unknown }).type === 'text' &&
            typeof (item as { text?: unknown }).text === 'string',
        ),
    )
    .map((item) => item.text)
    .join('\n');
}

export const createSdkSerenaSession: SerenaSessionFactory = async (options) => {
  const client = new Client({
    name: 'acr-serena-bridge',
    version: '0.1.0',
  });
  const transport = new StdioClientTransport({
    command: options.command,
    args: [...options.args],
  });
  await client.connect(transport);

  return {
    async listTools() {
      const response = await client.listTools();
      return response.tools.map((tool) => tool.name);
    },
    async callTool(name, args) {
      const result = await client.callTool({ name, arguments: args });
      const structuredContent = asStructuredContent(result.structuredContent);
      return {
        tool: name,
        text: extractText(result.content),
        isError: result.isError === true,
        ...(structuredContent ? { structuredContent } : {}),
      };
    },
    async close() {
      await client.close();
    },
  };
};

export class SerenaMcpBridge implements AdapterExecutor {
  readonly #projectPath: string;
  readonly #command: string;
  readonly #commandPrefixArgs: readonly string[];
  readonly #context: string;
  readonly #sessionFactory: SerenaSessionFactory;

  constructor(options: SerenaMcpBridgeOptions) {
    if (!options.projectPath.trim()) {
      throw new Error('Serena bridge requires a project path.');
    }
    this.#projectPath = options.projectPath;
    this.#command = options.command ?? 'serena';
    this.#commandPrefixArgs = options.commandPrefixArgs ?? [];
    this.#context = options.context ?? 'claude-code';
    this.#sessionFactory = options.sessionFactory ?? createSdkSerenaSession;
  }

  async health(): Promise<Capability> {
    let session: SerenaSession | undefined;
    try {
      session = await this.#openSession();
      const tools = await session.listTools();
      const required = ['find_symbol', 'get_symbols_overview'];
      const missing = required.filter((tool) => !tools.includes(tool));
      if (missing.length > 0) {
        return {
          id: 'serena',
          name: 'Serena',
          status: 'incompatible',
          reason: `Serena MCP server is missing required tools: ${missing.join(', ')}.`,
        };
      }
      return {
        id: 'serena',
        name: 'Serena',
        status: 'available',
        reason: 'Serena MCP server exposes the required symbolic retrieval tools.',
        metadata: {
          toolCount: tools.length,
        },
      };
    } catch (error) {
      return {
        id: 'serena',
        name: 'Serena',
        status: 'unavailable',
        reason: error instanceof Error ? error.message : String(error),
      };
    } finally {
      await session?.close().catch(() => undefined);
    }
  }

  async findSymbol(options: SerenaFindSymbolOptions): Promise<SerenaToolResult> {
    if (!options.namePathPattern.trim()) {
      throw new Error('Serena find_symbol requires a non-empty name path pattern.');
    }

    return this.#withTool(
      'find_symbol',
      {
        name_path_pattern: options.namePathPattern,
        relative_path: options.relativePath ?? '',
        include_body: options.includeBody ?? false,
        include_info: options.includeInfo ?? false,
        depth: options.depth ?? 0,
        substring_matching: options.substringMatching ?? false,
        max_matches: options.maxMatches ?? -1,
      },
    );
  }

  async getSymbolsOverview(
    relativePath: string,
    depth = -1,
  ): Promise<SerenaToolResult> {
    if (!relativePath.trim()) {
      throw new Error('Serena get_symbols_overview requires a relative path.');
    }
    return this.#withTool('get_symbols_overview', {
      relative_path: relativePath,
      depth,
    });
  }

  async execute(
    plan: AdapterPlan,
    request: AdapterApplyRequest,
  ): Promise<AdapterExecutorResult> {
    if (plan.adapterId !== 'serena') {
      return {
        success: false,
        detail: `Serena bridge cannot execute adapter ${plan.adapterId}.`,
      };
    }
    if (!plan.actions.some((action) => action.kind === 'mcp-invocation')) {
      return {
        success: false,
        detail: 'Serena bridge requires an mcp-invocation action.',
      };
    }
    if (!request.input) {
      return {
        success: false,
        detail: 'Serena bridge requires request.input to contain the symbol name/path pattern.',
      };
    }

    const result = await this.findSymbol({ namePathPattern: request.input });
    return {
      success: !result.isError,
      detail: result.isError
        ? 'Serena find_symbol reported a tool-level error.'
        : 'Serena find_symbol completed successfully.',
      metadata: {
        tool: result.tool,
        resultChars: result.text.length,
      },
    };
  }

  async #withTool(
    tool: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<SerenaToolResult> {
    let session: SerenaSession | undefined;
    try {
      session = await this.#openSession();
      const tools = await session.listTools();
      if (!tools.includes(tool)) {
        throw new Error(`Serena MCP server does not expose required tool ${tool}.`);
      }
      return await session.callTool(tool, args);
    } finally {
      await session?.close().catch(() => undefined);
    }
  }

  async #openSession(): Promise<SerenaSession> {
    const args = [
      ...this.#commandPrefixArgs,
      'start-mcp-server',
      '--context',
      this.#context,
      '--project',
      this.#projectPath,
      '--enable-web-dashboard',
      'false',
      '--open-web-dashboard',
      'false',
    ];
    return this.#sessionFactory({ command: this.#command, args });
  }
}
