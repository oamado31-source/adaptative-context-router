import type { Capability } from '../core/contracts.js';
import {
  RtkCommandBridge,
  type RtkRewriteResult,
} from '../executors/rtk-bridge.js';
import {
  SerenaMcpBridge,
  type SerenaFindSymbolOptions,
  type SerenaMcpBridgeOptions,
  type SerenaToolResult,
} from '../executors/serena-mcp-bridge.js';

interface RtkBridgeLike {
  health(): Promise<Capability>;
  rewrite(command: string): Promise<RtkRewriteResult>;
}

interface SerenaBridgeLike {
  health(): Promise<Capability>;
  findSymbol(options: SerenaFindSymbolOptions): Promise<SerenaToolResult>;
  getSymbolsOverview(relativePath: string, depth?: number): Promise<SerenaToolResult>;
}

export interface BridgeCliDependencies {
  createRtk(): RtkBridgeLike;
  createSerena(options: SerenaMcpBridgeOptions): SerenaBridgeLike;
  cwd(): string;
  write(text: string): void;
}

const defaultDependencies: BridgeCliDependencies = {
  createRtk: () => new RtkCommandBridge(),
  createSerena: (options) => new SerenaMcpBridge(options),
  cwd: () => process.cwd(),
  write: (text) => console.log(text),
};

export const BRIDGE_CLI_HELP = `ACR real execution bridges

Usage:
  acr bridge rtk health [--json]
  acr bridge rtk rewrite --command <shell-command> [--json]
  acr bridge serena health [--project <path>] [--json]
  acr bridge serena find-symbol --symbol <name-path> [--project <path>] [--relative-path <path>] [--include-body] [--include-info] [--substring] [--depth <n>] [--max-matches <n>] [--json]
  acr bridge serena overview --relative-path <path> [--project <path>] [--depth <n>] [--json]

Serena launch overrides:
  --serena-command <executable>
  --serena-prefix-arg <arg>   May be repeated.

Safety boundary:
  RTK rewrite asks RTK for a rewrite but ACR does not execute the rewritten shell command.
  Serena commands perform explicit read-oriented MCP retrieval. Bridge output is not recorded to telemetry automatically.`;

interface ParsedArgs {
  json: boolean;
  values: ReadonlyMap<string, string>;
  flags: ReadonlySet<string>;
  repeated: ReadonlyMap<string, readonly string[]>;
}

function parseArgs(args: readonly string[]): ParsedArgs {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  const repeated = new Map<string, string[]>();
  const booleanFlags = new Set([
    '--json',
    '--include-body',
    '--include-info',
    '--substring',
  ]);
  const repeatable = new Set(['--serena-prefix-arg']);

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token?.startsWith('--')) {
      throw new Error(`Unexpected bridge argument: ${token ?? '<missing>'}`);
    }
    if (booleanFlags.has(token)) {
      flags.add(token);
      continue;
    }
    const value = args[index + 1];
    if (!value) {
      throw new Error(`Missing value for ${token}.`);
    }
    index += 1;
    if (repeatable.has(token)) {
      const entries = repeated.get(token) ?? [];
      entries.push(value);
      repeated.set(token, entries);
    } else {
      if (values.has(token)) {
        throw new Error(`Bridge option ${token} was supplied more than once.`);
      }
      values.set(token, value);
    }
  }

  return {
    json: flags.has('--json'),
    values,
    flags,
    repeated,
  };
}

function parseInteger(
  parsed: ParsedArgs,
  key: string,
  fallback?: number,
): number | undefined {
  const raw = parsed.values.get(key);
  if (raw === undefined) return fallback;
  if (!/^-?\d+$/.test(raw)) {
    throw new Error(`${key} must be an integer.`);
  }
  return Number.parseInt(raw, 10);
}

function requireValue(parsed: ParsedArgs, key: string): string {
  const value = parsed.values.get(key);
  if (!value?.trim()) {
    throw new Error(`Bridge command requires ${key} <value>.`);
  }
  return value;
}

function writeJson(deps: BridgeCliDependencies, value: unknown): void {
  deps.write(JSON.stringify(value, null, 2));
}

function writeHealth(
  deps: BridgeCliDependencies,
  bridge: string,
  capability: Capability,
  json: boolean,
): void {
  if (json) {
    writeJson(deps, { bridge, capability });
    return;
  }
  deps.write([
    'ACR bridge health',
    `bridge: ${bridge}`,
    `status: ${capability.status}`,
    ...(capability.version ? [`version: ${capability.version}`] : []),
    `reason: ${capability.reason}`,
  ].join('\n'));
}

