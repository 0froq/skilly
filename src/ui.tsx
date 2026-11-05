import { Box, Text, useInput } from 'ink';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { readSkillDocument, wrapText } from './blurb.js';
import { groupSkills, listWindow, statusMark } from './groups.js';
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
import { clipEnd, clipStart, shortenPath, stripNpmNoise, tailLines } from './text.js';

export function Screen(props: { model: AppModel; version: string; columns: number; rows: number }) {
  const phase = props.model.phase.type;
  switch (phase) {
    case 'help':
      return <HelpScreen {...props} />;
    case 'config':
      return <ConfigScreen {...props} />;
    case 'add':
      return <AddScreen {...props} />;
    case 'loading':
      return <ScanScreen {...props} />;
    case 'busy':
      return props.model.scan ? <ScanScreen {...props} /> : <LogScreen {...props} />;
    case 'log':
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

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function useSpinner(): string {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((current) => (current + 1) % SPINNER.length);
    }, 80);
    return () => {
      clearInterval(timer);
    };
  }, []);
  return SPINNER[frame] ?? '⠋';
}

function ScanScreen(props: { model: AppModel; version: string; columns: number; rows: number }) {
  const spin = useSpinner();
  const scan = props.model.scan;
  const current = scan?.current ? shortenPath(scan.current) : '…';
  const count = scan && scan.total > 0 ? `${scan.completed} / ${scan.total}` : null;
  return (
    <Frame {...props} title="Scanning">
      <Text color="cyan">
        {spin} {scan?.label ?? 'Scanning skills'}
      </Text>
      {count ? <Text> {count}</Text> : null}
      <Text wrap="truncate"> {clipEnd(current, Math.max(8, props.columns - 4))}</Text>
      <Text color="gray"> {scan?.found ?? 0} skills</Text>
      <Text> </Text>
      <Text color="gray">ctrl+c aborts</Text>
    </Frame>
  );
}

function LogScreen(props: { model: AppModel; version: string; columns: number; rows: number }) {
  const lines = tailLines(stripNpmNoise(props.model.logText), Math.max(4, props.rows - 5));
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
  const listWidth = stacked ? columns : Math.max(28, Math.min(42, Math.floor(columns * 0.36)));
  const listHeight = stacked ? Math.max(4, Math.floor(bodyHeight * 0.5)) : bodyHeight;
  const visible = visibleSkills(model);
  const selected = selectedSkill(model);
  const inner = Math.max(1, listHeight - 2);
  const entries = groupSkills(visible);
  const windowRows = listWindow(entries, model.selected, inner);
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
          {windowRows.map((entry) =>
            entry.kind === 'header' ? (
              <Text key={entry.id} bold color="cyan" wrap="truncate">
                {clipEnd(` ${entry.label}`, Math.max(10, (stacked ? columns : listWidth) - 2))}
              </Text>
            ) : (
              <SkillLine
                key={entry.skill.id}
                skill={entry.skill}
                selected={entry.skillIndex === model.selected}
                width={Math.max(10, (stacked ? columns : listWidth) - 2)}
                outdated={model.updates[entry.skill.id] === 'outdated'}
              />
            ),
          )}
        </Box>
        <Box
          flexGrow={1}
          height={stacked ? undefined : bodyHeight}
          flexDirection="column"
          borderStyle="single"
          borderColor="gray"
          paddingX={1}
        >
          {selected ? (
            <Detail
              skill={selected}
              model={model}
              rows={Math.max(8, (stacked ? Math.max(6, bodyHeight - listHeight) : listHeight) - 2)}
              columns={Math.max(24, (stacked ? columns : columns - listWidth) - 4)}
              scrollKeys={model.phase.type !== 'filter'}
            />
          ) : (
            <EmptyDetail model={model} />
          )}
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
      <Text color={/error|not removed|still installed|could not verify/i.test(props.model.notice) ? 'red' : 'gray'} wrap="truncate">
        {clipEnd(props.model.notice, props.columns)}
      </Text>
    </Box>
  );
}

