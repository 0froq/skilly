#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render } from 'ink';
import { App } from './app.js';
import { resolveConfigPath } from './config.js';

function readVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function printHelp(): void {
  console.log(`skilly — terminal UI for npx skills

Usage:
  skilly [--config <path>]
  skilly --help
  skilly --version

Config:
  ~/.config/skilly/config.toml
  $XDG_CONFIG_HOME/skilly/config.toml
  SKILLY_CONFIG or --config

Backend:
  npx --yes skills
  Set SKILLY_SKILLS_BIN to a skills executable to skip npx.
  Installs use the default symlink mode. skilly never passes --copy.
`);
}

const args = process.argv.slice(2);
let configArg: string | undefined;
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === '--help' || arg === '-h') {
    printHelp();
    process.exit(0);
  }
  if (arg === '--version' || arg === '-v') {
    console.log(readVersion());
    process.exit(0);
  }
  if (arg === '--config') {
    const next = args[index + 1];
    if (!next) {
      console.error('skilly: --config needs a path');
      process.exit(1);
    }
    configArg = next;
    index += 1;
    continue;
  }
  console.error(`skilly: unknown argument ${arg ?? ''}`);
  printHelp();
  process.exit(1);
}

if (!process.stdout.isTTY) {
  console.error('skilly is a terminal UI. Run it in an interactive terminal.');
  process.exit(1);
}

const instance = render(<App configPath={resolveConfigPath(configArg)} version={readVersion()} />, {
  exitOnCtrlC: true,
  alternateScreen: true,
  patchConsole: false,
});

await instance.waitUntilExit();
