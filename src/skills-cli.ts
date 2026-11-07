import { spawn } from 'node:child_process';
import { assertNoCopy } from './commands.js';

export interface SkillsResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  aborted: boolean;
  command: string;
}

export interface RunSkillsOptions {
  cwd?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  onChunk?: (chunk: string) => void;
}

export function skillsCommand(): { command: string; prefix: string[] } {
  const override = process.env.SKILLY_SKILLS_BIN?.trim();
  if (override) return { command: override, prefix: [] };
  return { command: 'npx', prefix: ['--yes', 'skills'] };
}

export function quoteArg(value: string): string {
  if (/^[A-Za-z0-9_./:~*=,@+-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function formatCommandLine(args: readonly string[], cwd?: string): string {
  const { command, prefix } = skillsCommand();
  const shown = [command, ...prefix, ...args].map(quoteArg).join(' ');
  return cwd ? `${shown}  # cwd ${cwd}` : shown;
}

function childEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NO_UPDATE_NOTIFIER: '1',
    npm_config_update_notifier: 'false',
    npm_config_fund: 'false',
    npm_config_loglevel: 'error',
  };
}

export async function runSkills(args: readonly string[], options: RunSkillsOptions = {}): Promise<SkillsResult> {
  assertNoCopy(args);
  const { command, prefix } = skillsCommand();
  const fullArgs = [...prefix, ...args];
  const commandLine = formatCommandLine(args, options.cwd);

  if (options.signal?.aborted) {
    return { code: null, stdout: '', stderr: '', timedOut: false, aborted: true, command: commandLine };
  }

  return await new Promise((resolve) => {
    const child = spawn(command, fullArgs, {
      cwd: options.cwd,
      env: childEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let aborted = false;
    let settled = false;

    const finish = (code: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut, aborted, command: commandLine });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      stderr += '\ntimed out\n';
      child.kill('SIGTERM');
    }, options.timeoutMs ?? 120_000);

    const onAbort = (): void => {
      aborted = true;
      child.kill('SIGTERM');
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      options.onChunk?.(chunk);
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
      options.onChunk?.(chunk);
    });
    child.on('error', (error) => {
      stderr += error.message;
      options.signal?.removeEventListener('abort', onAbort);
      finish(1);
    });
    child.on('close', (code) => {
      options.signal?.removeEventListener('abort', onAbort);
      finish(code);
    });
  });
}
