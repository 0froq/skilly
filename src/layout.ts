import { lstat, readlink, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';

export type LayoutKind = 'symlink' | 'directory' | 'copy' | 'mixed' | 'missing' | 'other';

export interface LayoutInfo {
  kind: LayoutKind;
  target: string | null;
  agentSymlinks: number;
  agentCopies: number;
}

const PROJECT_AGENT_DIRS = [
  '.claude/skills',
  '.cursor/skills',
  '.codex/skills',
  '.continue/skills',
  '.windsurf/skills',
  '.gemini/skills',
  '.opencode/skills',
  '.factory/skills',
  '.aider-desk/skills',
  '.augment/skills',
  '.codebuddy/skills',
  '.bob/skills',
];

const GLOBAL_AGENT_DIRS = [
  '.claude/skills',
  '.cursor/skills',
  '.codex/skills',
  '.continue/skills',
  '.gemini/skills',
  '.factory/skills',
  '.codebuddy/skills',
  '.config/crush/skills',
];

export function layoutLabel(info: LayoutInfo): string {
  switch (info.kind) {
    case 'symlink':
      return info.target
        ? `symlink → ${info.target}`
        : `symlink (${info.agentSymlinks} agent link${info.agentSymlinks === 1 ? '' : 's'})`;
    case 'directory':
      return 'directory (canonical)';
    case 'copy':
      return info.agentCopies > 1 ? `directory (copy ×${info.agentCopies})` : 'directory (copy)';
    case 'mixed':
      return `mixed (${info.agentSymlinks} links, ${info.agentCopies} copies)`;
    case 'missing':
      return 'missing';
    case 'other':
      return 'other';
    default: {
      const unreachable: never = info.kind;
      return unreachable;
    }
  }
}

export function layoutHint(info: LayoutInfo): string | null {
  switch (info.kind) {
    case 'copy':
    case 'mixed':
      return 'Copy on disk. Add again without --copy if you want symlink installs. skilly never passes --copy.';
    case 'symlink':
    case 'directory':
    case 'missing':
    case 'other':
      return null;
    default: {
      const unreachable: never = info.kind;
      return unreachable;
    }
  }
}

function empty(kind: LayoutKind, target: string | null = null): LayoutInfo {
  return { kind, target, agentSymlinks: 0, agentCopies: 0 };
}

function isCanonicalStore(skillPath: string): boolean {
  return skillPath.replace(/\\/g, '/').includes('/.agents/skills/');
}

export async function inspectLayout(options: {
  skillPath: string | null;
  skillName: string;
  scope: 'global' | 'project';
  projectPath: string | null;
}): Promise<LayoutInfo> {
  const { skillPath } = options;
  if (!skillPath) return empty('missing');

  let stats;
  try {
    stats = await lstat(skillPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return empty(code === 'ENOENT' ? 'missing' : 'other');
  }

  if (stats.isSymbolicLink()) {
    const target = await readlink(skillPath).catch(() => null);
    return empty('symlink', target);
  }

  if (!stats.isDirectory()) return empty('other');

  const scan = await scanAgentEntries(options);
  if (scan.symlinks > 0 && scan.copies === 0) {
    return { kind: 'symlink', target: null, agentSymlinks: scan.symlinks, agentCopies: 0 };
  }
  if (scan.copies > 0 && scan.symlinks === 0) {
    return { kind: 'copy', target: null, agentSymlinks: 0, agentCopies: scan.copies };
  }
  if (scan.copies > 0 && scan.symlinks > 0) {
    return { kind: 'mixed', target: null, agentSymlinks: scan.symlinks, agentCopies: scan.copies };
  }
  if (!isCanonicalStore(skillPath)) {
    return { kind: 'copy', target: null, agentSymlinks: 0, agentCopies: 1 };
  }
  return empty('directory');
}

async function scanAgentEntries(options: {
  skillPath: string | null;
  skillName: string;
  scope: 'global' | 'project';
  projectPath: string | null;
}): Promise<{ symlinks: number; copies: number }> {
  const skillPath = options.skillPath;
  if (!skillPath) return { symlinks: 0, copies: 0 };

  const root = options.scope === 'global' ? homedir() : options.projectPath;
  if (!root) return { symlinks: 0, copies: 0 };

  const names = [...new Set([basename(skillPath), options.skillName].filter((name) => name.length > 0))];
  const dirs = options.scope === 'global' ? GLOBAL_AGENT_DIRS : PROJECT_AGENT_DIRS;
  const self = resolve(skillPath);
  let canonicalReal: string | null = null;
  try {
    canonicalReal = await realpath(skillPath);
  } catch {
    canonicalReal = null;
  }

  let symlinks = 0;
  let copies = 0;
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = join(root, dir, name);
      if (resolve(candidate) === self) continue;
      let stats;
      try {
        stats = await lstat(candidate);
      } catch {
        continue;
      }
      if (stats.isSymbolicLink()) {
        symlinks += 1;
        break;
      }
      if (stats.isDirectory()) {
        let real: string | null = null;
        try {
          real = await realpath(candidate);
        } catch {
          real = null;
        }
        if (real && canonicalReal && real === canonicalReal) break;
        copies += 1;
        break;
      }
    }
  }
  return { symlinks, copies };
}
