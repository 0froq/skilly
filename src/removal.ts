import { lstat, readlink, stat, unlink } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
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
  const unmatched = text.match(/No matching skills found[^\n]*/i) ?? text.match(/No skills found to remove\.?/i);
  if (unmatched?.[0]) return unmatched[0].replace(/\s+/g, ' ').trim();
  return null;
}

/** Canonical `.agents/skills/<name>` path for this row, or null if it is not that entry. */
export function canonicalInstallPath(skill: SkillRow, home: string): string | null {
  if (!skill.path) return null;
  const name = basename(skill.path);
  if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) return null;
  const root = skill.scope === 'global' ? join(home, '.agents', 'skills') : skill.projectPath ? join(skill.projectPath, '.agents', 'skills') : null;
  if (!root) return null;
  const expected = resolve(root, name);
  if (resolve(skill.path) !== expected) return null;
  const base = resolve(root);
  if (expected !== base && !expected.startsWith(base + sep)) return null;
  return expected;
}

function sameLinkTarget(linkPath: string, recorded: string, current: string): boolean {
  const base = dirname(linkPath);
  return resolve(base, recorded) === resolve(base, current);
}

/**
 * Unlink one canonical skill symlink. Refuses real directories and a target
 * that no longer matches the link recorded on the selected row.
 */
export async function unlinkCanonicalSkillSymlink(skill: SkillRow, home: string): Promise<{ ok: true; target: string } | { ok: false; reason: string }> {
  if (skill.status !== 'untracked' || skill.layout.kind !== 'symlink' || !skill.layout.target) {
    return { ok: false, reason: 'not an untracked symlink install' };
  }
  const linkPath = canonicalInstallPath(skill, home);
  if (!linkPath) return { ok: false, reason: 'path is not the canonical skill install' };
  let info;
  try {
    info = await lstat(linkPath);
  } catch {
    return { ok: false, reason: 'install path is missing' };
  }
  if (!info.isSymbolicLink()) return { ok: false, reason: 'install path is not a symlink' };
  let current: string;
  try {
    current = await readlink(linkPath);
  } catch {
    return { ok: false, reason: 'could not read the symlink' };
  }
  if (!sameLinkTarget(linkPath, skill.layout.target, current)) {
    return { ok: false, reason: 'symlink target changed' };
  }
  let reread: string;
  try {
    reread = await readlink(linkPath);
  } catch {
    return { ok: false, reason: 'symlink changed' };
  }
  if (reread !== current) return { ok: false, reason: 'symlink target changed' };
  try {
    await stat(join(linkPath, 'SKILL.md'));
  } catch {
    return { ok: false, reason: 'symlink does not point at a SKILL.md' };
  }
  try {
    await unlink(linkPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unlink failed';
    return { ok: false, reason: message };
  }
  const targetPath = resolve(dirname(linkPath), current);
  try {
    const targetInfo = await lstat(targetPath);
    if (!targetInfo.isDirectory()) return { ok: false, reason: 'symlink target is no longer a directory' };
  } catch {
    return { ok: false, reason: 'symlink was removed but its target is missing' };
  }
  try {
    await lstat(linkPath);
    return { ok: false, reason: 'symlink still exists' };
  } catch {
    return { ok: true, target: targetPath };
  }
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
  const scope = { global, projectPath: global ? null : cwd };
  const skills = replaceScopeSkills(input.skills, scope, listed.skills);
  if (still) {
    if (removed.code !== 0) {
      const hint = removalHint(output);
      return {
        skills,
        notice: hint ? `Not removed: ${skill.name}. ${hint}` : `Not removed: ${skill.name} is still installed`,
        log: `${removeLog}\nverified: still installed`,
        removed: false,
        calls,
      };
    }
    const unlinked = await unlinkMissedSymlink(skill, listed.skills, input.home);
    if (!unlinked.ok) {
      const hint = removalHint(output);
      const reason = unlinked.reason === 'not an untracked symlink install' ? hint : unlinked.reason;
      return {
        skills,
        notice: reason ? `Not removed: ${skill.name}. ${reason}` : `Not removed: ${skill.name} is still installed`,
        log: `${removeLog}\nverified: still installed`,
        removed: false,
        calls,
      };
    }
    const againResult = await invoke(listArgs, cwd, input.signal);
    const again = await skillsFromListResult({ global, cwd }, againResult);
    calls.push({ args: [...listArgs], cwd });
    if (again.error || again.skills.some((row) => row.name === skill.name)) {
      return {
        skills: again.error ? skills : replaceScopeSkills(input.skills, scope, again.skills),
        notice: `Not removed: ${skill.name} is still installed`,
        log: `${removeLog}\nunlinked ${unlinked.linkPath}\nverified: still installed`,
        removed: false,
        calls,
      };
    }
    return {
      skills: replaceScopeSkills(input.skills, scope, again.skills),
      notice: `Removed ${skill.name}`,
      log: `${removeLog}\nunlinked ${unlinked.linkPath}\nverified: gone`,
      removed: true,
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

async function unlinkMissedSymlink(
  skill: SkillRow,
  listed: readonly SkillRow[],
  home: string,
): Promise<{ ok: true; linkPath: string } | { ok: false; reason: string }> {
  const current = listed.find((row) => row.name === skill.name);
  if (!current?.path || !skill.path || resolve(current.path) !== resolve(skill.path)) {
    return { ok: false, reason: 'not an untracked symlink install' };
  }
  if (skill.status !== 'untracked' || current.status !== 'untracked') {
    return { ok: false, reason: 'not an untracked symlink install' };
  }
  const unlinked = await unlinkCanonicalSkillSymlink({ ...skill, path: current.path }, home);
  if (!unlinked.ok) return unlinked;
  return { ok: true, linkPath: current.path };
}

function commandLog(args: readonly string[], cwd: string, output: string): string {
  const text = stripNpmNoise(stripAnsi(output)).replace(/\r/g, '');
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('[') && !line.startsWith('{'));
  return [`$ ${formatCommandLine(args, cwd)}`, ...lines].join('\n');
}
