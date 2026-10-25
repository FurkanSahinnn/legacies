#!/usr/bin/env node
// Drives the multi-agent settings screen with fake key presses, as if typed in a terminal, then prints
// the settings it returned. KEYS: JSON list of [text, keyName] pairs.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

process.stdin.isTTY = true;
process.stdout.isTTY = true;
process.stdin.setRawMode = function setRawMode(mode) {
  this.isRaw = mode;
  return this;
};
const print = process.stdout.write.bind(process.stdout);
process.stdout.write = () => true;

const lib = (name) => import(pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'lib', name)).href);
const { chooseSettings } = await lib('multiagentflow.mjs');
const initial = { on: false, profile: 'dengeli', roles: {}, agents: {}, maxParallel: 4, escalate: true };
const chosen = chooseSettings({ pluginRoot: '.', root: null, initial });
for (const [text, name] of JSON.parse(process.env.KEYS)) {
  // Each key arrives on a later turn of the event loop, like typing.
  await new Promise((resolve) => setImmediate(resolve));
  process.stdin.emit('keypress', text, { name });
}
print(JSON.stringify(await chosen));
process.exit(0);
