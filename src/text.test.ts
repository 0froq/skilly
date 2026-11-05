import assert from 'node:assert/strict';
import test from 'node:test';
import { skillLineText } from './text.js';

test('skill rows keep the scope visible in a narrow column', () => {
  const line = skillLineText('↑', 'global-skill', 'global', 28);
  assert.ok(line.length <= 28);
  assert.match(line, /global-skill/);
  assert.match(line, /global$/);
  const tight = skillLineText('?', 'project-skill', '/tmp/very/long/project', 24);
  assert.ok(tight.length <= 24);
  assert.match(tight, /project$/);
});
