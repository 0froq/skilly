import { homedir } from 'node:os';
import { validateAdd } from './commands.js';
import { isDangerousGlob } from './discover.js';
import {
  clampSelection,
  cycleScope,
  isUpdatable,
  selectedSkill,
  visibleSkills,
  type AddStep,
  type AppModel,
  type Phase,
  type SkillRow,
} from './model.js';
import { scopeChoices } from './targets.js';

export interface KeyInfo {
  upArrow: boolean;
  downArrow: boolean;
  return: boolean;
  escape: boolean;
  ctrl: boolean;
  shift: boolean;
  tab: boolean;
  backspace: boolean;
  delete: boolean;
  pageDown: boolean;
  pageUp: boolean;
  home: boolean;
  end: boolean;
  meta: boolean;
}

export interface KeyPress {
  input: string;
  key: KeyInfo;
}

export type Effect =
  | { type: 'none' }
  | { type: 'quit' }
  | { type: 'refresh' }
  | { type: 'check' }
  | { type: 'update-one'; skill: SkillRow }
  | { type: 'update-all' }
  | { type: 'remove'; skill: SkillRow }
  | { type: 'add'; source: string; skill: string; agents: string; global: boolean; cwd: string }
  | { type: 'save-config'; globs: string[] };

export interface KeyResult {
  model: AppModel;
  effect: Effect;
}

const NONE: Effect = { type: 'none' };

const ADD_STEPS: readonly AddStep[] = ['source', 'skill', 'agents', 'scope'];

export function reduceKey(model: AppModel, press: KeyPress): KeyResult {
  switch (model.phase.type) {
    case 'loading':
    case 'busy':
      return lockedKey(model, press);
    case 'browse':
      return browseKey(model, press);
    case 'filter':
      return filterKey(model, press);
    case 'confirm-remove':
      return confirmKey(model, press);
    case 'help':
      return helpKey(model, press);
    case 'log':
      return logKey(model, press);
    case 'config':
      return configKey(model, press);
    case 'add':
      return addKey(model, press);
    default: {
      const unreachable: never = model.phase;
      return unreachable;
    }
  }
}

function lockedKey(model: AppModel, press: KeyPress): KeyResult {
  if (press.input === 'q' || (press.key.ctrl && press.input === 'c')) return quit(model);
  return none(model);
}

function browseKey(model: AppModel, press: KeyPress): KeyResult {
  const { input, key } = press;
  if (input === 'q' || (key.ctrl && input === 'c')) return quit(model);
  if (key.upArrow || input === 'k') return move(model, -1);
  if (key.downArrow || input === 'j') return move(model, 1);
  if (key.pageUp || (key.ctrl && input === 'u')) return move(model, -10);
  if (key.pageDown || (key.ctrl && input === 'd')) return move(model, 10);
  if (key.home) return none({ ...model, selected: 0 });
  if (key.end) {
    const count = visibleSkills(model).length;
    return none({ ...model, selected: Math.max(0, count - 1) });
  }
  if (input === '\t' || key.tab) return cycle(model, key.shift ? -1 : 1);
  if (input === 'f') return cycle(model, 1);
  if (input === 'F') return cycle(model, -1);
  if (input === '/') return none({ ...model, phase: { type: 'filter', before: model.query } });
  if (input === 'r') return busy(model, 'Refreshing…', { type: 'refresh' });
  if (input === 'c') return busy(model, 'Checking…', { type: 'check' });
  if (input === 'u') return startUpdateOne(model);
  if (input === 'U') return busy(model, 'Updating tracked skills…', { type: 'update-all' });
  if (input === 'd' || input === 'x') return startRemove(model);
  if (input === 'a') return startAdd(model);
  if (input === 'g') return none({ ...model, phase: { type: 'config', index: 0, draft: null } });
  if (input === 'l') return openLog(model);
  if (input === '?') return none({ ...model, phase: { type: 'help' } });
  return none(model);
}

function filterKey(model: AppModel, press: KeyPress): KeyResult {
  if (model.phase.type !== 'filter') return none(model);
  if (press.key.escape) {
    return none(clampSelection({ ...model, query: model.phase.before, phase: { type: 'browse' } }));
  }
  if (press.key.return) return none(clampSelection({ ...model, phase: { type: 'browse' } }));
  if (press.key.backspace || press.key.delete) {
    return none(clampSelection({ ...model, query: model.query.slice(0, -1), selected: 0 }));
  }
  if (isText(press)) {
    return none(clampSelection({ ...model, query: model.query + press.input, selected: 0 }));
  }
  return none(model);
}

