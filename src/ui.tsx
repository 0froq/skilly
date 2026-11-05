import { Box, Text } from 'ink';
import type { ReactNode } from 'react';
import { layoutHint, layoutLabel } from './layout.js';
import { FOOTER, KEY_HELP } from './help.js';
import {
  scrollStart,
  selectedSkill,
  updateLabel,
  visibleSkills,
  type AppModel,
  type SkillRow,
} from './model.js';
import { scopeChoices } from './targets.js';
import { clipEnd, clipStart, shortenPath, skillLineText, tailLines } from './text.js';

export function Screen(props: { model: AppModel; version: string; columns: number; rows: number }) {
  const phase = props.model.phase.type;
  switch (phase) {
    case 'help':
      return <HelpScreen {...props} />;
    case 'config':
      return <ConfigScreen {...props} />;
    case 'add':
      return <AddScreen {...props} />;
    case 'log':
    case 'busy':
    case 'loading':
      return <LogScreen {...props} />;
    case 'browse':
    case 'filter':
    case 'confirm-remove':
      return <BrowseScreen {...props} />;
    default: {
      const unreachable: never = phase;
      return unreachable;
    }
  }
}

function HelpScreen(props: { model: AppModel; version: string; columns: number; rows: number }) {
  return (
    <Frame {...props} title="Help">
      <Text>skilly shells out to npx skills. Installs stay symlinked; --copy is never passed.</Text>
      <Text> </Text>
      {KEY_HELP.map((item) => (
        <Text key={item.keys}>
          <Text color="cyan">{item.keys.padEnd(10)}</Text>
          {item.label}
        </Text>
      ))}
      <Text> </Text>
      <Text color="gray">esc close · q quit</Text>
    </Frame>
  );
}

function ConfigScreen(props: { model: AppModel; version: string; columns: number; rows: number }) {
  const phase = props.model.phase;
  if (phase.type !== 'config') return null;
  return (
    <Frame {...props} title="Project globs">
      <Text color="gray">{props.model.configPath}</Text>
      <Text> </Text>
      {props.model.globs.length === 0 ? <Text color="gray">none yet</Text> : null}
      {props.model.globs.map((glob, index) => (
        <Text key={`${glob}:${index}`} color={index === phase.index ? 'cyan' : undefined}>
          {index === phase.index ? '› ' : '  '}
          {glob}
        </Text>
      ))}
      {phase.draft !== null ? <Text color="yellow">new: {phase.draft}</Text> : null}
      <Text> </Text>
      <Text color="gray">a add · x delete · j/k move · esc save and reload</Text>
    </Frame>
  );
}

function AddScreen(props: { model: AppModel; version: string; columns: number; rows: number }) {
  const phase = props.model.phase;
  if (phase.type !== 'add') return null;
  const choices = scopeChoices(props.model.projects);
  const windowHeight = Math.max(3, props.rows - 12);
  const start = scrollStart(phase.scopeIndex, choices.length, windowHeight);
  const visible = choices.slice(start, start + windowHeight);
  return (
    <Frame {...props} title="Add skill">
      <Text color="gray">Symlink install. skilly does not pass --copy.</Text>
      <Field label="source" active={phase.step === 'source'} value={phase.source} hint="owner/repo or URL" />
      <Field label="skill" active={phase.step === 'skill'} value={phase.skill} hint="name, or * for all" />
      <Field label="agents" active={phase.step === 'agents'} value={phase.agents} hint="cursor claude-code, or *" />
      <Text> </Text>
      <Text color={phase.step === 'scope' ? 'cyan' : 'gray'}>scope</Text>
      {visible.map((choice, offset) => {
        const index = start + offset;
        const label = choice.kind === 'global' ? 'global (~/.agents/skills)' : shortenPath(choice.path);
        const selected = index === phase.scopeIndex;
        return (
          <Text key={choice.kind === 'global' ? 'global' : choice.path} color={selected ? 'cyan' : undefined}>
            {selected ? '› ' : '  '}
            {label}
          </Text>
        );
      })}
      <Text> </Text>
      <Text color="gray">enter next · esc back</Text>
      <Text color="gray">{clipEnd(props.model.notice, props.columns - 2)}</Text>
    </Frame>
  );
}

