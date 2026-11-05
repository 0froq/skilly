import { homedir } from 'node:os';
import { WriteStream } from 'node:tty';
import { useApp, useInput, useStdout, Text } from 'ink';
import { Component, useEffect, useRef, useState, type ReactNode } from 'react';
import { buildAddArgs, buildCheckArgs, buildUpdateArgs } from './commands.js';
import { writeConfig } from './config.js';
import { refreshAll } from './load.js';
import { performRemoval, withRemoval } from './removal.js';
import { applyCheck, initialModel, withRefresh, type AppModel } from './model.js';
import { parseCheckOutput } from './parse.js';
import { blankKey, reduceKey, type Effect, type KeyInfo, type KeyPress } from './reduce.js';
import { formatCommandLine, runSkills } from './skills-cli.js';
import { checkTargets, projectCwd, updateAllTargets } from './targets.js';
import { appendLog, firstLine, stripNpmNoise } from './text.js';
import { Screen } from './ui.js';

export function App(props: { configPath: string; version: string }) {
  return (
    <ErrorBoundary>
      <Shell configPath={props.configPath} version={props.version} />
    </ErrorBoundary>
  );
}

function Shell(props: { configPath: string; version: string }) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [model, setModel] = useState<AppModel>(() => initialModel(props.configPath));
  const [size, setSize] = useState(() => terminalSize(stdout));
  const modelRef = useRef(model);
  modelRef.current = model;
  const jobRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const alive = (job: number): boolean => jobRef.current === job;

  const begin = (): { job: number; signal: AbortSignal } => {
    const job = jobRef.current + 1;
    jobRef.current = job;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    return { job, signal: controller.signal };
  };

  const noteChunk = (job: number, chunk: string): void => {
    if (!alive(job)) return;
    const cleaned = stripNpmNoise(chunk);
    if (!cleaned.trim()) return;
    setModel((current) => ({ ...current, logText: appendLog(current.logText, cleaned) }));
  };

  const finishRefresh = async (job: number, signal: AbortSignal, prefix: string | null): Promise<void> => {
    if (!alive(job)) return;
    const data = await refreshAll(props.configPath, {
      signal,
      onProgress: (scan) => {
        if (!alive(job)) return;
        const notice = scan.total > 0 ? `${scan.label} ${scan.completed}/${scan.total}` : scan.label;
        setModel((current) => ({ ...current, scan, notice }));
      },
    });
    if (!alive(job) || data.aborted) return;
    setModel((current) => {
      const next = withRefresh(current, data);
      return {
        ...next,
        logText: current.logText || data.log,
        notice: prefix ? `${prefix} · ${next.notice}` : next.notice,
      };
    });
  };

  const runRefresh = async (): Promise<void> => {
    const { job, signal } = begin();
    setModel((current) => ({
      ...current,
      phase: { type: 'busy' },
      notice: 'Scanning…',
      logText: '',
      scan: { label: 'Finding projects', completed: 0, total: 0, current: '', found: 0 },
    }));
    await finishRefresh(job, signal, null);
  };

  const runEffect = async (effect: Effect, snapshot: AppModel): Promise<void> => {
    try {
      switch (effect.type) {
        case 'none':
          return;
        case 'quit':
          jobRef.current += 1;
          abortRef.current?.abort();
          exit();
          return;
        case 'refresh':
          await runRefresh();
          return;
        case 'check':
          await runCheck(snapshot);
          return;
        case 'update-one':
          await runUpdates(snapshot, [{ global: effect.skill.scope === 'global', projectPath: effect.skill.projectPath, names: [effect.skill.name] }], 'Updated');
          return;
        case 'update-all':
          await runUpdates(snapshot, updateAllTargets(snapshot), 'Updated');
          return;
        case 'remove':
          await runRemove(effect, snapshot);
          return;
        case 'add':
          await runAdd(effect);
          return;
        case 'save-config': {
          await writeConfig(props.configPath, effect.globs);
          const saved = begin();
          setModel((current) => ({
            ...current,
            phase: { type: 'busy' },
            notice: 'Scanning…',
            logText: '',
            scan: { label: 'Finding projects', completed: 0, total: 0, current: '', found: 0 },
          }));
          await finishRefresh(saved.job, saved.signal, 'Saved');
          return;
        }
        default: {
          const unreachable: never = effect;
          return unreachable;
        }
      }
    } catch (error) {
      setModel((current) => ({
        ...current,
        phase: { type: 'browse' },
        scan: null,
        notice: error instanceof Error ? error.message : 'Command failed',
      }));
    }
  };

  const runCheck = async (snapshot: AppModel): Promise<void> => {
    const targets = checkTargets(snapshot);
    if (targets.length === 0) {
      setModel((current) => ({ ...current, phase: { type: 'browse' }, notice: 'Nothing to check in this view' }));
      return;
    }
    const { job, signal } = begin();
    setModel((current) => ({ ...current, phase: { type: 'busy' }, notice: 'Checking…', logText: '' }));
    let updates = { ...snapshot.updates };
    const problems: string[] = [];
    for (const target of targets) {
      if (!alive(job)) return;
      const args = buildCheckArgs(target);
      const cwd = projectCwd(target, homedir());
      const header = `\n$ ${formatCommandLine(args, cwd)}\n`;
      noteChunk(job, header);
      const result = await runSkills(args, {
        cwd,
        signal,
        timeoutMs: 180_000,
        onChunk: (chunk) => noteChunk(job, chunk),
      });
      if (!alive(job) || result.aborted) return;
      if (result.timedOut || (result.code !== 0 && result.code !== 1)) {
        problems.push(firstLine(result.stderr) || `${cwd}: check failed`);
        continue;
      }
      const parsed = parseCheckOutput(result.stdout);
      updates = applyCheck(snapshot.skills, updates, target, parsed.outdated);
    }
    if (!alive(job)) return;
    const outdated = Object.values(updates).filter((state) => state === 'outdated').length;
    const notice =
      problems[0] ?? (outdated > 0 ? `${outdated} update${outdated === 1 ? '' : 's'} available` : 'Up to date');
    setModel((current) => ({ ...current, phase: { type: 'browse' }, updates, notice }));
  };

  const runUpdates = async (
    snapshot: AppModel,
    targets: ReturnType<typeof updateAllTargets>,
    okNotice: string,
  ): Promise<void> => {
    if (targets.length === 0) {
      setModel((current) => ({ ...current, phase: { type: 'browse' }, notice: 'No tracked skills to update' }));
      return;
    }
    const { job, signal } = begin();
    setModel((current) => ({ ...current, phase: { type: 'busy' }, notice: 'Updating…', logText: '' }));
    const problems: string[] = [];
    for (const target of targets) {
      if (!alive(job)) return;
      const args = buildUpdateArgs(target);
      const cwd = projectCwd(target, homedir());
      const header = `\n$ ${formatCommandLine(args, cwd)}\n`;
      noteChunk(job, header);
      const result = await runSkills(args, {
        cwd,
        signal,
        timeoutMs: 180_000,
        onChunk: (chunk) => noteChunk(job, chunk),
      });
      if (!alive(job) || result.aborted) return;
      if (result.timedOut || result.code !== 0) {
        problems.push(firstLine(result.stderr || result.stdout) || `${cwd}: update failed`);
      }
    }
    if (!alive(job)) return;
    await finishRefresh(job, signal, problems[0] ?? okNotice);
  };

  const runRemove = async (effect: Extract<Effect, { type: 'remove' }>, snapshot: AppModel): Promise<void> => {
    const { job, signal } = begin();
    setModel((current) => ({
      ...current,
      phase: { type: 'busy' },
      scan: null,
      notice: `Removing ${effect.skill.name}…`,
      logText: '',
    }));
    const outcome = await performRemoval({
      skill: effect.skill,
      skills: snapshot.skills,
      home: homedir(),
      signal,
    });
    if (!alive(job)) return;
    setModel((current) => withRemoval(current, outcome.skills, outcome.notice, outcome.log));
  };

  const runAdd = async (effect: Extract<Effect, { type: 'add' }>): Promise<void> => {
    const { job, signal } = begin();
    setModel((current) => ({ ...current, phase: { type: 'busy' }, notice: 'Adding…', logText: '' }));
    const args = buildAddArgs(effect);
    const header = `\n$ ${formatCommandLine(args, effect.cwd)}\n`;
    noteChunk(job, header);
    const result = await runSkills(args, {
      cwd: effect.cwd,
      signal,
      timeoutMs: 180_000,
      onChunk: (chunk) => noteChunk(job, chunk),
    });
    if (!alive(job) || result.aborted) return;
    const prefix = result.code === 0 ? 'Added' : firstLine(result.stderr || result.stdout) || 'Add failed';
    await finishRefresh(job, signal, prefix);
  };

  const refreshRef = useRef(runRefresh);
  refreshRef.current = runRefresh;
  const effectRef = useRef(runEffect);
  effectRef.current = runEffect;

  useEffect(() => {
    const terminal = stdout as WriteStream;
    const onResize = (): void => {
      setSize(terminalSize(terminal));
    };
    terminal.on('resize', onResize);
    return () => {
      terminal.off('resize', onResize);
    };
  }, [stdout]);

  useEffect(() => {
    void refreshRef.current();
    return () => {
      jobRef.current += 1;
      abortRef.current?.abort();
    };
  }, []);

  useInput((input, key) => {
    const current = modelRef.current;
    const result = reduceKey(current, toKey(input, key));
    modelRef.current = result.model;
    setModel(result.model);
    void effectRef.current(result.effect, result.model);
  });

  return <Screen model={model} version={props.version} columns={size.columns} rows={size.rows} />;
}

function terminalSize(stream: NodeJS.WritableStream): { columns: number; rows: number } {
  const terminal = stream as WriteStream;
  return {
    columns: terminal.columns || 80,
    rows: terminal.rows || 24,
  };
}

function toKey(input: string, key: Partial<KeyInfo>): KeyPress {
  const base = blankKey();
  return {
    input,
    key: {
      ...base,
      upArrow: Boolean(key.upArrow),
      downArrow: Boolean(key.downArrow),
      return: Boolean(key.return),
      escape: Boolean(key.escape),
      ctrl: Boolean(key.ctrl),
      shift: Boolean(key.shift),
      tab: Boolean(key.tab),
      backspace: Boolean(key.backspace),
      delete: Boolean(key.delete),
      pageDown: Boolean(key.pageDown),
      pageUp: Boolean(key.pageUp),
      home: Boolean(key.home),
      end: Boolean(key.end),
      meta: Boolean(key.meta),
    },
  };
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  override render(): ReactNode {
    if (this.state.error) {
      return <Text color="red">skilly crashed: {this.state.error.message}</Text>;
    }
    return this.props.children;
  }
}
