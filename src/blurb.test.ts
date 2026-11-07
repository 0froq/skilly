import assert from 'node:assert/strict';
import test from 'node:test';
import { splitSkillMarkdown, wrapText } from './blurb.js';

test('SKILL.md body is the markdown after frontmatter', () => {
  const doc = splitSkillMarkdown(
    '---\nname: grill-me\ndescription: "Relentless interview"\n---\n# grill-me\n\nAsk why.\n',
  );
  assert.equal(doc.description, 'Relentless interview');
  assert.equal(doc.body, '# grill-me\n\nAsk why.');
});

test('a skill file without frontmatter is all body', () => {
  const doc = splitSkillMarkdown('# notes\n\nDo the thing.\n');
  assert.equal(doc.description, null);
  assert.match(doc.body ?? '', /Do the thing/);
});

test('frontmatter with no body stays empty', () => {
  const doc = splitSkillMarkdown('---\ndescription: only meta\n---\n');
  assert.equal(doc.description, 'only meta');
  assert.equal(doc.body, null);
});

test('body lines wrap inside the detail width', () => {
  assert.deepEqual(wrapText('one two three four', 8), ['one two', 'three', 'four']);
});
