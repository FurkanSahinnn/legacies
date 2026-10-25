// A stand-in for the `claude` CLI: plugin and marketplace state lives in a JSON file and every call is logged.
import fs from 'node:fs';

const stateFile = process.env.FAKE_CLAUDE_STATE;
// Calls run in parallel (packflow lists plugins and marketplaces at once). A lock file keeps each
// read-modify-write of the shared state whole, so no call reads half a file or loses another's record.
const lockFile = `${stateFile}.lock`;
const giveUpAt = Date.now() + 10000;
let lock;
for (;;) {
  try {
    lock = fs.openSync(lockFile, 'wx');
    break;
  } catch (err) {
    if (err.code !== 'EEXIST' || Date.now() > giveUpAt) throw err;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
  }
}
process.on('exit', () => {
  fs.closeSync(lock);
  fs.rmSync(lockFile, { force: true });
});
const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
const args = process.argv.slice(2);
state.calls.push(args.join(' '));
const opt = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1];
};
const [a0, a1, a2, a3] = args;
let output = '';

// FAKE_CLAUDE_FAIL makes every call whose argument line contains it fail, as a broken install would.
if (process.env.FAKE_CLAUDE_FAIL && args.join(' ').includes(process.env.FAKE_CLAUDE_FAIL)) {
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
  process.stderr.write(`fake claude: failing ${args.join(' ')} on purpose`);
  process.exit(1);
}

if (a0 === '--version') output = '2.1.308 (Claude Code)';
// An interactive session started by `legacies open`: only the call itself is recorded.
else if (a0 === undefined || a0 === '--add-dir') output = '';
else if (a0 === 'plugin' && a1 === 'list') output = JSON.stringify(state.plugins);
else if (a0 === 'plugin' && a1 === 'marketplace' && a2 === 'list') output = JSON.stringify(state.marketplaces);
else if (a0 === 'plugin' && a1 === 'marketplace' && a2 === 'add') {
  let name = 'legacies';
  try {
    name = JSON.parse(fs.readFileSync(`${a3}/.claude-plugin/marketplace.json`, 'utf8')).name || name;
  } catch {
    // A folder without a readable marketplace.json keeps the default name.
  }
  state.marketplaces.push({ name, source: 'directory', path: a3, installLocation: a3 });
} else if (a0 === 'plugin' && a1 === 'marketplace' && a2 === 'update' && !state.marketplaces.some((m) => m.name === a3)) {
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
  process.stderr.write(`fake claude: marketplace ${a3} not found`);
  process.exit(1);
} else if (a0 === 'plugin' && a1 === 'marketplace' && a2 === 'update') {
  // Re-reading a known marketplace changes nothing in the fake state.
} else if (a0 === 'plugin' && a1 === 'marketplace' && (a2 === 'remove' || a2 === 'rm')) {
  state.marketplaces = state.marketplaces.filter((m) => m.name !== a3);
} else if (a0 === 'plugin' && a1 === 'install') {
  const scope = opt('--scope') || 'user';
  const local = scope !== 'user';
  state.plugins.push({ id: a2, scope, enabled: !local, projectEnabled: local, installPath: 'cache', ...(local ? { projectPath: process.cwd() } : {}) });
} else if (a0 === 'plugin' && (a1 === 'uninstall' || a1 === 'remove')) {
  const scope = opt('--scope') || 'user';
  state.plugins = state.plugins.filter((p) => !(p.id === a2 && p.scope === scope));
} else if (a0 === 'plugin' && (a1 === 'enable' || a1 === 'disable')) {
  // Like the real CLI: a local or project setting shows up as projectEnabled, a user setting as enabled.
  const scope = opt('--scope') || 'user';
  for (const p of state.plugins) {
    if (p.id !== a2) continue;
    if (scope === 'user') p.enabled = a1 === 'enable';
    else p.projectEnabled = a1 === 'enable';
  }
} else {
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
  process.stderr.write(`fake claude: unknown command ${args.join(' ')}`);
  process.exit(1);
}

fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
process.stdout.write(output);
