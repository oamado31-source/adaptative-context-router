import type {
  AdapterApplyRequest,
  AdapterExecutor,
  AdapterExecutorResult,
  AdapterPlan,
  Capability,
} from '../core/contracts.js';
import {
  NodeCommandRunner,
  type CommandRunResult,
  type CommandRunner,
} from './process-runner.js';

const MIN_RTK_VERSION = [0, 23, 0] as const;

export type RtkRewriteDisposition =
  | 'rewritten'
  | 'unchanged'
  | 'passthrough'
  | 'denied'
  | 'approval-required';

export interface RtkRewriteResult {
  disposition: RtkRewriteDisposition;
  exitCode: number;
  changed: boolean;
  rewrittenCommand?: string;
  version?: string;
}

function parseVersion(raw: string): string | undefined {
  return raw.match(/(?:rtk\s+)?(\d+\.\d+\.\d+)/i)?.[1];
}

function isSupportedVersion(version: string): boolean {
  const parts = version.split('.').map((part) => Number.parseInt(part, 10));
  for (let index = 0; index < MIN_RTK_VERSION.length; index += 1) {
    const actual = parts[index] ?? 0;
    const minimum = MIN_RTK_VERSION[index] ?? 0;
    if (actual > minimum) return true;
    if (actual < minimum) return false;
  }
  return true;
}

function ensureUsableRun(result: CommandRunResult, context: string): void {
  if (result.timedOut) {
    throw new Error(`${context} timed out.`);
  }
  if (result.truncated) {
    throw new Error(`${context} produced unexpectedly large output.`);
  }
}

export class RtkCommandBridge implements AdapterExecutor {
  readonly #runner: CommandRunner;
  readonly #timeoutMs: number;
  #versionPromise?: Promise<string>;

  constructor(
    runner: CommandRunner = new NodeCommandRunner(),
    timeoutMs = 5000,
  ) {
    this.#runner = runner;
    this.#timeoutMs = timeoutMs;
  }

  async health(): Promise<Capability> {
    try {
      const version = await this.#getVersion();
      return {
        id: 'rtk',
        name: 'RTK',
        status: 'available',
        version,
        reason: `rtk ${version} supports the rewrite bridge.`,
      };
    } catch (error) {
      return {
        id: 'rtk',
        name: 'RTK',
        status: 'unavailable',
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async rewrite(command: string): Promise<RtkRewriteResult> {
    if (!command.trim()) {
      throw new Error('RTK rewrite requires a non-empty shell command.');
    }
    if (command.includes('\0')) {
      throw new Error('RTK rewrite rejects commands containing NUL bytes.');
    }
    if (command.length > 32_768) {
      throw new Error('RTK rewrite input exceeds the 32 KiB safety limit.');
    }

    const version = await this.#getVersion();
    const result = await this.#runner.run(
      'rtk',
      ['rewrite', '--', command],
      { timeoutMs: this.#timeoutMs, maxOutputChars: 64 * 1024 },
    );
    ensureUsableRun(result, 'rtk rewrite');

    const exitCode = result.exitCode ?? -1;
    const rewrittenCommand = result.stdout.trimEnd();

    if (exitCode === 0) {
      if (!rewrittenCommand) {
        throw new Error('rtk rewrite returned exit 0 without a rewritten command.');
      }
      return {
        disposition: rewrittenCommand === command ? 'unchanged' : 'rewritten',
        exitCode,
        changed: rewrittenCommand !== command,
        rewrittenCommand,
        version,
      };
    }

    if (exitCode === 1) {
      return {
        disposition: 'passthrough',
        exitCode,
        changed: false,
        version,
      };
    }

    if (exitCode === 2) {
      return {
        disposition: 'denied',
        exitCode,
        changed: false,
        version,
      };
    }

    if (exitCode === 3) {
      if (!rewrittenCommand) {
        throw new Error('rtk rewrite requested approval without returning a command.');
      }
      return {
        disposition: 'approval-required',
        exitCode,
        changed: rewrittenCommand !== command,
        rewrittenCommand,
        version,
      };
    }

    const detail = result.stderr.trim() || `exit code ${exitCode}`;
    throw new Error(`rtk rewrite failed: ${detail}`);
  }

  async execute(
    plan: AdapterPlan,
    request: AdapterApplyRequest,
  ): Promise<AdapterExecutorResult> {
    if (plan.adapterId !== 'rtk') {
      return {
        success: false,
        detail: `RTK bridge cannot execute adapter ${plan.adapterId}.`,
      };
    }
    if (!plan.actions.some((action) => action.kind === 'command-rewrite')) {
      return {
        success: false,
        detail: 'RTK bridge requires a command-rewrite action.',
      };
    }
    if (!request.input) {
      return {
        success: false,
        detail: 'RTK bridge requires request.input to contain the shell command to rewrite.',
      };
    }

    const result = await this.rewrite(request.input);
    const denied = result.disposition === 'denied';

    return {
      success: !denied,
      detail:
        result.disposition === 'approval-required'
          ? 'RTK produced a safe rewrite that still requires host/user approval before shell execution.'
          : denied
            ? 'RTK denied the rewrite; ACR will not override the host permission policy.'
            : `RTK rewrite disposition: ${result.disposition}.`,
      metadata: {
        disposition: result.disposition,
        rewriteChanged: result.changed,
        rtkExitCode: result.exitCode,
        rtkVersion: result.version ?? 'unknown',
      },
    };
  }

  async #getVersion(): Promise<string> {
    this.#versionPromise ??= this.#probeVersion();
    return this.#versionPromise;
  }

  async #probeVersion(): Promise<string> {
    const result = await this.#runner.run('rtk', ['--version'], {
      timeoutMs: this.#timeoutMs,
      maxOutputChars: 4096,
    });
    ensureUsableRun(result, 'rtk --version');
    if (result.exitCode !== 0) {
      const detail = result.stderr.trim() || `exit code ${result.exitCode ?? 'unknown'}`;
      throw new Error(`RTK is unavailable or incompatible: ${detail}`);
    }

    const version = parseVersion(`${result.stdout}\n${result.stderr}`);
    if (!version) {
      throw new Error('RTK version could not be determined.');
    }
    if (!isSupportedVersion(version)) {
      throw new Error(`RTK ${version} is too old; rewrite bridge requires >= 0.23.0.`);
    }
    return version;
  }
}
