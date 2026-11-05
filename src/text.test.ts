import assert from 'node:assert/strict';
import test from 'node:test';
import { stripNpmNoise } from './text.js';

test('npm warn and notice lines are hidden from the scan log', () => {
  const noisy = [
    'npm warn Unknown env config "npm-globalconfig". This will stop working in the next major version of npm.',
    'npm warn Unknown env config "verify-deps-before-run".',
    'npm notice New major version of npm available!',
    '↑ alpha has an update',
    '[{"name":"keep-me"}]',
  ].join('\n');
  const cleaned = stripNpmNoise(noisy);
  assert.equal(cleaned.includes('npm warn'), false);
  assert.equal(cleaned.includes('npm notice'), false);
  assert.match(cleaned, /↑ alpha has an update/);
  assert.match(cleaned, /keep-me/);
});
