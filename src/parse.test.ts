import assert from 'node:assert/strict';
import test from 'node:test';
import { extractJson, parseCheckOutput, parseSkillList } from './parse.js';

test('parse list json including tracked and untracked rows', () => {
  const parsed = parseSkillList(
    extractJson(`noise\n${JSON.stringify([
      {
        name: 'alpha',
        path: '/home/me/.agents/skills/alpha',
        scope: 'global',
        agents: ['Cursor'],
        source: '0froq/pack',
        sourceUrl: 'https://github.com/0froq/pack',
        sourceType: 'github',
        status: 'tracked',
      },
      {
        name: 'beta',
        path: '/work/app/.agents/skills/beta',
        scope: 'project',
        agents: [],
        source: null,
        sourceUrl: null,
        sourceType: null,
      },
    ])}`),
  );
  assert.equal(parsed[0]?.status, 'tracked');
  assert.equal(parsed[0]?.source, '0froq/pack');
  assert.equal(parsed[1]?.status, 'untracked');
  assert.equal(parsed[1]?.path, '/work/app/.agents/skills/beta');
});

test('parse check text and a future json payload', () => {
  const ansi = '\u001B[38;5;145m↑ alpha has an update\u001B[0m\nall quiet\n';
  assert.deepEqual(parseCheckOutput(ansi).outdated, ['alpha']);
  assert.deepEqual(
    parseCheckOutput(JSON.stringify([{ name: 'beta', outdated: true }, { name: 'gamma', outdated: false }])).outdated,
    ['beta'],
  );
});