function serenaOptions(
  parsed: ParsedArgs,
  deps: BridgeCliDependencies,
): SerenaMcpBridgeOptions {
  return {
    projectPath: parsed.values.get('--project') ?? deps.cwd(),
    ...(parsed.values.get('--serena-command')
      ? { command: parsed.values.get('--serena-command') }
      : {}),
    ...(parsed.repeated.get('--serena-prefix-arg')
      ? { commandPrefixArgs: parsed.repeated.get('--serena-prefix-arg') }
      : {}),
  };
}

async function runRtk(
  operation: string | undefined,
  rawArgs: readonly string[],
  deps: BridgeCliDependencies,
): Promise<number> {
  if (!operation || operation === 'help' || operation === '--help') {
    deps.write(BRIDGE_CLI_HELP);
    return 0;
  }
  const parsed = parseArgs(rawArgs);
  const bridge = deps.createRtk();

  if (operation === 'health') {
    writeHealth(deps, 'rtk', await bridge.health(), parsed.json);
    return 0;
  }
  if (operation !== 'rewrite') {
    throw new Error(`Unknown RTK bridge operation: ${operation}.`);
  }

  const command = requireValue(parsed, '--command');
  const result = await bridge.rewrite(command);
  if (parsed.json) {
    writeJson(deps, {
      bridge: 'rtk',
      operation: 'rewrite',
      executed: false,
      ...result,
    });
  } else {
    deps.write([
      'ACR bridge RTK rewrite',
      `disposition: ${result.disposition}`,
      `changed: ${result.changed ? 'yes' : 'no'}`,
      `rtk-exit-code: ${result.exitCode}`,
      ...(result.version ? [`rtk-version: ${result.version}`] : []),
      ...(result.rewrittenCommand
        ? [`rewritten-command: ${result.rewrittenCommand}`]
        : []),
      'executed: no — ACR only requested the rewrite.',
    ].join('\n'));
  }
  return result.disposition === 'denied' ? 2 : 0;
}

function writeSerenaToolResult(
  deps: BridgeCliDependencies,
  operation: string,
  result: SerenaToolResult,
  json: boolean,
): void {
  if (json) {
    writeJson(deps, {
      bridge: 'serena',
      operation,
      result,
    });
    return;
  }
  deps.write([
    `ACR bridge Serena ${operation}`,
    `tool: ${result.tool}`,
    `tool-error: ${result.isError ? 'yes' : 'no'}`,
    'result:',
    result.text || '(no text content)',
  ].join('\n'));
}

async function runSerena(
  operation: string | undefined,
  rawArgs: readonly string[],
  deps: BridgeCliDependencies,
): Promise<number> {
  if (!operation || operation === 'help' || operation === '--help') {
    deps.write(BRIDGE_CLI_HELP);
    return 0;
  }
  const parsed = parseArgs(rawArgs);
  const bridge = deps.createSerena(serenaOptions(parsed, deps));

  if (operation === 'health') {
    writeHealth(deps, 'serena', await bridge.health(), parsed.json);
    return 0;
  }

  if (operation === 'find-symbol') {
    const depth = parseInteger(parsed, '--depth', 0);
    const maxMatches = parseInteger(parsed, '--max-matches', -1);
    const result = await bridge.findSymbol({
      namePathPattern: requireValue(parsed, '--symbol'),
      ...(parsed.values.get('--relative-path')
        ? { relativePath: parsed.values.get('--relative-path') }
        : {}),
      includeBody: parsed.flags.has('--include-body'),
      includeInfo: parsed.flags.has('--include-info'),
      substringMatching: parsed.flags.has('--substring'),
      ...(depth !== undefined ? { depth } : {}),
      ...(maxMatches !== undefined ? { maxMatches } : {}),
    });
    writeSerenaToolResult(deps, operation, result, parsed.json);
    return result.isError ? 1 : 0;
  }

  if (operation === 'overview') {
    const result = await bridge.getSymbolsOverview(
      requireValue(parsed, '--relative-path'),
      parseInteger(parsed, '--depth', -1),
    );
    writeSerenaToolResult(deps, operation, result, parsed.json);
    return result.isError ? 1 : 0;
  }

  throw new Error(`Unknown Serena bridge operation: ${operation}.`);
}

export async function runBridgeCli(
  args: readonly string[],
  deps: BridgeCliDependencies = defaultDependencies,
): Promise<number> {
  const [bridge, operation, ...rest] = args;
  if (!bridge || bridge === 'help' || bridge === '--help') {
    deps.write(BRIDGE_CLI_HELP);
    return 0;
  }
  if (bridge === 'rtk') return runRtk(operation, rest, deps);
  if (bridge === 'serena') return runSerena(operation, rest, deps);
  throw new Error(`Unknown execution bridge: ${bridge}.`);
}
