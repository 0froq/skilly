import assert from 'node:assert/strict';
import test from 'node:test';
import { groupSkills, listWindow, statusMark } from './groups.js';
import { skillId, type SkillRow } from './model.js';

function row(name: string, scope: 'global' | 'project', projectPath: string | null, status: SkillRow['status'] = 'tracked'): SkillRow {
  return {
    id: skillId(scope, projectPath, name),
    name,
    path: null,
    scope,
    projectPath,
    agents: [],
    source: null,
    sourceUrl: null,
    sourceType: null,
    status,
    layout: { kind: 'directory', target: null, agentSymlinks: 0, agentCopies: 0 },
    blurb: null,
  };
}

test('skills are grouped under global and each project', () => {
  const skills = [
    row('writing-plans', 'global', null),
    row('yab-browser', 'global', null, 'untracked'),
    row('ghfs', 'project', '/Users/oQ/code/0froq/ghfs', 'untracked'),
    row('devframe', 'project', '/Users/oQ/code/0froq/ghfs', 'untracked'),
    row('academic-paper', 'project', '/Users/oQ/code/0froq/warming-pathways', 'missing'),
  ];
  const entries = groupSkills(skills);
  assert.deepEqual(
    entries.map((entry) => (entry.kind === 'header' ? `header:${entry.label}` : entry.skill.name)),
    [
      'header:global',
      'writing-plans',
      'yab-browser',
      'header:/Users/oQ/code/0froq/ghfs',
      'ghfs',
      'devframe',
      'header:/Users/oQ/code/0froq/warming-pathways',
      'academic-paper',
    ],
  );
  assert.equal(statusMark('untracked', false), '?');
  assert.equal(statusMark('missing', false), '!');
  assert.equal(statusMark('tracked', true), '↑');
});

test('the section header stays with the selected skill', () => {
  const skills = [row('alpha', 'global', null), row('beta', 'project', '/work/app', 'missing')];
  const entries = groupSkills(skills);
  const window = listWindow(entries, 1, 2);
  assert.equal(window[0]?.kind, 'header');
  assert.equal(window[1]?.kind, 'skill');
  if (window[1]?.kind === 'skill') assert.equal(window[1].skill.name, 'beta');
});
