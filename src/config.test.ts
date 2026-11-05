import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { formatConfig, parseConfig, readConfig, writeConfig } from './config.js';

test('config round trip keeps project globs', () => {
  const text = formatConfig(['~/code/0froq/**', '/tmp/other']);
  assert.deepEqual(parseConfig(text).globs, ['~/code/0froq/**', '/tmp/other']);
});

test('missing config file is created with the default glob', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'skilly-config-'));
  const path = join(dir, 'skilly', 'config.toml');
  const loaded = await readConfig(path);
  assert.equal(loaded.created, true);
  assert.deepEqual(loaded.globs, ['~/code/0froq/**']);
  const text = await readFile(path, 'utf8');
  assert.match(text, /project_globs/);
  await writeConfig(path, []);
  const again = await readConfig(path);
  assert.deepEqual(again.globs, []);
});

test('invalid project_globs is rejected', () => {
  assert.throws(() => parseConfig('project_globs = "nope"\n'), /array of strings/);
});
