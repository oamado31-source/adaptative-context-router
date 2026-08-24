import { spawn } from 'node:child_process';

export interface CommandRunOptions {
  cwd?: string;
  timeoutMs?: number;
  maxOutputChars?: number;
}

export interface CommandRunResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
}

export interface CommandRunner {
  run(
    command: string,
    args: readonly string[],
    options?: CommandRunOptions,
  ): Promise<CommandRunResult>;
}

export class NodeCommandRunner implements CommandRunner {
  async run(
    command: string,
    args: readonly string[],
    options: CommandRunOptions = {},
  ): Promise<CommandRunResult> {
    const timeoutMs = options.timeoutMs ?? 5000;
    const maxOutputChars = options.maxOutputChars ?? 128 * 1024;

    return new Promise<CommandRunResult>((resolve, reject) => {
      const child = spawn(command, [...args], {
        ...(options.cwd ? { cwd: options.cwd } : {}),
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let truncated = false;
      let timedOut = false;
      let settled = false;

      const append = (current: string, chunk: Buffer): string => {
        if (current.length >= maxOutputChars) {
          truncated = true;
          return current;
        }
        const next = current + chunk.toString('utf8');
        if (next.length > maxOutputChars) {
          truncated = true;
          return next.slice(0, maxOutputChars);
        }
        return next;
      };

      child.stdout.on('data', (chunk: Buffer) => {
        stdout = append(stdout, chunk);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr = append(stderr, chunk);
      });

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, timeoutMs);

      child.once('error', (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });

      child.once('close', (exitCode, signal) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          exitCode,
          signal,
          stdout,
          stderr,
          timedOut,
          truncated,
        });
      });
    });
  }
}