function Field(props: { label: string; active: boolean; value: string; hint: string }) {
  const shown = props.value.length > 0 ? props.value : props.hint;
  return (
    <Text color={props.active ? 'cyan' : undefined}>
      {props.active ? '› ' : '  '}
      {props.label.padEnd(8)}
      <Text color={props.value.length > 0 ? undefined : 'gray'}>{shown}</Text>
    </Text>
  );
}

function LogScreen(props: { model: AppModel; version: string; columns: number; rows: number }) {
  const lines = tailLines(props.model.logText, Math.max(4, props.rows - 5));
  const hint =
    props.model.phase.type === 'log' ? 'esc back · q quit' : 'working… ctrl+c aborts';
  return (
    <Frame {...props} title={props.model.phase.type === 'log' ? 'Output' : props.model.notice}>
      {lines.length === 0 ? <Text color="gray">…</Text> : null}
      {lines.map((line, index) => (
        <Text key={`${index}:${line}`} wrap="truncate">
          {clipEnd(line, props.columns - 2)}
        </Text>
      ))}
      <Text> </Text>
      <Text color="gray">{hint}</Text>
    </Frame>
  );
}

function BrowseScreen(props: { model: AppModel; version: string; columns: number; rows: number }) {
  const { model, columns, rows } = props;
  const stacked = columns < 76;
  const bodyHeight = Math.max(6, rows - 4);
  const listWidth = stacked ? columns : Math.max(28, Math.min(46, Math.floor(columns * 0.42)));
  const listHeight = stacked ? Math.max(4, Math.floor(bodyHeight * 0.5)) : bodyHeight;
  const visible = visibleSkills(model);
  const selected = selectedSkill(model);
  const inner = Math.max(1, listHeight - 2);
  const start = scrollStart(model.selected, visible.length, inner);
  const windowRows = visible.slice(start, start + inner);
  const scope = scopeText(model);

  return (
    <Box flexDirection="column" width={columns} height={rows}>
      <Header model={model} version={props.version} columns={columns} scope={scope} count={visible.length} />
      <Box flexGrow={1} flexDirection={stacked ? 'column' : 'row'}>
        <Box
          width={stacked ? columns : listWidth}
          height={listHeight}
          flexShrink={0}
          flexDirection="column"
          borderStyle="single"
          borderColor="gray"
        >
          {windowRows.length === 0 ? <Text color="gray"> No skills</Text> : null}
          {windowRows.map((skill, offset) => (
            <SkillLine
              key={skill.id}
              skill={skill}
              selected={start + offset === model.selected}
              width={Math.max(10, (stacked ? columns : listWidth) - 2)}
              outdated={model.updates[skill.id] === 'outdated'}
            />
          ))}
        </Box>
        <Box
          flexGrow={1}
          height={stacked ? undefined : bodyHeight}
          flexDirection="column"
          borderStyle="single"
          borderColor="gray"
          paddingX={1}
        >
          {selected ? <Detail skill={selected} model={model} /> : <EmptyDetail model={model} />}
        </Box>
      </Box>
      <Footer model={model} columns={columns} selected={selected} />
    </Box>
  );
}

function Header(props: { model: AppModel; version: string; columns: number; scope: string; count: number }) {
  return (
    <Box flexDirection="column">
      <Text wrap="truncate">
        <Text bold color="cyan">
          skilly
        </Text>
        <Text color="gray"> {props.version} </Text>
        <Text color="yellow">{props.scope}</Text>
        <Text color="gray">
          {' '}
          {props.count}/{props.model.skills.length}
          {props.model.query ? `  /${props.model.query}` : ''}
        </Text>
      </Text>
      <Text color={props.model.notice.includes('error') ? 'red' : 'gray'} wrap="truncate">
        {clipEnd(props.model.notice, props.columns)}
      </Text>
    </Box>
  );
}

