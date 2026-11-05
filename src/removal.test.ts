import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { lstat, mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { skillId, type SkillRow } from './model.js';
import { performRemoval, removalHint, replaceScopeSkills, type RemovalCall } from './removal.js';
import type { SkillsResult } from './skills-cli.js';

function row(name: string, scope: 'global' | 'project', projectPath: string | null): SkillRow {
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
    status: 'untracked',
    layout: { kind: 'directory', target: null, agentSymlinks: 0, agentCopies: 0 },
    blurb: null,
  };
}

function result(partial: Partial<SkillsResult> & Pick<SkillsResult, 'stdout'>): SkillsResult {
  return {
    code: 0,
    stderr: '',
    timedOut: false,
    aborted: false,
    command: '',
    ...partial,
  };
}

test('replacing one scope leaves the other sections in place', () => {
  const global = row('writing-plans', 'global', null);
  const alpha = row('Hatch Pet', 'project', '/work/a');
  const beta = row('other', 'project', '/work/b');
  const next = replaceScopeSkills([global, alpha, beta], { global: false, projectPath: '/work/a' }, []);
  assert.deepEqual(next.map((skill) => skill.id), [global.id, beta.id]);
});

test('success text is not treated as proof when the skill is still installed', () => {
  assert.equal(removalHint('No matching skills found for: Linked Pet'), 'No matching skills found for: Linked Pet');
  assert.equal(removalHint('Successfully removed 1 skill(s)'), null);
});

test('deleting one project skill does not list or scan the other project', async () => {
  const calls: RemovalCall[] = [];
  const outcome = await performRemoval({
    skill: row('Hatch Pet', 'project', '/work/a'),
    skills: [row('writing-plans', 'global', null), row('Hatch Pet', 'project', '/work/a'), row('other', 'project', '/work/b')],
    home: '/home/fixture',
    invoke: async (args, cwd) => {
      calls.push({ args: [...args], cwd });
      if (args[0] === 'list') return result({ stdout: '[]' });
      return result({ stdout: 'Successfully removed 1 skill(s)' });
    },
  });
  assert.equal(outcome.removed, true);
  assert.equal(outcome.notice, 'Removed Hatch Pet');
  assert.deepEqual(
    outcome.skills.map((skill) => `${skill.scope}:${skill.projectPath ?? ''}:${skill.name}`),
    ['global::writing-plans', 'project:/work/b:other'],
  );
  assert.deepEqual(
    calls.map((call) => `${call.cwd} ${call.args.join(' ')}`),
    ['/work/a remove Hatch Pet --json -y', '/work/a list --json'],
  );
});

test('a no-op remove keeps the skill and says it was not removed', async () => {
  const calls: string[] = [];
  const outcome = await performRemoval({
    skill: row('Hatch Pet', 'project', '/work/a'),
    skills: [row('Hatch Pet', 'project', '/work/a'), row('other', 'project', '/work/b')],
    home: '/home/fixture',
    invoke: async (args, cwd) => {
      calls.push(`${cwd} ${args.join(' ')}`);
      if (args[0] === 'list') {
        return result({
          stdout: JSON.stringify([
            {
              name: 'Hatch Pet',
              path: null,
              scope: 'project',
              agents: [],
              source: null,
              sourceUrl: null,
              sourceType: null,
              status: 'untracked',
            },
          ]),
        });
      }
      return result({ stdout: 'No matching skills found for: Hatch Pet', code: 0 });
    },
  });
  assert.equal(outcome.removed, false);
  assert.match(outcome.notice, /Not removed: Hatch Pet/);
  assert.match(outcome.notice, /No matching skills found/);
  assert.equal(outcome.skills.some((skill) => skill.name === 'Hatch Pet' && skill.projectPath === '/work/a'), true);
  assert.equal(outcome.skills.some((skill) => skill.projectPath === '/work/b'), true);
  assert.deepEqual(calls, ['/work/a remove Hatch Pet --json -y', '/work/a list --json']);
});

