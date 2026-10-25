import test from 'node:test';
import assert from 'node:assert/strict';
import { cli, gitRepo, initMemory, write } from './helpers.mjs';

// A small graph in graphify's format: page -> loadInbox -> decryptMessages -> isEncrypted, plus a second
// decryptMessages in another file so the name is ambiguous.
function project() {
  const root = gitRepo();
  initMemory(root);
  const node = (id, label, file, loc) => ({ id, label, file_type: 'code', source_file: file, source_location: loc });
  const nodes = [
    node('page', 'MessagesPage()', 'src/app/messages/page.tsx', 'L10'),
    node('inbox', 'loadInbox()', 'src/lib/inbox.ts', 'L5'),
    node('decrypt', 'decryptMessages()', 'src/lib/messaging/api.ts', 'L47'),
    node('enc', 'isEncrypted()', 'src/lib/messaging/api.ts', 'L90'),
    node('decrypt2', 'decryptMessages()', 'src/legacy/crypto.ts', 'L3'),
    node('apifile', 'api.ts', 'src/lib/messaging/api.ts', 'L1'),
  ];
  const link = (source, target, relation, file, loc) => ({ source, target, relation, source_file: file, source_location: loc });
  const links = [
    link('page', 'inbox', 'calls', 'src/app/messages/page.tsx', 'L22'),
    link('inbox', 'decrypt', 'calls', 'src/lib/inbox.ts', 'L9'),
    link('decrypt', 'enc', 'calls', 'src/lib/messaging/api.ts', 'L54'),
    link('apifile', 'decrypt', 'contains', 'src/lib/messaging/api.ts', 'L47'),
  ];
  write(root, '.legacies/graph/graph.json', JSON.stringify({ nodes, links }));
  return root;
}
const ask = (root, args) => {
  const res = cli(root, ['graph', ...args], { env: { LEGACIES_GRAPHIFY_BIN: '__none__' } });
  assert.equal(res.status, 0, res.stderr);
  return res.stdout;
};

test('graph explain shows where callers call it and where its callees are defined, without graphify', () => {
  const out = ask(project(), ['explain', 'src/lib/messaging/api.ts::decryptMessages']);
  assert.match(out, /decryptMessages\(\) — src\/lib\/messaging\/api\.ts:L47/);
  assert.match(out, /loadInbox\(\) — src\/lib\/inbox\.ts:L9/);
  assert.match(out, /isEncrypted\(\) — src\/lib\/messaging\/api\.ts:L90/);
});

test('graph explain lists every same-named symbol with its line and explains the best connected one', () => {
  const out = ask(project(), ['explain', 'decryptMessages']);
  assert.match(out, /src\/legacy\/crypto\.ts:L3/);
  assert.match(out, /src\/lib\/messaging\/api\.ts:L47/);
  assert.match(out, /loadInbox\(\)/);
});

test('graph affected walks callers outward from a symbol', () => {
  const out = ask(project(), ['affected', 'isEncrypted']);
  assert.match(out, /decryptMessages\(\)/);
  assert.match(out, /loadInbox\(\)/);
  assert.match(out, /MessagesPage\(\)/);
});

test('graph path connects two symbols through the calls between them', () => {
  const out = ask(project(), ['path', 'MessagesPage', 'isEncrypted']);
  const chain = out.split('\n').slice(1).join('\n'); // the first line names both ends
  const order = ['MessagesPage()', 'loadInbox()', 'decryptMessages()', 'isEncrypted()'].map((label) => chain.indexOf(label));
  assert.ok(order.every((at, i) => at >= 0 && (i === 0 || at > order[i - 1])), out);
});

test('graph answers stay within the output limit on a large graph', () => {
  const root = gitRepo();
  initMemory(root);
  const nodes = [{ id: 'hub', label: 'useHub()', file_type: 'code', source_file: 'src/hub.ts', source_location: 'L1' }];
  const links = [];
  for (let i = 0; i < 500; i += 1) {
    nodes.push({ id: `c${i}`, label: `caller${i}WithAVeryLongDescriptiveName()`, file_type: 'code', source_file: `src/features/area${i}/component${i}.tsx`, source_location: `L${i + 1}` });
    links.push({ source: `c${i}`, target: 'hub', relation: 'calls', source_file: `src/features/area${i}/component${i}.tsx`, source_location: `L${i + 2}` });
  }
  write(root, '.legacies/graph/graph.json', JSON.stringify({ nodes, links }));
  for (const args of [['explain', 'useHub'], ['affected', 'useHub']]) {
    const out = ask(root, args);
    assert.ok(out.length <= 2200, `${args[0]} printed ${out.length} characters`);
  }
});

test('graph explain leaves out TODO and FIXME comments but keeps the reasons written next to the code', () => {
  const root = gitRepo();
  initMemory(root);
  const nodes = [
    { id: 'build', label: 'build()', file_type: 'code', source_file: 'src/build.ts', source_location: 'L5' },
    // graphify keeps the comment marker in the label, as in its graphs of Python projects.
    { id: 'todo', label: '# TODO: drop the legacy flag', file_type: 'rationale', source_file: 'src/build.ts', source_location: 'L3' },
    { id: 'fixme', label: '// FIXME: retry on timeout', file_type: 'rationale', source_file: 'src/build.ts', source_location: 'L2' },
    { id: 'note', label: 'NOTE: keeps the linker order', file_type: 'rationale', source_file: 'src/build.ts', source_location: 'L4' },
  ];
  const links = [
    { source: 'todo', target: 'build', relation: 'rationale_for', source_file: 'src/build.ts', source_location: 'L3' },
    { source: 'fixme', target: 'build', relation: 'rationale_for', source_file: 'src/build.ts', source_location: 'L2' },
    { source: 'note', target: 'build', relation: 'rationale_for', source_file: 'src/build.ts', source_location: 'L4' },
  ];
  write(root, '.legacies/graph/graph.json', JSON.stringify({ nodes, links }));
  const out = ask(root, ['explain', 'build']);
  assert.match(out, /NOTE: keeps the linker order/);
  assert.doesNotMatch(out, /TODO|FIXME/);
});
