import { homedir } from 'node:os';
import { sep } from 'node:path';

export function stripAnsi(value: string): string {
  return value
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g, '');
}

export function shortenPath(fullPath: string, home = homedir()): string {
  if (fullPath === home) return '~';
  const prefix = home.endsWith(sep) ? home : home + sep;
  if (fullPath.startsWith(prefix)) return `~${sep}${fullPath.slice(prefix.length)}`;
  return fullPath;
}

export function skillLineText(mark: string, name: string, scope: string, width: number): string {
  if (width <= 0) return '';
  const chrome = 3;
  const scopeWidth = Math.min(scope.length, Math.max(0, Math.min(18, width - chrome - 4)));
  const nameWidth = Math.max(0, width - chrome - scopeWidth);
  const shownScope = clipStart(scope, scopeWidth);
  const shownName = clipEnd(name, nameWidth).padEnd(nameWidth);
  const line = `${mark} ${shownName} ${shownScope}`;
  return line.length <= width ? line : line.slice(0, width);
}

export function clipEnd(text: string, max: number): string {
  if (max <= 0) return '';
  if (text.length <= max) return text;
  if (max === 1) return '…';
  return `${text.slice(0, max - 1)}…`;
}

export function clipStart(text: string, max: number): string {
  if (max <= 0) return '';
  if (text.length <= max) return text;
  if (max === 1) return '…';
  return `…${text.slice(-(max - 1))}`;
}

export function appendLog(current: string, chunk: string, max = 20_000): string {
  const next = current + chunk;
  if (next.length <= max) return next;
  return next.slice(next.length - max);
}

export function tailLines(text: string, maxLines: number): string[] {
  const cleaned = stripAnsi(text).replace(/\r/g, '\n');
  const lines = cleaned.split('\n');
  if (maxLines <= 0) return [];
  return lines.slice(Math.max(0, lines.length - maxLines));
}

export function firstLine(text: string): string {
  const line = stripAnsi(text).split('\n').find((item) => item.trim().length > 0);
  return line?.trim() ?? '';
}
