import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEnvFile } from '../lib/env.js';

test('parses KEY=VALUE lines', () => {
  assert.deepEqual(parseEnvFile('A=1\nB=hello\n'), { A: '1', B: 'hello' });
});

test('ignores comments, blanks and whitespace', () => {
  const out = parseEnvFile('# comment\n\n  A = 1 \n#B=2\n');
  assert.deepEqual(out, { A: '1' });
});

test('strips single and double quotes', () => {
  assert.deepEqual(parseEnvFile('A="quoted value"\nB=\'single\'\n'), {
    A: 'quoted value',
    B: 'single',
  });
});

test('keeps = inside values and ignores malformed lines', () => {
  assert.deepEqual(parseEnvFile('URL=https://x.io/?a=b\nnovalue\n'), {
    URL: 'https://x.io/?a=b',
  });
});
