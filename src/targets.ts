import type { ScopeTarget } from './commands.js';
import { isUpdatable, type AppModel, visibleSkills } from './model.js';

export function checkTargets(model: Pick<AppModel, 'skills' | 'scope' | 'query'>): ScopeTarget[] {
  if (model.scope.kind === 'global') return [{ global: true, projectPath: null }];
  if (model.scope.kind === 'project') return [{ global: false, projectPath: model.scope.path }];

  const targets = new Map<string, ScopeTarget>();
  for (const skill of visibleSkills(model)) {
    if (!isUpdatable(skill)) continue;
    if (skill.scope === 'global') {
      targets.set('global', { global: true, projectPath: null });
      continue;
    }
    if (skill.projectPath) {
      targets.set(skill.projectPath, { global: false, projectPath: skill.projectPath });
    }
  }
  return [...targets.values()];
}

export function updateAllTargets(model: Pick<AppModel, 'skills' | 'scope' | 'query'>): ScopeTarget[] {
  const query = model.query.trim();
  if (query) {
    const grouped = new Map<string, ScopeTarget>();
    for (const skill of visibleSkills(model)) {
      if (!isUpdatable(skill)) continue;
      const key = skill.scope === 'global' ? 'global' : (skill.projectPath ?? '');
      const existing = grouped.get(key);
      if (existing) {
        existing.names = [...(existing.names ?? []), skill.name];
        continue;
      }
      grouped.set(key, {
        global: skill.scope === 'global',
        projectPath: skill.scope === 'global' ? null : skill.projectPath,
        names: [skill.name],
      });
    }
    return [...grouped.values()];
  }

  if (model.scope.kind === 'global') return [{ global: true, projectPath: null }];
  if (model.scope.kind === 'project') return [{ global: false, projectPath: model.scope.path }];

  const targets: ScopeTarget[] = [];
  if (model.skills.some((skill) => skill.scope === 'global' && isUpdatable(skill))) {
    targets.push({ global: true, projectPath: null });
  }
  const projects = new Set<string>();
  for (const skill of model.skills) {
    if (skill.scope === 'project' && skill.projectPath && isUpdatable(skill)) projects.add(skill.projectPath);
  }
  for (const projectPath of projects) targets.push({ global: false, projectPath });
  return targets;
}

export function scopeChoices(projects: readonly string[]): Array<{ kind: 'global' } | { kind: 'project'; path: string }> {
  return [{ kind: 'global' }, ...projects.map((path) => ({ kind: 'project' as const, path }))];
}

export function projectCwd(target: { global: boolean; projectPath: string | null }, home: string): string {
  if (target.global) return home;
  if (!target.projectPath) return home;
  return target.projectPath;
}
