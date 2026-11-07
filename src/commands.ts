export interface ScopeTarget {
  global: boolean;
  projectPath: string | null;
  names?: string[];
}

/** Argv for `npx skills`. Never includes `--copy`; installs stay symlinked. */
export function assertNoCopy(args: readonly string[]): void {
  if (args.includes('--copy')) {
    throw new Error('skilly refuses --copy; installs stay symlinked');
  }
}

export function buildListArgs(global: boolean): string[] {
  const args = global ? ['list', '-g', '--json'] : ['list', '--json'];
  assertNoCopy(args);
  return args;
}

export function buildCheckArgs(target: ScopeTarget): string[] {
  const args = ['check', '--json', '-y', target.global ? '-g' : '-p'];
  assertNoCopy(args);
  return args;
}

export function buildUpdateArgs(target: ScopeTarget): string[] {
  const args = ['update', '--json', '-y', target.global ? '-g' : '-p'];
  if (target.names && target.names.length > 0) args.push(...target.names);
  assertNoCopy(args);
  return args;
}

export function buildRemoveArgs(input: { global: boolean; name: string }): string[] {
  const args = ['remove', input.name, '--json', '-y'];
  if (input.global) args.push('-g');
  assertNoCopy(args);
  return args;
}

export function splitAgents(raw: string): string[] {
  const parts = raw
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return parts.length > 0 ? parts : ['*'];
}

export function validateAdd(input: { source: string; skill: string; agents: string }): string | null {
  const source = input.source.trim();
  if (!source) return 'Source is required';
  if (source.startsWith('-')) return 'Source looks like a flag';
  if (input.skill.trim().startsWith('-')) return 'Skill looks like a flag';
  if (splitAgents(input.agents).some((agent) => agent.startsWith('-'))) return 'Agent looks like a flag';
  return null;
}

export function buildAddArgs(input: { source: string; skill: string; agents: string; global: boolean }): string[] {
  const skill = input.skill.trim() || '*';
  const agents = splitAgents(input.agents);
  const args = ['add', input.source.trim(), '--json', '-y', '-s', skill, '-a', ...agents];
  if (input.global) args.push('-g');
  assertNoCopy(args);
  return args;
}
