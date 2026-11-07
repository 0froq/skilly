import assert from 'node:assert/strict';
import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { extractJson, parseSkillList } from './parse.js';
import { runSkills, skillsCommand } from './skills-cli.js';

test('skills command defaults to npx and honors SKILLY_SKILLS_BIN', async () => {
  const previous = process.env.SKILLY_SKILLS_BIN;
  delete process.env.SKILLY_SKILLS_BIN;
  try {
    assert.deepEqual(skillsCommand(), { command: 'npx', prefix: ['--yes', 'skills'] });
  } finally {
    if (previous === undefined) delete process.env.SKILLY_SKILLS_BIN;
    else process.env.SKILLY_SKILLS_BIN = previous;
  }

  const dir = await mkdtemp(join(tmpdir(), 'skilly-bin-'));
  const bin = join(dir, 'skills');
  await writeFile(
    bin,
    `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.includes('--copy')) {
  console.error('copy');
  process.exit(3);
}
if (args[0] === 'list' && args.includes('--json')) {
  const scope = args.includes('-g') ? 'global' : 'project';
  console.log(JSON.stringify([{
    name: 'alpha',
    path: '/tmp/alpha',
    scope,
    agents: ['Cursor'],
    source: '0froq/pack',
    sourceUrl: 'https://github.com/0froq/pack',
    sourceType: 'github',
    status: 'tracked'
  }]));
  process.exit(0);
}
console.log(args.join(' '));
`,
  );
  await chmod(bin, 0o755);
  process.env.SKILLY_SKILLS_BIN = bin;
  try {
    const listed = await runSkills(['list', '-g', '--json'], { timeoutMs: 10_000 });
    assert.equal(listed.code, 0);
    const skills = parseSkillList(extractJson(listed.stdout));
    assert.equal(skills[0]?.name, 'alpha');
    assert.equal(skills[0]?.status, 'tracked');
    await assert.rejects(runSkills(['add', '--copy'], { timeoutMs: 5_000 }), /--copy/);
  } finally {
    if (previous === undefined) delete process.env.SKILLY_SKILLS_BIN;
    else process.env.SKILLY_SKILLS_BIN = previous;
  }
});
