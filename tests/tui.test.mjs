import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkboxKey } from '../scripts/lib/tui.mjs';

const DRIVER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'drive-list.mjs');
const ENTER = { name: 'return' };
// Three options; the confirm row sits under them at index 3.
const list = (chosen = [], index = 0) => ({ index, values: ['rules', 'launcher', 'codex'], chosen: new Set(chosen), ask: false });

test('Enter turns the option under the cursor on, and pressed again turns it off', () => {
  const on = checkboxKey(list(), '', ENTER);
  assert.deepEqual([...on.chosen], ['rules']);
  const off = checkboxKey(on, '', ENTER);
  assert.deepEqual([...off.chosen], []);
});

test('Enter on the confirm row under the options asks before finishing and keeps the choices', () => {
  const next = checkboxKey(list(['rules'], 3), '', ENTER);
  assert.equal(next.ask, true);
  assert.deepEqual([...next.chosen], ['rules']);
});

test('up on the first option jumps to the confirm row', () => {
  assert.equal(checkboxKey(list(), '', { name: 'up' }).index, 3);
});

// A starts on. Turn A off and B on, answer "hayır", turn A back on, then answer "evet".
test('answering no to "Emin misiniz?" keeps the choices and the list open for more changes', () => {
  const keys = [['\r', 'return'], ['', 'down'], ['\r', 'return'], ['', 'up'], ['', 'up'], ['\r', 'return'], ['h', 'h'], ['', 'down'], ['\r', 'return'], ['', 'up'], ['\r', 'return'], ['e', 'e']];
  const res = spawnSync(process.execPath, [DRIVER], { encoding: 'utf8', env: { ...process.env, KEYS: JSON.stringify(keys) }, timeout: 10000 });
  assert.equal(res.status, 0, res.stderr);
  const { picked, asked } = JSON.parse(res.stdout);
  assert.deepEqual(picked.sort(), ['a', 'b']);
  assert.equal(asked, 2);
});

test('Space still turns an option on and off', () => {
  assert.deepEqual([...checkboxKey(list(), ' ', { name: 'space' }).chosen], ['rules']);
});
