#!/usr/bin/env node
// Drives the checkbox list with fake key presses, as if typed in a terminal, then prints what the list
// returned and how many times it asked "Emin misiniz?". KEYS: JSON list of [text, keyName] pairs.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

process.stdin.isTTY = true;
process.stdout.isTTY = true;
process.stdin.setRawMode = function setRawMode(mode) {
  this.isRaw = mode;
  return this;
};
const print = process.stdout.write.bind(process.stdout);
let screen = '';
process.stdout.write = (s) => {
  screen += s;
  return true;
};

const tui = await import(pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'lib', 'tui.mjs')).href);
const picked = tui.multiselect('Ek bileşenler', [
  { value: 'a', label: 'A', checked: true },
  { value: 'b', label: 'B' },
  { value: 'c', label: 'C' },
]);
for (const [text, name] of JSON.parse(process.env.KEYS)) {
  // Each key arrives on a later turn of the event loop, like typing.
  await new Promise((resolve) => setImmediate(resolve));
  process.stdin.emit('keypress', text, { name });
}
const result = await picked;
print(JSON.stringify({ picked: result, asked: screen.split('Emin misiniz?').length - 1 }));
process.exit(0);
