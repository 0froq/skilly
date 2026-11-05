import { homedir } from 'node:os';
import { readSkillBlurb } from './blurb.js';
import { buildListArgs } from './commands.js';
import { readConfig } from './config.js';
import { discoverProjects } from './discover.js';
import { inspectLayout } from './layout.js';
import { compareSkills, skillId, type RefreshResult, type ScanProgress, type SkillRow } from './model.js';
import { parseSkillList, extractJson, type ListedSkill } from './parse.js';
import { mapPool } from './pool.js';
import { runSkills, type RunSkillsOptions } from './skills-cli.js';
import { firstLine, shortenPath, stripNpmNoise } from './text.js';

interface ListTask {
  global: boolean;
  cwd: string;
  projectPath: string | null;
  label: string;
}

export async function refreshAll(
  configFile: string,
  hooks: Pick<RunSkillsOptions, 'signal'> & { onProgress?: (progress: ScanProgress) => void } = {},
): Promise<RefreshResult> {
  const report = (progress: ScanProgress): void => {
    hooks.onProgress?.(progress);
  };

  report({ label: 'Reading config', completed: 0, total: 0, current: configFile, found: 0 });
  const config = await readConfig(configFile);
  if (hooks.signal?.aborted) {
    return { globs: config.globs, projects: [], notes: [], skills: [], errors: [], log: '', aborted: true };
  }

  const globLabel = config.globs.length > 1 ? `${config.globs.length} globs` : (config.globs[0] ?? '');
  report({ label: 'Finding projects', completed: 0, total: 0, current: globLabel, found: 0 });
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

  let completed = 0;
  let found = 0;
  const summaries = new Map<string, string>();
  const reportList = (current: string): void => {
    report({ label: 'Listing skills', completed, total: tasks.length, current, found });
  };
  reportList(tasks[0]?.label ?? 'global');

  const listed = await mapPool(tasks, 3, async (task) => {
    if (hooks.signal?.aborted) return { task, aborted: true as const };
    reportList(task.label);
    const args = buildListArgs(task.global);
    const result = await runSkills(args, { cwd: task.cwd, signal: hooks.signal, timeoutMs: 90_000 });
    if (result.aborted || hooks.signal?.aborted) return { task, aborted: true as const };
    const outcome = await finishTask(task, result);
    completed += 1;
    found += outcome.skills.length;
    summaries.set(task.label, outcome.summary);
    reportList(task.label);
    return { task, aborted: false as const, outcome };
  });

  if (hooks.signal?.aborted || listed.some((item) => item.aborted)) {
    return {
      globs: config.globs,
      projects: discovered.projects,
      notes,
      skills: [],
      errors: [],
      log: '',
      aborted: true,
    };
  }

  const errors: string[] = [];
  const skills: SkillRow[] = [];
  for (const item of listed) {
    if (item.aborted) continue;
    errors.push(...item.outcome.errors);
    skills.push(...item.outcome.skills);
  }

  skills.sort(compareSkills);
  const logLines = [`scanned ${tasks.length} directories`];
  for (const task of tasks) {
    const line = summaries.get(task.label);
    if (line) logLines.push(line);
  }
  return {
    globs: config.globs,
    projects: discovered.projects,
    notes,
    skills,
    errors,
    log: logLines.join('\n'),
    aborted: false,
  };
}

async function finishTask(
  task: ListTask,
  result: Awaited<ReturnType<typeof runSkills>>,
): Promise<{ skills: SkillRow[]; errors: string[]; summary: string }> {
  const where = task.global ? 'global' : shortenPath(task.label);
  if (result.timedOut) {
    return { skills: [], errors: [`${where}: timed out`], summary: `${where} · timed out` };
  }
  if (result.code !== 0) {
    const message = failureText(result.stderr, result.code);
    return { skills: [], errors: [`${where}: ${message}`], summary: `${where} · ${message}` };
  }
  try {
    const parsed = parseSkillList(extractJson(result.stdout));
    const skills = await Promise.all(parsed.map((skill) => toRow(skill, task)));
    const count = `${skills.length} skill${skills.length === 1 ? '' : 's'}`;
    return { skills, errors: [], summary: `${where} · ${count}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'bad JSON';
    return { skills: [], errors: [`${where}: ${message}`], summary: `${where} · ${message}` };
  }
}

function failureText(stderr: string, code: number | null): string {
  return firstLine(stripNpmNoise(stderr)) || `exit ${code ?? '?'}`;
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
