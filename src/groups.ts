import type { SkillRow, SkillStatus } from './model.js';
import { shortenPath } from './text.js';

export interface SkillHeader {
  kind: 'header';
  id: string;
  label: string;
}

export interface SkillItem {
  kind: 'skill';
  skill: SkillRow;
  skillIndex: number;
}

export type SkillListEntry = SkillHeader | SkillItem;

export function statusMark(status: SkillStatus, outdated: boolean): string {
  if (outdated) return '↑';
  switch (status) {
    case 'untracked':
      return '?';
    case 'missing':
      return '!';
    case 'modified':
      return '~';
    case 'tracked':
    case 'unknown':
      return ' ';
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

export function sectionLabel(skill: SkillRow): string {
  if (skill.scope === 'global') return 'global';
  if (skill.projectPath) return shortenPath(skill.projectPath);
  return 'project';
}

export function groupSkills(skills: readonly SkillRow[]): SkillListEntry[] {
  const entries: SkillListEntry[] = [];
  let previous = '';
  for (let index = 0; index < skills.length; index += 1) {
    const skill = skills[index];
    if (!skill) continue;
    const key = skill.scope === 'global' ? 'global' : `project\0${skill.projectPath ?? ''}`;
    if (key !== previous) {
      entries.push({ kind: 'header', id: `header:${key}`, label: sectionLabel(skill) });
      previous = key;
    }
    entries.push({ kind: 'skill', skill, skillIndex: index });
  }
  return entries;
}

export function listWindow(entries: readonly SkillListEntry[], skillIndex: number, height: number): SkillListEntry[] {
  if (height <= 0 || entries.length === 0) return [];
  const found = entries.findIndex((entry) => entry.kind === 'skill' && entry.skillIndex === skillIndex);
  const focus = found < 0 ? 0 : found;
  let start = scrollStart(focus, entries.length, height);
  const header = entries[focus - 1];
  if (header?.kind === 'header' && focus - 1 < start) {
    start = Math.max(0, focus - 1);
  }
  if (focus >= start + height) start = Math.max(0, focus - height + 1);
  if (focus < start) start = focus;
  const maxStart = Math.max(0, entries.length - height);
  start = Math.min(start, maxStart);
  if (focus < start) start = focus;
  if (focus >= start + height) start = Math.max(0, focus - height + 1);
  return entries.slice(start, start + height);
}

function scrollStart(selected: number, count: number, height: number): number {
  if (count <= height || height <= 0) return 0;
  const half = Math.floor(height / 2);
  return Math.max(0, Math.min(selected - half, count - height));
}
