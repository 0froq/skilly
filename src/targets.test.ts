import assert from 'node:assert/strict';
import test from 'node:test';
import { skillId, type SkillRow } from './model.js';
import { checkTargets, updateAllTargets } from './targets.js';

function row(name: string, scope: 'global' | 'project', status: SkillRow['status'], projectPath: string | null): SkillRow {
  return {
    id: skillId(scope, projectPath, name),
    name,
    path: null,
    scope,
    projectPath,
    agents: [],
    source: status === 'untracked' ? null : 'o/r',
    sourceUrl: null,
    sourceType: null,
    status,
    layout: { kind: 'missing', target: null, agentSymlinks: 0, agentCopies: 0 },
    blurb: null,
  };
}

test('check and update targets follow the active scope', () => {
  const skills = [
    row('alpha', 'global', 'tracked', null),
    row('beta', 'project', 'tracked', '/work/app'),
    row('gamma', 'project', 'untracked', '/work/app'),
  ];
  assert.deepEqual(checkTargets({ skills, scope: { kind: 'all' }, query: '' }).map((target) => target.projectPath), [
    null,
    '/work/app',
  ]);
  assert.deepEqual(updateAllTargets({ skills, scope: { kind: 'project', path: '/work/app' }, query: 'beta' }), [
    { global: false, projectPath: '/work/app', names: ['beta'] },
  ]);
  assert.deepEqual(updateAllTargets({ skills, scope: { kind: 'all' }, query: 'gamma' }), []);
});
