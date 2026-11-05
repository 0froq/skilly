import { buildListArgs, buildRemoveArgs } from './commands.js';
import { skillsFromListResult } from './load.js';
import {
  clampSelection,
  compareSkills,
  selectedSkill,
  visibleSkills,
  type AppModel,
  type SkillRow,
} from './model.js';
import { formatCommandLine, runSkills, type SkillsResult } from './skills-cli.js';
import { stripAnsi, stripNpmNoise } from './text.js';

export interface RemovalCall {
  args: string[];
  cwd: string;
}

export interface RemovalOutcome {
  skills: SkillRow[];
  notice: string;
  log: string;
  removed: boolean;
  calls: RemovalCall[];
}

export function inRemovalScope(skill: SkillRow, scope: { global: boolean; projectPath: string | null }): boolean {
  if (scope.global) return skill.scope === 'global';
  return skill.scope === 'project' && skill.projectPath === scope.projectPath;
}

export function replaceScopeSkills(
  skills: readonly SkillRow[],
  scope: { global: boolean; projectPath: string | null },
  next: readonly SkillRow[],
): SkillRow[] {
  return [...skills.filter((skill) => !inRemovalScope(skill, scope)), ...next].sort(compareSkills);
}

export function removalHint(output: string): string | null {
  const text = stripNpmNoise(stripAnsi(output));
  const unmatched = text.match(/No matching skills found[^\n]*/i);
  if (unmatched?.[0]) return unmatched[0].replace(/\s+/g, ' ').trim();
  return null;
}

export function withRemoval(model: AppModel, skills: SkillRow[], notice: string, log: string): AppModel {
  const previous = selectedSkill(model);
  let next: AppModel = {
    ...model,
    phase: { type: 'browse' },
    skills,
    notice,
    logText: log,
    scan: null,
  };
  next = clampSelection(next);
  if (!previous) return next;
  const index = visibleSkills(next).findIndex((skill) => skill.id === previous.id);
  if (index >= 0) return { ...next, selected: index };
  return next;
}

export async function performRemoval(input: {
  skill: SkillRow;
  skills: readonly SkillRow[];
  home: string;
  signal?: AbortSignal;
  invoke?: (args: readonly string[], cwd: string, signal?: AbortSignal) => Promise<SkillsResult>;
}): Promise<RemovalOutcome> {
  const { skill } = input;
  if (skill.scope === 'project' && !skill.projectPath) {
    return {
      skills: [...input.skills],
      notice: `Not removed: ${skill.name} has no project directory`,
      log: '',
      removed: false,
      calls: [],
    };
  }
  const global = skill.scope === 'global';
  const cwd = global ? input.home : skill.projectPath ?? input.home;
  const invoke = input.invoke ?? ((args: readonly string[], dir: string, signal?: AbortSignal) => runSkills(args, { cwd: dir, signal, timeoutMs: 120_000 }));
  const removeArgs = buildRemoveArgs({ global, name: skill.name });
  const calls: RemovalCall[] = [{ args: [...removeArgs], cwd }];
  const removed = await invoke(removeArgs, cwd, input.signal);
  const output = `${removed.stdout}\n${removed.stderr}`;
  const removeLog = commandLog(removeArgs, cwd, output);
  if (removed.aborted || removed.timedOut) {
    return {
      skills: [...input.skills],
      notice: `Not removed: ${skill.name} ${removed.timedOut ? 'timed out' : 'was cancelled'}`,
      log: removeLog,
      removed: false,
      calls,
    };
  }
  const listArgs = buildListArgs(global);
  const listedResult = await invoke(listArgs, cwd, input.signal);
  const listed = await skillsFromListResult({ global, cwd }, listedResult);
  calls.push({ args: listArgs, cwd });
  if (listed.error) {
    return {
      skills: [...input.skills],
      notice: `Not removed: could not verify ${skill.name}. ${listed.error}`,
      log: `${removeLog}\nverify failed: ${listed.error}`,
      removed: false,
      calls,
    };
  }
  const still = listed.skills.some((row) => row.name === skill.name);
  const skills = replaceScopeSkills(input.skills, { global, projectPath: global ? null : cwd }, listed.skills);
  if (still) {
    const hint = removalHint(output);
    return {
      skills,
      notice: hint ? `Not removed: ${skill.name}. ${hint}` : `Not removed: ${skill.name} is still installed`,
      log: `${removeLog}\nverified: still installed`,
      removed: false,
      calls,
    };
  }
  return {
    skills,
    notice: `Removed ${skill.name}`,
    log: `${removeLog}\nverified: gone`,
    removed: true,
    calls,
  };
}

function commandLog(args: readonly string[], cwd: string, output: string): string {
  const text = stripNpmNoise(stripAnsi(output)).replace(/\r/g, '');
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('[') && !line.startsWith('{'));
  return [`$ ${formatCommandLine(args, cwd)}`, ...lines].join('\n');
}
