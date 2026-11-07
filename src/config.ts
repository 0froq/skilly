import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { parse } from 'smol-toml';

export const DEFAULT_GLOBS = ['~/code/0froq/**'];

export function resolveConfigPath(explicit?: string): string {
  if (explicit && explicit.trim()) return isAbsolute(explicit) ? explicit : resolve(explicit);
  const fromEnv = process.env.SKILLY_CONFIG?.trim();
  if (fromEnv) return isAbsolute(fromEnv) ? fromEnv : resolve(fromEnv);
  const base = process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), '.config');
  return join(base, 'skilly', 'config.toml');
}

export function formatConfig(globs: readonly string[]): string {
  const body = globs.map((glob) => `  ${JSON.stringify(glob)},`).join('\n');
  return `# skilly — directories to search for project skills\nproject_globs = [\n${body}\n]\n`;
}

export function parseConfig(text: string): { globs: string[] } {
  const parsed = parse(text) as Record<string, unknown>;
  if (!('project_globs' in parsed) || parsed.project_globs === undefined) {
    return { globs: [...DEFAULT_GLOBS] };
  }
  const raw = parsed.project_globs;
  if (!Array.isArray(raw) || raw.some((item) => typeof item !== 'string')) {
    throw new Error('project_globs must be an array of strings');
  }
  return { globs: [...raw] };
}

export async function writeConfig(path: string, globs: readonly string[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, formatConfig(globs), 'utf8');
}

export async function readConfig(path: string): Promise<{ globs: string[]; created: boolean; error: string | null }> {
  try {
    const text = await readFile(path, 'utf8');
    try {
      return { globs: parseConfig(text).globs, created: false, error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid config';
      return { globs: [...DEFAULT_GLOBS], created: false, error: message };
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') throw error;
    await writeConfig(path, DEFAULT_GLOBS);
    return { globs: [...DEFAULT_GLOBS], created: true, error: null };
  }
}