function confirmKey(model: AppModel, press: KeyPress): KeyResult {
  const skill = selectedSkill(model);
  if (press.input === 'y' || press.input === 'Y') {
    if (!skill) return notice({ ...model, phase: { type: 'browse' } }, 'No skill selected');
    return busy(model, `Removing ${skill.name}…`, { type: 'remove', skill });
  }
  if (press.input === 'n' || press.input === 'N' || press.key.escape || press.input === 'q') {
    return notice({ ...model, phase: { type: 'browse' } }, 'Remove cancelled');
  }
  return none(model);
}

function helpKey(model: AppModel, press: KeyPress): KeyResult {
  if (press.input === 'q') return quit(model);
  if (press.key.escape || press.key.return || press.input === '?') {
    return none({ ...model, phase: { type: 'browse' } });
  }
  return none(model);
}

function logKey(model: AppModel, press: KeyPress): KeyResult {
  if (press.input === 'q') return quit(model);
  if (press.key.escape || press.key.return || press.input === 'l') {
    return none({ ...model, phase: { type: 'browse' } });
  }
  return none(model);
}

function configKey(model: AppModel, press: KeyPress): KeyResult {
  if (model.phase.type !== 'config') return none(model);
  const phase = model.phase;
  if (phase.draft !== null) return configDraftKey(model, phase, press);
  if (press.key.escape || press.key.return) {
    return busy(model, 'Saving config…', { type: 'save-config', globs: [...model.globs] });
  }
  if (press.input === 'j' || press.key.downArrow) {
    return none({
      ...model,
      phase: { ...phase, index: moveIndex(model.globs.length, phase.index, 1) },
    });
  }
  if (press.input === 'k' || press.key.upArrow) {
    return none({
      ...model,
      phase: { ...phase, index: moveIndex(model.globs.length, phase.index, -1) },
    });
  }
  if (press.input === 'a') return none({ ...model, phase: { ...phase, draft: '' } });
  if (press.input === 'x') {
    if (model.globs.length === 0) return notice(model, 'No globs to delete');
    const globs = model.globs.filter((_, index) => index !== phase.index);
    const index = moveIndex(globs.length, phase.index, 0);
    return none({ ...model, globs, phase: { ...phase, index } });
  }
  return none(model);
}

function configDraftKey(model: AppModel, phase: Extract<Phase, { type: 'config' }>, press: KeyPress): KeyResult {
  const draft = phase.draft ?? '';
  if (press.key.escape) return none({ ...model, phase: { ...phase, draft: null } });
  if (press.key.return) {
    const next = draft.trim();
    if (!next) return none({ ...model, phase: { ...phase, draft: null } });
    if (isDangerousGlob(next)) return notice(model, 'Glob is too broad');
    if (model.globs.includes(next)) return notice(model, 'Glob already listed');
    const globs = [...model.globs, next];
    return none({ ...model, globs, phase: { type: 'config', index: globs.length - 1, draft: null } });
  }
  if (press.key.backspace || press.key.delete) {
    return none({ ...model, phase: { ...phase, draft: draft.slice(0, -1) } });
  }
  if (isText(press)) return none({ ...model, phase: { ...phase, draft: draft + press.input } });
  return none(model);
}

function addKey(model: AppModel, press: KeyPress): KeyResult {
  if (model.phase.type !== 'add') return none(model);
  const phase = model.phase;
  if (press.input === 'q' && phase.step === 'scope') return quit(model);
  if (press.key.escape) return addBack(model);
  if (phase.step === 'scope') return addScopeKey(model, press);
  if (press.key.return) return addAdvance(model);
  if (press.key.backspace || press.key.delete) return none(patchAdd(model, { [phase.step]: textOf(phase).slice(0, -1) }));
  if (isText(press)) return none(patchAdd(model, { [phase.step]: textOf(phase) + press.input }));
  return none(model);
}

function addScopeKey(model: AppModel, press: KeyPress): KeyResult {
  if (model.phase.type !== 'add') return none(model);
  const choices = scopeChoices(model.projects);
  if (press.key.return) return finishAdd(model);
  if (press.input === 'j' || press.key.downArrow) {
    return none(patchAdd(model, { scopeIndex: moveIndex(choices.length, model.phase.scopeIndex, 1) }));
  }
  if (press.input === 'k' || press.key.upArrow) {
    return none(patchAdd(model, { scopeIndex: moveIndex(choices.length, model.phase.scopeIndex, -1) }));
  }
  return none(model);
}

function addAdvance(model: AppModel): KeyResult {
  if (model.phase.type !== 'add') return none(model);
  if (model.phase.step === 'source' && model.phase.source.trim().length === 0) {
    return notice(model, 'Source is required');
  }
  const order = ADD_STEPS;
  const index = order.indexOf(model.phase.step);
  const next = order[index + 1];
  if (!next) return finishAdd(model);
  return none(patchAdd(model, { step: next }));
}

