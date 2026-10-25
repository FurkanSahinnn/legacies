import test from 'node:test';
import assert from 'node:assert/strict';
import { cli, commit, gitRepo, hook, initMemory, write } from './helpers.mjs';

const context = (res) => res.json && res.json.hookSpecificOutput && res.json.hookSpecificOutput.additionalContext;

// Two documented definitions per file whose names share no word with the questions: only the
// documentation can tell them apart, and the answer is the definition's line, not just its file.
function project() {
  const root = gitRepo();
  write(root, 'app/db/songs_repository.py', [
    'import json',
    '',
    '',
    'def load_cell(record, name):',
    '    """Reads one Soundcharts column back into a dict, or None when it is empty."""',
    '    return json.loads(record[name]) if record[name] else None',
    '',
    '',
    'def apply_phase_a(',
    '    record,',
    '):',
    '    """Creates the song with base metadata when it does not exist yet.',
    '',
    '    Running it twice is idempotent.',
    '    """',
    '    return db.execute(UPSERT, record)',
    '',
  ].join('\n'));
  write(root, 'src/lib/ledger.ts', [
    '/**',
    ' * Refunds are reconciled nightly against the acquirer settlement report.',
    ' */',
    'export function closeDay(ledger) {',
    '  return ledger;',
    '}',
    '',
    '/** Sends the receipt email once the order is paid. */',
    'export function notifyBuyer(order) {',
    '  return order;',
    '}',
    '',
  ].join('\n'));
  const node = (id, label, file, loc) => ({ id, label, file_type: 'code', source_file: file, source_location: loc });
  const nodes = [
    node('py', 'songs_repository.py', 'app/db/songs_repository.py', 'L1'),
    node('load', 'load_cell()', 'app/db/songs_repository.py', 'L4'),
    node('apply', 'apply_phase_a()', 'app/db/songs_repository.py', 'L9'),
    node('ts', 'ledger.ts', 'src/lib/ledger.ts', 'L1'),
    node('close', 'closeDay()', 'src/lib/ledger.ts', 'L4'),
    node('notify', 'notifyBuyer()', 'src/lib/ledger.ts', 'L9'),
  ];
  write(root, '.legacies/graph/graph.json', JSON.stringify({ nodes, links: [] }));
  commit(root, 'documented code');
  initMemory(root);
  return root;
}

test('map finds a Python function from the words of its docstring and gives its line', () => {
  const res = cli(project(), ['map', 'where do we create the song with its metadata if it does not exist yet']);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /apply_phase_a\(\) — app\/db\/songs_repository\.py:L9/);
  assert.doesNotMatch(res.stdout, /load_cell\(\)/);
});

test('map finds a function from the doc comment written above it and gives its line', () => {
  const res = cli(project(), ['map', 'where are refunds reconciled against the settlement report']);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /closeDay\(\) — src\/lib\/ledger\.ts:L4/);
  assert.doesNotMatch(res.stdout, /notifyBuyer\(\)/);
});

test('the prompt hook points at the documented function, not only its file', () => {
  const root = project();
  const text = context(hook(root, 'user-prompt-submit', { prompt: 'the receipt email goes out before the order is paid' }));
  assert.match(text, /notifyBuyer\(\) — src\/lib\/ledger\.ts:L9/);
});

test('a documentation match that covers little of the question is not offered', () => {
  // Two shared words (send, receipt) out of about ten: chance, not an answer.
  const res = cli(project(), ['map', 'why does the nightly export job retry three times and then send the receipt to the wrong team']);
  assert.equal(res.status, 0, res.stderr);
  assert.doesNotMatch(res.stdout, /notifyBuyer\(\)/);
});

test('a documentation match that covers the question goes first, as graphify ranks its docstring nodes', () => {
  const root = gitRepo();
  write(root, 'src/lib/mailer.ts', 'export function sendReceiptEmail(to) {\n  return to;\n}\n');
  write(root, 'src/lib/orders.ts', '/** Sends the receipt email once the order is paid. */\nexport function notifyBuyer(order) {\n  return order;\n}\n');
  const node = (id, label, file, loc) => ({ id, label, file_type: 'code', source_file: file, source_location: loc });
  const nodes = [node('mail', 'sendReceiptEmail()', 'src/lib/mailer.ts', 'L1'), node('notify', 'notifyBuyer()', 'src/lib/orders.ts', 'L2')];
  write(root, '.legacies/graph/graph.json', JSON.stringify({ nodes, links: [] }));
  commit(root, 'mail');
  initMemory(root);
  const res = cli(root, ['map', 'sends the receipt email once the order is paid']);
  assert.equal(res.status, 0, res.stderr);
  const documented = res.stdout.indexOf('notifyBuyer() — src/lib/orders.ts:L2');
  const named = res.stdout.indexOf('sendReceiptEmail() — src/lib/mailer.ts:L1');
  assert.ok(documented >= 0 && named >= 0 && documented < named, res.stdout);
});