function SkillLine(props: { skill: SkillRow; selected: boolean; width: number; outdated: boolean }) {
  const mark = props.outdated ? '↑' : props.skill.status === 'untracked' ? '?' : props.skill.status === 'missing' ? '!' : ' ';
  const scope = props.skill.scope === 'global' ? 'global' : shortenPath(props.skill.projectPath ?? '');
  const line = skillLineText(mark, props.skill.name, scope, Math.max(8, props.width - 1));
  return (
    <Text
      wrap="truncate"
      backgroundColor={props.selected ? 'cyan' : undefined}
      color={props.selected ? 'black' : props.outdated ? 'magenta' : props.skill.status === 'missing' ? 'red' : undefined}
    >
      {line}
    </Text>
  );
}

function Detail(props: { skill: SkillRow; model: AppModel }) {
  const hint = layoutHint(props.skill.layout);
  const fields: Array<[string, string]> = [
    ['scope', props.skill.scope],
    ['project', props.skill.projectPath ? shortenPath(props.skill.projectPath) : '—'],
    ['path', props.skill.path ? shortenPath(props.skill.path) : '—'],
    ['layout', layoutLabel(props.skill.layout)],
    ['agents', props.skill.agents.length > 0 ? props.skill.agents.join(', ') : '—'],
    ['source', props.skill.source ?? '—'],
    ['url', props.skill.sourceUrl ?? '—'],
    ['type', props.skill.sourceType ?? '—'],
    ['status', props.skill.status],
    ['update', updateLabel(props.model.updates[props.skill.id])],
  ];
  return (
    <Box flexDirection="column">
      <Text bold wrap="truncate">
        {props.skill.name}
      </Text>
      {props.skill.blurb ? <Text color="gray">{props.skill.blurb}</Text> : null}
      {fields.map(([label, value]) => (
        <Text key={label} wrap="wrap">
          <Text color="gray">{label.padEnd(8)}</Text>
          {value}
        </Text>
      ))}
      {hint ? <Text color="yellow">{hint}</Text> : null}
    </Box>
  );
}

function EmptyDetail(props: { model: AppModel }) {
  return (
    <Box flexDirection="column">
      <Text>No skill in this view.</Text>
      <Text> </Text>
      <Text color="gray">globs</Text>
      {props.model.globs.length === 0 ? <Text color="gray"> none</Text> : null}
      {props.model.globs.map((glob) => (
        <Text key={glob}> {glob}</Text>
      ))}
      <Text color="gray">projects</Text>
      {props.model.projects.length === 0 ? <Text color="gray"> none matched</Text> : null}
      {props.model.projects.slice(0, 8).map((project) => (
        <Text key={project}> {shortenPath(project)}</Text>
      ))}
      {props.model.discoverNotes.map((note) => (
        <Text key={note} color="yellow">
          {note}
        </Text>
      ))}
    </Box>
  );
}

function Footer(props: { model: AppModel; columns: number; selected: SkillRow | null }) {
  let text = FOOTER;
  if (props.model.phase.type === 'filter') text = `filter: ${props.model.query}   enter apply · esc cancel`;
  if (props.model.phase.type === 'confirm-remove' && props.selected) {
    const where = props.selected.scope === 'global' ? 'global' : shortenPath(props.selected.projectPath ?? '');
    text = `Remove ${props.selected.name} from ${where}?  y confirm · n cancel`;
  }
  return (
    <Text color="gray" wrap="truncate">
      {clipEnd(text, props.columns)}
    </Text>
  );
}

function Frame(props: {
  model: AppModel;
  version: string;
  columns: number;
  rows: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <Box flexDirection="column" width={props.columns} height={props.rows}>
      <Text>
        <Text bold color="cyan">
          skilly
        </Text>
        <Text color="gray"> {props.version} </Text>
        <Text>{props.title}</Text>
      </Text>
      <Box flexDirection="column" flexGrow={1}>
        {props.children}
      </Box>
    </Box>
  );
}

function scopeText(model: AppModel): string {
  switch (model.scope.kind) {
    case 'all':
      return 'all';
    case 'global':
      return 'global';
    case 'project':
      return clipStart(shortenPath(model.scope.path), 32);
    default: {
      const unreachable: never = model.scope;
      return unreachable;
    }
  }
}
