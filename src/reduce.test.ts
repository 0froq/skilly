import assert from 'node:assert/strict';
import test from 'node:test';
import { skillId, visibleSkills, type AppModel, type SkillRow } from './model.js';
import { blankKey, reduceKey, type KeyInfo, type KeyPress } from './reduce.js';

function press(input: string, extra: Partial<KeyInfo> = {}): KeyPress {
  return { input, key: { ...blankKey(), ...extra } };
}

function row(overrides: Partial<SkillRow> & Pick<SkillRow, 'name' | 'scope' | 'status'>): SkillRow {
  const projectPath = overrides.projectPath ?? (overrides.scope === 'project' ? '/work/app' : null);
  return {
    id: skillId(overrides.scope, projectPath, overrides.name),
    path: '/tmp/skill',
    projectPath,
    agents: ['Cursor'],
    source: overrides.status === 'untracked' ? null : '0froq/pack',
    sourceUrl: null,
    sourceType: overrides.status === 'untracked' ? null : 'github',
    layout: { kind: 'directory', target: null, agentSymlinks: 0, agentCopies: 0 },
    blurb: null,
    ...overrides,
  };
}

function model(skills: SkillRow[]): AppModel {
  return {
    phase: { type: 'browse' },
    configPath: '/tmp/skilly/config.toml',
    globs: ['~/code/0froq/**'],
    projects: ['/work/app'],
    discoverNotes: [],
    skills,
    scope: { kind: 'all' },
    query: '',
    selected: 0,
    notice: '',
    logText: '',
    updates: {},
  };
}

test('movement, scope, and filter stay inside the visible list', () => {
  const start = model([
    row({ name: 'alpha', scope: 'global', status: 'tracked' }),
    row({ name: 'beta', scope: 'project', status: 'untracked', projectPath: '/work/app' }),
  ]);
  const down = reduceKey(start, press('j'));
  assert.equal(down.model.selected, 1);
  assert.equal(down.effect.type, 'none');

  const scoped = reduceKey(down.model, press('f'));
  assert.equal(scoped.model.scope.kind, 'global');
  assert.equal(scoped.model.selected, 0);

  let filtering = reduceKey(start, press('/')).model;
  filtering = reduceKey(filtering, press('beta')).model;
  assert.equal(filtering.query, 'beta');
  assert.deepEqual(visibleSkills(filtering).map((skill) => skill.name), ['beta']);
  const applied = reduceKey(filtering, press('', { return: true }));
  assert.equal(applied.model.phase.type, 'browse');
  assert.equal(applied.model.query, 'beta');
});

test('untracked skills are not sent to update', () => {
  const start = model([row({ name: 'beta', scope: 'project', status: 'untracked', projectPath: '/work/app' })]);
  const result = reduceKey(start, press('u'));
  assert.equal(result.effect.type, 'none');
  assert.match(result.model.notice, /untracked/);
});

test('remove asks before emitting a remove effect', () => {
  const start = model([row({ name: 'alpha', scope: 'global', status: 'tracked' })]);
  const asked = reduceKey(start, press('d'));
  assert.equal(asked.model.phase.type, 'confirm-remove');
  assert.equal(asked.effect.type, 'none');
  const confirmed = reduceKey(asked.model, press('y'));
  assert.equal(confirmed.effect.type, 'remove');
  if (confirmed.effect.type === 'remove') assert.equal(confirmed.effect.skill.name, 'alpha');
});

test('add wizard emits a global symlink install', () => {
  const start = model([row({ name: 'alpha', scope: 'global', status: 'tracked' })]);
  let current = reduceKey(start, press('a')).model;
  current = reduceKey(current, press('o')).model;
  current = reduceKey(current, press('w')).model;
  current = reduceKey(current, press('', { return: true })).model;
  current = reduceKey(current, press('', { return: true })).model;
  current = reduceKey(current, press('', { return: true })).model;
  const done = reduceKey(current, press('', { return: true }));
  assert.equal(done.effect.type, 'add');
  if (done.effect.type === 'add') {
    assert.equal(done.effect.source, 'ow');
    assert.equal(done.effect.skill, '*');
    assert.equal(done.effect.agents, '*');
    assert.equal(done.effect.global, true);
  }
});

test('check and quit are explicit effects', () => {
  const start = model([row({ name: 'alpha', scope: 'global', status: 'tracked' })]);
  assert.equal(reduceKey(start, press('c')).effect.type, 'check');
  assert.equal(reduceKey(start, press('U')).effect.type, 'update-all');
  assert.equal(reduceKey(start, press('q')).effect.type, 'quit');
});
