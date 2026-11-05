import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function readSkillBlurb(skillPath: string | null): Promise<string | null> {
  if (!skillPath) return null;
  let text: string;
  try {
    text = await readFile(join(skillPath, 'SKILL.md'), 'utf8');
  } catch {
    return null;
  }
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const block = match?.[1];
  if (!block) return null;
  const line = block.split(/\r?\n/).find((item) => item.startsWith('description:'));
  if (!line) return null;
  const value = line.slice('description:'.length).trim().replace(/^['"]|['"]$/g, '');
  return value.length > 0 ? value : null;
}