function addBack(model: AppModel): KeyResult {
  if (model.phase.type !== 'add') return none(model);
  const index = ADD_STEPS.indexOf(model.phase.step);
  const prev = index > 0 ? ADD_STEPS[index - 1] : undefined;
  if (!prev) return notice({ ...model, phase: { type: 'browse' } }, 'Add cancelled');
  return none(patchAdd(model, { step: prev }));
}

function finishAdd(model: AppModel): KeyResult {
  if (model.phase.type !== 'add') return none(model);
  const problem = validateAdd(model.phase);
  if (problem) return notice(model, problem);
  const choice = scopeChoices(model.projects)[model.phase.scopeIndex] ?? { kind: 'global' as const };
  const global = choice.kind === 'global';
  const cwd = choice.kind === 'project' ? choice.path : homedir();
  return busy(model, 'Adding…', {
    type: 'add',
    source: model.phase.source.trim(),
    skill: model.phase.skill.trim() || '*',
    agents: model.phase.agents.trim() || '*',
    global,
    cwd,
  });
}

function startUpdateOne(model: AppModel): KeyResult {
  const skill = selectedSkill(model);
  if (!skill) return notice(model, 'No skill selected');
  if (!isUpdatable(skill)) return notice(model, `${skill.name} is untracked — no upstream to update`);
  return busy(model, `Updating ${skill.name}…`, { type: 'update-one', skill });
}

function startRemove(model: AppModel): KeyResult {
  const skill = selectedSkill(model);
  if (!skill) return notice(model, 'No skill selected');
  return none({ ...model, phase: { type: 'confirm-remove' } });
}

function startAdd(model: AppModel): KeyResult {
  const choices = scopeChoices(model.projects);
  const scope = model.scope;
  let scopeIndex = 0;
  if (scope.kind === 'global') {
    scopeIndex = choices.findIndex((choice) => choice.kind === 'global');
  } else if (scope.kind === 'project') {
    const projectPath = scope.path;
    scopeIndex = choices.findIndex((choice) => choice.kind === 'project' && choice.path === projectPath);
  }
  if (scopeIndex < 0) scopeIndex = 0;
  return none({
    ...model,
    phase: { type: 'add', step: 'source', source: '', skill: '', agents: '', scopeIndex },
  });
}

function openLog(model: AppModel): KeyResult {
  if (!model.logText.trim()) return notice(model, 'No command output yet');
  return none({ ...model, phase: { type: 'log' } });
}

function cycle(model: AppModel, direction: 1 | -1): KeyResult {
  const scope = cycleScope(model.scope, model.projects, direction);
  return none(clampSelection({ ...model, scope, selected: 0 }));
}

function move(model: AppModel, delta: number): KeyResult {
  const count = visibleSkills(model).length;
  if (count === 0) return none(model);
  const selected = Math.max(0, Math.min(count - 1, model.selected + delta));
  return none({ ...model, selected });
}

function isText(press: KeyPress): boolean {
  if (press.key.ctrl || press.key.meta || press.key.escape || press.key.return || press.key.tab || press.key.backspace) {
    return false;
  }
  if (press.input.length === 0) return false;
  return [...press.input].every((char) => {
    const code = char.charCodeAt(0);
    return code >= 32 && code !== 127;
  });
}

function moveIndex(length: number, index: number, delta: number): number {
  if (length <= 0) return 0;
  return Math.max(0, Math.min(length - 1, index + delta));
}

function textOf(phase: Extract<Phase, { type: 'add' }>): string {
  switch (phase.step) {
    case 'source':
      return phase.source;
    case 'skill':
      return phase.skill;
    case 'agents':
      return phase.agents;
    case 'scope':
      return '';
    default: {
      const unreachable: never = phase.step;
      return unreachable;
    }
  }
}

function patchAdd(model: AppModel, patch: Partial<Extract<Phase, { type: 'add' }>>): AppModel {
  if (model.phase.type !== 'add') return model;
  return { ...model, phase: { ...model.phase, ...patch } };
}

function busy(model: AppModel, noticeText: string, effect: Effect): KeyResult {
  return { model: { ...model, phase: { type: 'busy' }, notice: noticeText, logText: '' }, effect };
}

function notice(model: AppModel, text: string): KeyResult {
  return { model: { ...model, notice: text }, effect: NONE };
}

function none(model: AppModel): KeyResult {
  return { model, effect: NONE };
}

function quit(model: AppModel): KeyResult {
  return { model, effect: { type: 'quit' } };
}

export function blankKey(): KeyInfo {
  return {
    upArrow: false,
    downArrow: false,
    return: false,
    escape: false,
    ctrl: false,
    shift: false,
    tab: false,
    backspace: false,
    delete: false,
    pageDown: false,
    pageUp: false,
    home: false,
    end: false,
    meta: false,
  };
}
