import type { LayoutInfo } from './layout.js';
import type { SkillStatus } from './parse.js';

export type { SkillStatus };

export interface SkillRow {
  id: string;
  name: string;
  path: string | null;
  scope: 'global' | 'project';
  projectPath: string | null;
  agents: string[];
  source: string | null;
  sourceUrl: string | null;
  sourceType: string | null;
  status: SkillStatus;
  layout: LayoutInfo;
  blurb: string | null;
}

export type UpdateState = 'outdated' | 'current';

export type ScopeFilter = { kind: 'all' } | { kind: 'global' } | { kind: 'project'; path: string };

export type AddStep = 'source' | 'skill' | 'agents' | 'scope';

export type Phase =
  | { type: 'loading' }
  | { type: 'browse' }
  | { type: 'filter'; before: string }
  | { type: 'confirm-remove' }
  | { type: 'help' }
  | { type: 'log' }
  | { type: 'busy' }
  | { type: 'config'; index: number; draft: string | null }
  | { type: 'add'; step: AddStep; source: string; skill: string; agents: string; scopeIndex: number };

export interface AppModel {
  phase: Phase;
  configPath: string;
  globs: string[];
  projects: string[];
  discoverNotes: string[];
  skills: SkillRow[];
  scope: ScopeFilter;
  query: string;
  selected: number;
  notice: string;
  logText: string;
  updates: Record<string, UpdateState>;
}

export interface RefreshResult {
  globs: string[];
  projects: string[];
  notes: string[];
  skills: SkillRow[];
  errors: string[];
  log: string;
  aborted: boolean;
}

export function skillId(scope: 'global' | 'project', projectPath: string | null, name: string): string {
  return `${scope}\0${projectPath ?? ''}\0${name}`;
}

export function initialModel(configPath: string): AppModel {
  return {
    phase: { type: 'loading' },
    configPath,
    globs: [],
    projects: [],
    discoverNotes: [],
    skills: [],
    scope: { kind: 'all' },
    query: '',
    selected: 0,
    notice: 'Loading…',
    logText: '',
    updates: {},
  };
}

export function isUpdatable(skill: SkillRow): boolean {
  return skill.status === 'tracked' || skill.status === 'modified' || skill.status === 'missing';
}

export function scopeKey(scope: ScopeFilter): string {
  switch (scope.kind) {
    case 'all':
      return 'all';
    case 'global':
      return 'global';
    case 'project':
      return `project:${scope.path}`;
    default: {
      const unreachable: never = scope;
      return unreachable;
    }
  }
}

export function matchesScope(skill: SkillRow, scope: ScopeFilter): boolean {
  switch (scope.kind) {
    case 'all':
      return true;
    case 'global':
      return skill.scope === 'global';
    case 'project':
      return skill.scope === 'project' && skill.projectPath === scope.path;
    default: {
      const unreachable: never = scope;
      return unreachable;
    }
  }
}

export function visibleSkills(model: Pick<AppModel, 'skills' | 'scope' | 'query'>): SkillRow[] {
  const query = model.query.trim().toLowerCase();
  return model.skills.filter((skill) => {
    if (!matchesScope(skill, model.scope)) return false;
    if (!query) return true;
    const haystack = [skill.name, skill.source ?? '', skill.projectPath ?? '', skill.scope].join('\n').toLowerCase();
    return haystack.includes(query);
  });
}

export function selectedSkill(model: Pick<AppModel, 'skills' | 'scope' | 'query' | 'selected'>): SkillRow | null {
  return visibleSkills(model)[model.selected] ?? null;
}

export function clampSelection(model: AppModel): AppModel {
  const count = visibleSkills(model).length;
  if (count === 0) return { ...model, selected: 0 };
  return { ...model, selected: Math.max(0, Math.min(model.selected, count - 1)) };
}

export function scopeStillValid(scope: ScopeFilter, projects: readonly string[]): boolean {
  switch (scope.kind) {
    case 'all':
    case 'global':
      return true;
    case 'project':
      return projects.includes(scope.path);
    default: {
      const unreachable: never = scope;
      return unreachable;
    }
  }
}

export function cycleScope(current: ScopeFilter, projects: readonly string[], direction: 1 | -1): ScopeFilter {
  const order: ScopeFilter[] = [
    { kind: 'all' },
    { kind: 'global' },
    ...projects.map((path) => ({ kind: 'project' as const, path })),
  ];
  const currentKey = scopeKey(current);
  let index = order.findIndex((item) => scopeKey(item) === currentKey);
  if (index < 0) index = 0;
  const next = (index + direction + order.length) % order.length;
  return order[next] ?? { kind: 'all' };
}

export function updateLabel(state: UpdateState | undefined): string {
  switch (state) {
    case 'outdated':
      return 'update available';
    case 'current':
      return 'up to date';
    case undefined:
      return 'not checked';
    default: {
      const unreachable: never = state;
      return unreachable;
    }
  }
}

export function compareSkills(a: SkillRow, b: SkillRow): number {
  if (a.scope !== b.scope) return a.scope === 'global' ? -1 : 1;
  const project = (a.projectPath ?? '').localeCompare(b.projectPath ?? '');
  if (project !== 0) return project;
  return a.name.localeCompare(b.name);
}

export function withRefresh(model: AppModel, data: RefreshResult): AppModel {
  if (data.aborted) return model;
  const previous = selectedSkill(model);
  const scope: ScopeFilter = scopeStillValid(model.scope, data.projects) ? model.scope : { kind: 'all' };
  let next: AppModel = {
    ...model,
    phase: { type: 'browse' },
    globs: data.globs,
    projects: data.projects,
    discoverNotes: data.notes,
    skills: data.skills,
    scope,
    updates: {},
    logText: data.log || model.logText,
    notice: refreshNotice(data),
  };
  next = clampSelection(next);
  if (previous) {
    const index = visibleSkills(next).findIndex((skill) => skill.id === previous.id);
    if (index >= 0) next = { ...next, selected: index };
  }
  return next;
}

function refreshNotice(data: RefreshResult): string {
  const count = `${data.skills.length} skill${data.skills.length === 1 ? '' : 's'}`;
  if (data.errors.length > 0) {
    return `${count} · ${data.errors.length} error${data.errors.length === 1 ? '' : 's'} — l for log`;
  }
  const note = data.notes.find((item) => !item.startsWith('Created '));
  if (note) return `${count} · ${note}`;
  return count;
}

export function applyCheck(
  skills: readonly SkillRow[],
  updates: Record<string, UpdateState>,
  target: { global: boolean; projectPath: string | null },
  outdated: readonly string[],
): Record<string, UpdateState> {
  const next = { ...updates };
  const outdatedNames = new Set(outdated);
  for (const skill of skills) {
    const inScope = target.global
      ? skill.scope === 'global'
      : skill.scope === 'project' && skill.projectPath === target.projectPath;
    if (!inScope || !isUpdatable(skill)) continue;
    next[skill.id] = outdatedNames.has(skill.name) ? 'outdated' : 'current';
  }
  return next;
}

export function scrollStart(selected: number, count: number, height: number): number {
  if (count <= height || height <= 0) return 0;
  const half = Math.floor(height / 2);
  return Math.max(0, Math.min(selected - half, count - height));
}
