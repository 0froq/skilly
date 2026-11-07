import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const MAX_BODY_CHARS = 24_000;

export interface SkillDocument {
  description: string | null;
  body: string | null;
}

export function splitSkillMarkdown(text: string): SkillDocument {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    const body = text.trim();
    return { description: null, body: body.length > 0 ? body : null };
  }
  const front = match[1] ?? '';
  const rest = text.slice(match[0].length).trim();
  return {
    description: descriptionFromFrontmatter(front),
    body: rest.length > 0 ? rest : null,
  };
}

export function wrapText(text: string, width: number): string[] {
  if (width <= 0) return [];
  const lines: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (raw.length === 0) {
      lines.push('');
      continue;
    }
    let rest = raw;
    while (rest.length > width) {
      const space = rest.lastIndexOf(' ', width);
      const cut = space > 0 ? space : width;
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut).replace(/^ /, '');
    }
    lines.push(rest);
  }
  return lines;
}

export async function readSkillDocument(skillPath: string | null): Promise<SkillDocument | null> {
  if (!skillPath) return null;
  let text: string;
  try {
    text = await readFile(join(skillPath, 'SKILL.md'), 'utf8');
  } catch {
    return null;
  }
  const doc = splitSkillMarkdown(text);
  if (doc.body && doc.body.length > MAX_BODY_CHARS) {
    return { ...doc, body: `${doc.body.slice(0, MAX_BODY_CHARS)}\n…` };
  }
  return doc;
}

export async function readSkillBlurb(skillPath: string | null): Promise<string | null> {
  const doc = await readSkillDocument(skillPath);
  return doc?.description ?? null;
}

function descriptionFromFrontmatter(front: string): string | null {
  const line = front.split(/\r?\n/).find((item) => item.startsWith('description:'));
  if (!line) return null;
  const value = line.slice('description:'.length).trim().replace(/^['"]|['"]$/g, '');
  return value.length > 0 ? value : null;
}
