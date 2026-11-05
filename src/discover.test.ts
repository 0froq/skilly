import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { discoverProjects, isDangerousGlob, projectDirFromMarker, selectProjectDirs } from './discover.js';

test('marker paths map back to the project directory', () => {
  assert.deepEqual(projectDirFromMarker('/work/app/.git'), { dir: '/work/app', kind: 'git' });
  assert.deepEqual(projectDirFromMarker('/work/app/.agents/skills'), {
    dir: '/work/app',
    kind: 'skills',
  });
  assert.equal(projectDirFromMarker('/work/app/README.md'), null);
});

test('package.json nested in a git repo is not its own project', () => {
  const markers = new Map<string, Set<'git' | 'pkg' | 'skills' | 'lock'>>([
    ['/repo', new Set(['git', 'pkg'])],
    ['/repo/packages/nested', new Set(['pkg'])],
    ['/repo/packages/skilled', new Set(['skills'])],
    ['/loose', new Set(['pkg'])],
    ['/locked', new Set(['lock'])],
  ]);
  assert.deepEqual(selectProjectDirs(markers), ['/locked', '/loose', '/repo', '/repo/packages/skilled']);
});

test('broad globs are refused', () => {
  assert.equal(isDangerousGlob('**'), true);
  assert.equal(isDangerousGlob('/*'), true);
  assert.equal(isDangerousGlob('~/code/0froq/**'), false);
});

test('discover finds project roots and skips nested packages and node_modules', async () => {
  const root = await mkdtemp(join(tmpdir(), 'skilly-discover-'));
  const repo = join(root, 'repo');
  await mkdir(join(repo, '.git'), { recursive: true });
  await writeFile(join(repo, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  await writeFile(join(repo, 'package.json'), '{}\n');
  await mkdir(join(repo, 'packages', 'nested'), { recursive: true });
  await writeFile(join(repo, 'packages', 'nested', 'package.json'), '{}\n');
  const skilled = join(repo, 'packages', 'skilled');
  await mkdir(join(skilled, '.agents', 'skills', 'demo'), { recursive: true });
  await writeFile(join(skilled, '.agents', 'skills', 'demo', 'SKILL.md'), '# demo\n');
  await mkdir(join(root, 'loose'), { recursive: true });
  await writeFile(join(root, 'loose', 'package.json'), '{}\n');
  await mkdir(join(root, 'nodey', 'node_modules', 'pkg'), { recursive: true });
  await writeFile(join(root, 'nodey', 'node_modules', 'pkg', 'package.json'), '{}\n');
  await mkdir(join(root, 'locked'), { recursive: true });
  await writeFile(join(root, 'locked', 'skills-lock.json'), '{}\n');
  await mkdir(join(root, 'work'), { recursive: true });
  await writeFile(join(root, 'work', '.git'), 'gitdir: /somewhere\n');

  const found = await discoverProjects([`${root}/**`]);
  assert.deepEqual(found.projects, [join(root, 'locked'), join(root, 'loose'), repo, skilled, join(root, 'work')].sort((a, b) => a.localeCompare(b)));
});
