import assert from 'node:assert/strict';
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readSkillBlurb } from './blurb.js';
import { inspectLayout, layoutLabel } from './layout.js';

test('layout distinguishes canonical directories, symlinks, and copies', async () => {
  const root = await mkdtemp(join(tmpdir(), 'skilly-layout-'));
  const canonical = join(root, '.agents', 'skills', 'demo');
  await mkdir(canonical, { recursive: true });
  await writeFile(
    join(canonical, 'SKILL.md'),
    '---\nname: demo\ndescription: "Say hello"\n---\n# demo\n',
  );
  const linkDir = join(root, '.cursor', 'skills');
  await mkdir(linkDir, { recursive: true });
  await symlink(canonical, join(linkDir, 'demo'), 'dir');

  const linked = await inspectLayout({
    skillPath: canonical,
    skillName: 'demo',
    scope: 'project',
    projectPath: root,
  });
  assert.equal(linked.kind, 'symlink');
  assert.match(layoutLabel(linked), /symlink/);
  assert.equal(await readSkillBlurb(canonical), 'Say hello');

  const copyRoot = join(root, 'copy-proj');
  const copySkill = join(copyRoot, '.cursor', 'skills', 'copied');
  await mkdir(copySkill, { recursive: true });
  await writeFile(join(copySkill, 'SKILL.md'), '---\ndescription: copied\n---\n');
  const copied = await inspectLayout({
    skillPath: copySkill,
    skillName: 'copied',
    scope: 'project',
    projectPath: copyRoot,
  });
  assert.equal(copied.kind, 'copy');
  assert.match(layoutLabel(copied), /copy/);

  const missing = await inspectLayout({
    skillPath: null,
    skillName: 'gone',
    scope: 'global',
    projectPath: null,
  });
  assert.equal(missing.kind, 'missing');
});
