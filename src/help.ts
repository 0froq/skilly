export interface KeyHelp {
  keys: string;
  label: string;
}

export const KEY_HELP: readonly KeyHelp[] = [
  { keys: 'j / k', label: 'Move' },
  { keys: 'f / tab', label: 'Cycle scope: all, global, each project' },
  { keys: '/', label: 'Filter by name or source' },
  { keys: 'r', label: 'Refresh' },
  { keys: 'c', label: 'Check updates' },
  { keys: 'u', label: 'Update selected tracked skill' },
  { keys: 'U', label: 'Update all tracked skills in view' },
  { keys: 'd', label: 'Remove selected skill (confirm)' },
  { keys: 'a', label: 'Add a skill (symlink, no --copy)' },
  { keys: 'g', label: 'Edit project globs' },
  { keys: 'l', label: 'Last command output' },
  { keys: '?', label: 'Help' },
  { keys: 'q', label: 'Quit' },
];

export const FOOTER =
  'j/k move  f scope  / filter  r refresh  c check  u/U update  d remove  a add  g globs  l log  ? help  q quit';
