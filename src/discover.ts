import fg from 'fast-glob';
import { realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

export const MAX_PROJECTS = 200;

export type Marker = 'git' | 'pkg' | 'skills' | 'lock';

const IGNORE = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/target/**',
  '**/.turbo/**',
  '**/coverage/**',
  '**/.next/**',
  '**/vendor/**',
];

export interface DiscoverResult {
  projects: string[];
  notes: string[];
}

export function expandHome(input: string, home = homedir()): string {
  if (input === '~') return home;
  if (input.startsWith('~/') || input.startsWith('~\\')) return resolve(home, input.slice(2));
  return input;
}

export function globHasMagic(pattern: string): boolean {
  return /[*?[{]/.test(pattern);
}

export function isDangerousGlob(pattern: string): boolean {
  const expanded = expandHome(pattern.trim());
  if (!expanded) return true;
  const withoutMagic = expanded.replace(/[*?[\]{}]/g, '').replace(/\/+/g, '/');
  const meaningful = withoutMagic.replace(/^\.\/+/, '').replace(/\/+$/, '');
  return meaningful === '' || meaningful === '.' || meaningful === '/' || meaningful === '~';
}

export function expandGlobPattern(pattern: string, cwd: string, home = homedir()): string {
  const expanded = expandHome(pattern.trim(), home);
  if (!expanded) return '';
  const absolute = isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
  return absolute.replace(/\\/g, '/');
}

export function markerGlobs(expanded: string): string[] {
  const base = expanded.replace(/\/+$/, '');
  const prefixes = globHasMagic(base) ? [base] : [base, `${base}/**`];
  const suffixes = ['.git', 'package.json', 'skills-lock.json', '.agents/skills'];
  const globs: string[] = [];
  for (const prefix of prefixes) {
    for (const suffix of suffixes) {
      globs.push(`${prefix}/${suffix}`);
    }
  }
  return globs;
}

export function projectDirFromMarker(match: string): { dir: string; kind: Marker } | null {
  const trimmed = match.replace(/[\\/]+$/, '');
  const norm = trimmed.replace(/\\/g, '/');
  if (norm.endsWith('/.agents/skills')) {
    return { dir: dirname(dirname(trimmed)), kind: 'skills' };
  }
  if (norm.endsWith('/.git')) return { dir: dirname(trimmed), kind: 'git' };
  if (norm.endsWith('/package.json')) return { dir: dirname(trimmed), kind: 'pkg' };
  if (norm.endsWith('/skills-lock.json')) return { dir: dirname(trimmed), kind: 'lock' };
  return null;
}

export function isIgnoredProjectDir(dir: string): boolean {
  const norm = dir.replace(/\\/g, '/');
  return (
    norm.includes('/node_modules/') ||
    norm.includes('/.agents/skills/') ||
    norm.includes('/.git/') ||
    norm.endsWith('/node_modules') ||
    norm.endsWith('/.git')
  );
}

export function isSubpath(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

export function selectProjectDirs(markers: ReadonlyMap<string, ReadonlySet<Marker>>): string[] {
  const dirs = [...markers.keys()];
  const kept: string[] = [];
  for (const dir of dirs) {
    const marks = markers.get(dir);
    if (!marks) continue;
    const strong = marks.has('git') || marks.has('skills') || marks.has('lock');
    if (!strong && !marks.has('pkg')) continue;
    if (!strong && marks.has('pkg')) {
      const nestedInGit = dirs.some((other) => {
        if (other === dir) return false;
        const otherMarks = markers.get(other);
        return Boolean(otherMarks?.has('git') && isSubpath(other, dir));
      });
      if (nestedInGit) continue;
    }
    kept.push(dir);
  }
  kept.sort((a, b) => a.localeCompare(b));
  return kept;
}

async function canonicalize(dir: string): Promise<string> {
  try {
    return await realpath(dir);
  } catch {
    return resolve(dir);
  }
}

export async function discoverProjects(patterns: readonly string[], cwd = process.cwd()): Promise<DiscoverResult> {
  const notes: string[] = [];
  const markers = new Map<string, Set<Marker>>();

  for (const raw of patterns) {
    const pattern = raw.trim();
    if (!pattern) continue;
    if (isDangerousGlob(pattern)) {
      notes.push(`Skipped broad glob ${pattern}`);
      continue;
    }
    const expanded = expandGlobPattern(pattern, cwd);
    const matches = await fg(markerGlobs(expanded), {
      dot: true,
      onlyFiles: false,
      unique: true,
      absolute: true,
      ignore: IGNORE,
      followSymbolicLinks: false,
      suppressErrors: true,
    });
    for (const match of matches) {
      const found = projectDirFromMarker(match);
      if (!found || isIgnoredProjectDir(found.dir)) continue;
      const dir = await canonicalize(found.dir);
      if (isIgnoredProjectDir(dir)) continue;
      const set = markers.get(dir) ?? new Set<Marker>();
      set.add(found.kind);
      markers.set(dir, set);
    }
  }

  let projects = selectProjectDirs(markers);
  if (projects.length > MAX_PROJECTS) {
    notes.push(`Found ${projects.length} projects; showing ${MAX_PROJECTS}`);
    projects = projects.slice(0, MAX_PROJECTS);
  }
  return { projects, notes };
}
