import { homedir } from 'node:os';
import { readSkillBlurb } from './blurb.js';
import { buildListArgs } from './commands.js';
import { readConfig } from './config.js';
import { discoverProjects } from './discover.js';
import { inspectLayout } from './layout.js';
import { compareSkills, skillId, type RefreshResult, type SkillRow } from './model.js';
import { parseSkillList, extractJson, type ListedSkill } from './parse.js';
import { mapPool } from './pool.js';
import { formatCommandLine, runSkills, type RunSkillsOptions } from './skills-cli.js';
import { firstLine } from './text.js';

interface ListTask {
  global: boolean;
  cwd: string;
  projectPath: string | null;
  label: string;
}

export async function refreshAll(
  configFile: string,
  hooks: Pick<RunSkillsOptions, 'signal' | 'onChunk'> = {},
): Promise<RefreshResult> {
  const chunks: string[] = [];
  const note = (chunk: string): void => {
    chunks.push(chunk);
    hooks.onChunk?.(chunk);
  };

  const config = await readConfig(configFile);
  if (hooks.signal?.aborted) {
    return { globs: config.globs, projects: [], notes: [], skills: [], errors: [], log: '', aborted: true };
  }

  const discovered = await discoverProjects(config.globs);
  const notes = [...discovered.notes];
  if (config.created) notes.unshift(`Created ${configFile}`);
  if (config.error) notes.unshift(config.error);

  const tasks: ListTask[] = [
    { global: true, cwd: homedir(), projectPath: null, label: 'global' },
    ...discovered.projects.map((project) => ({
      global: false,
      cwd: project,
      projectPath: project,
      label: project,
    })),
  ];

  const listed = await mapPool(tasks, 3, async (task) => {
    if (hooks.signal?.aborted) return { task, aborted: true as const };
    const args = buildListArgs(task.global);
    const result = await runSkills(args, { cwd: task.cwd, signal: hooks.signal, timeoutMs: 90_000 });
    note(`\n$ ${formatCommandLine(args, task.cwd)}\n${result.stdout}${result.stderr}`);
    return { task, aborted: false as const, result };
  });

  if (hooks.signal?.aborted) {
    return {
      globs: config.globs,
      projects: discovered.projects,
      notes,
      skills: [],
      errors: [],
      log: chunks.join(''),
      aborted: true,
    };
  }

  const errors: string[] = [];
  const skills: SkillRow[] = [];
  for (const item of listed) {
    if (item.aborted || !('result' in item)) continue;
    const { task, result } = item;
    if (result.aborted) {
      return {
        globs: config.globs,
        projects: discovered.projects,
        notes,
        skills,
        errors,
        log: chunks.join(''),
        aborted: true,
      };
    }
    if (result.timedOut) {
      errors.push(`${task.label}: timed out`);
      continue;
    }
    if (result.code !== 0) {
      errors.push(`${task.label}: ${firstLine(result.stderr) || `exit ${result.code}`}`);
      continue;
    }
    try {
      const parsed = parseSkillList(extractJson(result.stdout));
      const rows = await Promise.all(parsed.map((skill) => toRow(skill, task)));
      skills.push(...rows);
    } catch (error) {
      errors.push(`${task.label}: ${error instanceof Error ? error.message : 'bad JSON'}`);
    }
  }

  skills.sort(compareSkills);
  return {
    globs: config.globs,
    projects: discovered.projects,
    notes,
    skills,
    errors,
    log: chunks.join(''),
    aborted: false,
  };
}

async function toRow(skill: ListedSkill, task: ListTask): Promise<SkillRow> {
  const projectPath = task.global ? null : task.projectPath;
  const scope = task.global ? 'global' : 'project';
  const [layout, blurb] = await Promise.all([
    inspectLayout({
      skillPath: skill.path,
      skillName: skill.name,
      scope,
      projectPath,
    }),
    readSkillBlurb(skill.path),
  ]);
  return {
    id: skillId(scope, projectPath, skill.name),
    name: skill.name,
    path: skill.path,
    scope,
    projectPath,
    agents: skill.agents,
    source: skill.source,
    sourceUrl: skill.sourceUrl,
    sourceType: skill.sourceType,
    status: skill.status,
    layout,
    blurb,
  };
}