function realSkills(home: string): (args: readonly string[], cwd: string) => Promise<SkillsResult> {
  return (args, cwd) =>
    new Promise((resolve) => {
      const child = spawn('npx', ['--yes', 'skills', ...args], {
        cwd,
        env: { ...process.env, HOME: home, SKILLY_SKILLS_BIN: '' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
      });
      child.on('error', (error) => {
        resolve({ code: 1, stdout, stderr: `${stderr}${error.message}`, timedOut: false, aborted: false, command: args.join(' ') });
      });
      child.on('close', (code) => {
        resolve({ code, stdout, stderr, timedOut: false, aborted: false, command: args.join(' ') });
      });
    });
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

test('real skills CLI removes a tracked project skill and leaves symlink or unsanitized names installed', async () => {
  const base = await mkdtemp(join(tmpdir(), 'skilly-rm-real-'));
  const home = join(base, 'home');
  const source = join(base, 'src', 'pet');
  const projectA = join(base, 'proj-a');
  const projectB = join(base, 'proj-b');
  await mkdir(source, { recursive: true });
  await mkdir(home, { recursive: true });
  await mkdir(projectA, { recursive: true });
  await mkdir(join(projectB, '.agents', 'skills'), { recursive: true });
  await writeFile(join(source, 'SKILL.md'), '---\nname: Hatch Pet\ndescription: Tracked pet\n---\n# Hatch Pet\n');
  const invoke = realSkills(home);
  const added = await invoke(['add', join(base, 'src'), '-s', 'Hatch Pet', '-a', 'cursor', '-y', '--json'], projectA);
  assert.equal(added.code, 0, added.stderr || added.stdout);

  const realSkill = join(base, 'real-skill');
  await mkdir(realSkill, { recursive: true });
  await writeFile(join(realSkill, 'SKILL.md'), '---\nname: Linked Pet\ndescription: Symlinked pet\n---\n# Linked\n');
  await symlink(realSkill, join(projectB, '.agents', 'skills', 'linked-pet'), 'dir');
  await mkdir(join(projectB, '.agents', 'skills', 'hatch pet'), { recursive: true });
  await writeFile(
    join(projectB, '.agents', 'skills', 'hatch pet', 'SKILL.md'),
    '---\nname: hatch pet\ndescription: Spaced folder\n---\n# spaced\n',
  );

  const tracked = row('Hatch Pet', 'project', projectA);
  tracked.status = 'tracked';
  tracked.path = join(projectA, '.agents', 'skills', 'hatch-pet');
  const linked = row('Linked Pet', 'project', projectB);
  linked.path = join(projectB, '.agents', 'skills', 'linked-pet');
  const spaced = row('hatch pet', 'project', projectB);
  spaced.path = join(projectB, '.agents', 'skills', 'hatch pet');

  const removed = await performRemoval({ skill: tracked, skills: [tracked, linked, spaced], home, invoke });
  assert.equal(removed.removed, true, `${removed.notice}\n${removed.log}`);
  assert.equal(removed.calls.every((call) => call.cwd === projectA), true);
  assert.equal(await exists(join(projectA, '.agents', 'skills', 'hatch-pet')), false);
  assert.equal(removed.skills.some((skill) => skill.projectPath === projectA), false);
  assert.equal(await exists(join(projectB, '.agents', 'skills', 'linked-pet')), true);

  const keptLink = await performRemoval({ skill: linked, skills: removed.skills, home, invoke });
  assert.equal(keptLink.removed, false);
  assert.match(keptLink.notice, /Not removed/);
  assert.match(keptLink.notice, /No matching skills found/);
  assert.equal(keptLink.calls.every((call) => call.cwd === projectB), true);
  assert.equal(await exists(join(projectB, '.agents', 'skills', 'linked-pet')), true);
  assert.equal(keptLink.skills.some((skill) => skill.name === 'Linked Pet'), true);

  const keptSpace = await performRemoval({ skill: spaced, skills: keptLink.skills, home, invoke });
  assert.equal(keptSpace.removed, false, keptSpace.log);
  assert.match(keptSpace.notice, /Not removed/);
  assert.equal(await exists(join(projectB, '.agents', 'skills', 'hatch pet')), true);
  assert.equal(keptSpace.skills.some((skill) => skill.name === 'hatch pet'), true);
});
