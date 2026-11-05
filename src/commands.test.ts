import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertNoCopy,
  buildAddArgs,
  buildCheckArgs,
  buildListArgs,
  buildRemoveArgs,
  buildUpdateArgs,
  validateAdd,
} from './commands.js';

test('skill argv never requests copy mode', () => {
  const batches = [
    buildListArgs(true),
    buildListArgs(false),
    buildCheckArgs({ global: true, projectPath: null }),
    buildCheckArgs({ global: false, projectPath: '/tmp/proj' }),
    buildUpdateArgs({ global: true, projectPath: null }),
    buildUpdateArgs({ global: false, projectPath: '/tmp/proj', names: ['alpha'] }),
    buildRemoveArgs({ global: false, name: 'alpha' }),
    buildAddArgs({ source: '0froq/skills', skill: 'demo', agents: 'cursor, claude-code', global: true }),
    buildAddArgs({ source: '0froq/skills', skill: '', agents: '', global: false }),
  ];
  for (const args of batches) {
    assert.equal(args.includes('--copy'), false);
    assert.equal(args.includes('--json'), true);
    assert.doesNotThrow(() => assertNoCopy(args));
  }
});

test('add defaults to every skill and agent without switching to copy', () => {
  assert.deepEqual(buildAddArgs({ source: 'owner/repo', skill: '  ', agents: ' ', global: false }), [
    'add',
    'owner/repo',
    '--json',
    '-y',
    '-s',
    '*',
    '-a',
    '*',
  ]);
});

test('update and remove keep scope flags', () => {
  assert.deepEqual(buildUpdateArgs({ global: true, projectPath: null, names: ['one'] }), [
    'update',
    '--json',
    '-y',
    '-g',
    'one',
  ]);
  assert.deepEqual(buildRemoveArgs({ global: true, name: 'one' }), ['remove', 'one', '--json', '-y', '-g']);
});

test('add rejects flag-shaped input', () => {
  assert.equal(validateAdd({ source: '--copy', skill: 'x', agents: '*' }), 'Source looks like a flag');
  assert.equal(validateAdd({ source: 'owner/repo', skill: '--copy', agents: '*' }), 'Skill looks like a flag');
  assert.equal(validateAdd({ source: 'owner/repo', skill: 'x', agents: '--copy' }), 'Agent looks like a flag');
  assert.equal(validateAdd({ source: 'owner/repo', skill: '', agents: '' }), null);
});

test('assertNoCopy throws before a copy install can be built by hand', () => {
  assert.throws(() => assertNoCopy(['add', '--copy']), /--copy/);
});