function SkillLine(props: { skill: SkillRow; selected: boolean; width: number; outdated: boolean }) {
  const mark = statusMark(props.skill.status, props.outdated);
  const name = clipEnd(props.skill.name, Math.max(1, props.width - 2));
  const line = `${mark} ${name}`.padEnd(props.width).slice(0, props.width);
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

function Detail(props: { skill: SkillRow; model: AppModel; rows: number; columns: number; scrollKeys: boolean }) {
  const hint = layoutHint(props.skill.layout);
  const valueWidth = Math.max(8, props.columns - 10);
  const fields: Array<[string, string]> = [
    ['scope', props.skill.scope],
    ['path', props.skill.path ? shortenPath(props.skill.path) : '—'],
    ['layout', layoutLabel(props.skill.layout)],
    ['source', props.skill.source ?? '—'],
    ['agents', props.skill.agents.length > 0 ? props.skill.agents.join(', ') : '—'],
    ['status', `${props.skill.status} · ${updateLabel(props.model.updates[props.skill.id])}`],
  ];
  const [body, setBody] = useState<string | null>(null);
  const [readState, setReadState] = useState<'loading' | 'missing' | 'ready'>('loading');
  const [offset, setOffset] = useState(0);
  const chrome = 1 + (props.skill.blurb ? 1 : 0) + fields.length + (hint ? 1 : 0) + 2;
  const bodyRows = Math.max(3, props.rows - chrome);
  const wrapped = body ? wrapText(body, props.columns) : [];
  const maxOffset = Math.max(0, wrapped.length - bodyRows);
  const shownOffset = Math.min(offset, maxOffset);
  const linesRef = useRef(wrapped);
  const rowsRef = useRef(bodyRows);
  linesRef.current = wrapped;
  rowsRef.current = bodyRows;

  useEffect(() => {
    let cancelled = false;
    setOffset(0);
    setBody(null);
    setReadState('loading');
    void readSkillDocument(props.skill.path).then((doc) => {
      if (cancelled) return;
      if (!doc) {
        setReadState('missing');
        setBody(null);
        return;
      }
      setReadState('ready');
      setBody(doc.body);
    });
    return () => {
      cancelled = true;
    };
  }, [props.skill.id, props.skill.path]);

  useInput(
    (input) => {
      const max = Math.max(0, linesRef.current.length - rowsRef.current);
      const page = Math.max(1, rowsRef.current - 1);
      if (input === ']') setOffset((current) => Math.min(max, current + 1));
      if (input === '[') setOffset((current) => Math.max(0, current - 1));
      if (input === '}') setOffset((current) => Math.min(max, current + page));
      if (input === '{') setOffset((current) => Math.max(0, current - page));
    },
    { isActive: props.scrollKeys },
  );

  const view = wrapped.slice(shownOffset, shownOffset + bodyRows);
  const bodyLabel =
    readState === 'loading'
      ? 'Reading SKILL.md…'
      : readState === 'missing'
        ? 'SKILL.md not on disk'
        : body
          ? 'SKILL.md'
          : 'No body after frontmatter';

  return (
    <Box flexDirection="column" height={props.rows} overflow="hidden">
      <Text bold wrap="truncate">
        {clipEnd(props.skill.name, props.columns)}
      </Text>
      {props.skill.blurb ? <Text color="gray" wrap="truncate">{clipEnd(props.skill.blurb, props.columns)}</Text> : null}
      {fields.map(([label, value]) => (
        <Text key={label} wrap="truncate">
          <Text color="gray">{label.padEnd(8)}</Text>
          {clipEnd(value, valueWidth)}
        </Text>
      ))}
      {hint ? <Text color="yellow" wrap="truncate">{clipEnd(hint, props.columns)}</Text> : null}
      <Text color="gray"> </Text>
      <Text color="cyan" wrap="truncate">
        {bodyLabel}
        {wrapped.length > bodyRows ? `  ${shownOffset + 1}–${Math.min(wrapped.length, shownOffset + bodyRows)}/${wrapped.length}  [ ]` : ''}
      </Text>
      {view.map((line, index) => (
        <Text key={`${shownOffset + index}:${line}`} wrap="truncate">
          {line.length > 0 ? line : ' '}
        </Text>
      ))}
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
    const symlinkInstall = props.selected.layout.kind === 'symlink' && props.selected.layout.target;
    text = symlinkInstall
      ? `Unlink ${props.selected.name} in ${where}? Only that install link is removed.  y / n`
      : `Remove ${props.selected.name} from ${where}?  y confirm · n cancel`;
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
