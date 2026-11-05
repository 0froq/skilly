import { stripAnsi } from './text.js';

export type SkillStatus = 'tracked' | 'untracked' | 'missing' | 'modified' | 'unknown';

export interface ListedSkill {
  name: string;
  path: string | null;
  scope: 'global' | 'project';
  agents: string[];
  source: string | null;
  sourceUrl: string | null;
  sourceType: string | null;
  status: SkillStatus;
}

const STATUSES = new Set<SkillStatus>(['tracked', 'untracked', 'missing', 'modified']);

export function extractJson(stdout: string): unknown {
  const cleaned = stripAnsi(stdout).trim();
  const start = cleaned.search(/[[{]/);
  if (start < 0) throw new Error('skills CLI did not return JSON');
  const slice = cleaned.slice(start);
  try {
    return JSON.parse(slice) as unknown;
  } catch {
    const end = Math.max(slice.lastIndexOf(']'), slice.lastIndexOf('}'));
    if (end <= 0) throw new Error('skills CLI returned invalid JSON');
    return JSON.parse(slice.slice(0, end + 1)) as unknown;
  }
}

export function parseSkillList(value: unknown): ListedSkill[] {
  if (!Array.isArray(value)) throw new Error('skills list JSON must be an array');
  return value.map((item, index) => parseListedSkill(item, index));
}

function parseListedSkill(value: unknown, index: number): ListedSkill {
  if (!value || typeof value !== 'object') {
    throw new Error(`skills list item ${index} is not an object`);
  }
  const raw = value as Record<string, unknown>;
  if (typeof raw.name !== 'string' || raw.name.length === 0) {
    throw new Error(`skills list item ${index} is missing name`);
  }
  const scope = raw.scope === 'global' ? 'global' : raw.scope === 'project' ? 'project' : null;
  if (!scope) throw new Error(`skills list item ${index} has no scope`);
  const source = stringOrNull(raw.source, `item ${index} source`);
  return {
    name: raw.name,
    path: stringOrNull(raw.path, `item ${index} path`),
    scope,
    agents: stringArray(raw.agents, `item ${index} agents`),
    source,
    sourceUrl: stringOrNull(raw.sourceUrl, `item ${index} sourceUrl`),
    sourceType: stringOrNull(raw.sourceType, `item ${index} sourceType`),
    status: parseStatus(raw.status, source),
  };
}

function parseStatus(value: unknown, source: string | null): SkillStatus {
  if (typeof value === 'string') {
    if (STATUSES.has(value as SkillStatus)) return value as SkillStatus;
    return 'unknown';
  }
  return source ? 'tracked' : 'untracked';
}

function stringOrNull(value: unknown, label: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  throw new Error(`${label} must be a string or null`);
}

function stringArray(value: unknown, label: string): string[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${label} must be an array of strings`);
  }
  return [...value];
}

export function parseCheckOutput(stdout: string): { outdated: string[] } {
  const text = stripAnsi(stdout).replace(/\r/g, '\n').trim();
  if (text.startsWith('[') || text.startsWith('{')) {
    const fromJson = outdatedFromJson(text);
    if (fromJson) return { outdated: fromJson };
  }
  const outdated: string[] = [];
  for (const line of text.split('\n')) {
    const match = line.match(/↑\s+(.+?)\s+has an update\s*$/);
    const name = match?.[1]?.trim();
    if (name) outdated.push(name);
  }
  return { outdated };
}

function outdatedFromJson(text: string): string[] | null {
  const start = text.indexOf('[');
  if (start < 0) return null;
  const end = text.lastIndexOf(']');
  if (end <= start) return null;
  let value: unknown;
  try {
    value = JSON.parse(text.slice(start, end + 1)) as unknown;
  } catch {
    return null;
  }
  if (!Array.isArray(value)) return null;
  const names: string[] = [];
  let recognized = value.length === 0;
  for (const item of value) {
    if (!item || typeof item !== 'object') return null;
    const record = item as Record<string, unknown>;
    if (typeof record.name !== 'string') return null;
    if ('outdated' in record || 'hasUpdate' in record || record.status === 'outdated' || record.status === 'current') {
      recognized = true;
    }
    const outdated = record.outdated === true || record.hasUpdate === true || record.status === 'outdated';
    if (outdated) names.push(record.name);
  }
  if (!recognized) return null;
  return names;
}
