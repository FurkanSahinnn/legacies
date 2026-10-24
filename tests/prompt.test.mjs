import test from 'node:test';
import assert from 'node:assert/strict';
import { identifierCandidates, matchPaths, normLabel } from '../scripts/lib/codeindex.mjs';
import { cli, commit, gitRepo, hook, initMemory, write } from './helpers.mjs';

const context = (res) => res.json && res.json.hookSpecificOutput && res.json.hookSpecificOutput.additionalContext;

function projectWithMemory() {
  const root = gitRepo();
  write(root, 'src/app/api/webhook/route.ts', 'export async function POST() {}\n');
  write(root, 'src/lib/supabase/server.ts', 'export function createServerClient() {}\n');
  write(root, 'src/components/ProfileCard.tsx', 'export function ProfileCard() {}\n');
  commit(root, 'app files');
  initMemory(root);
  cli(root, ['add', '--type', 'decision', '--title', 'Shopier webhook imzası HMAC ile doğrulanır', '--paths', 'src/app/api/webhook/**', '--summary', 'İmzasız bildirim reddedilir'], { input: 'Sahte ödeme bildirimlerine karşı.\n' });
  cli(root, ['add', '--type', 'gotcha', '--title', 'Profil kartı sunucu tarafında render edilmez', '--paths', 'src/components/ProfileCard.tsx', '--text', 'useState kullanıyor.']);
  return root;
}

test('identifierCandidates picks code-looking words and backticked terms', () => {
  const ids = identifierCandidates('createServerClient neden null? `rate_limit` ve supabase.auth.getUser bak, Shopier de');
  for (const expected of ['createServerClient', 'rate_limit', 'supabase.auth.getUser', 'getUser', 'Shopier']) {
    assert.ok(ids.includes(expected), `${expected} missing from ${ids}`);
  }
  assert.ok(!ids.includes('neden'));
  assert.equal(normLabel('.__init__()'), '__init__');
  assert.equal(normLabel('createServerClient()'), 'createserverclient');
});

test('matchPaths needs a specific term, not generic folder names', () => {
  const files = ['src/app/api/webhook/route.ts', 'src/app/page.tsx', 'src/components/ProfileCard.tsx', 'src/lib/utils.ts'];
  assert.deepEqual(matchPaths(files, 'webhook doğrulaması nerede'), ['src/app/api/webhook/route.ts']);
  assert.equal(matchPaths(files, 'profile card neden yavaş')[0], 'src/components/ProfileCard.tsx');
  assert.deepEqual(matchPaths(files, 'src app page'), []);
});

test('user-prompt-submit injects the matching note and code location, and abstains otherwise', () => {
  const root = projectWithMemory();
  const hit = context(hook(root, 'user-prompt-submit', { prompt: 'Webhook imzasını nerede doğruluyorduk, HMAC mi kullanıyoruz?' }));
  assert.match(hit, /Shopier webhook imzası HMAC ile doğrulanır/);
  assert.match(hit, /İmzasız bildirim reddedilir/);
  assert.match(hit, /src\/app\/api\/webhook\/route\.ts/);
  assert.doesNotMatch(hit, /Profil kartı/);

  assert.equal(hook(root, 'user-prompt-submit', { prompt: 'Kubernetes cluster autoscaling ayarı' }).json, null);
  assert.equal(hook(root, 'user-prompt-submit', { prompt: '/legacies:handoff' }).json, null);
  assert.equal(hook(root, 'user-prompt-submit', { prompt: 'evet' }).json, null);
});

test('a single specific term that names the note is enough, a generic one is not', () => {
  const root = projectWithMemory();
  const mixed = context(hook(root, 'user-prompt-submit', { prompt: 'verifySignature neden false dönüyor, webhook 401 veriyor' }));
  assert.match(mixed, /Shopier webhook imzası HMAC ile doğrulanır/);
  assert.equal(hook(root, 'user-prompt-submit', { prompt: 'neden false dönüyor bilmiyorum' }).json, null);
});

test('user-prompt-submit does not repeat itself until the context restarts', () => {
  const root = projectWithMemory();
  const prompt = 'Profil kartı neden sunucuda render edilmiyor?';
  assert.match(context(hook(root, 'user-prompt-submit', { prompt })), /Profil kartı sunucu tarafında render edilmez/);
  assert.equal(hook(root, 'user-prompt-submit', { prompt }).json, null);
  hook(root, 'session-start', { source: 'compact' });
  assert.match(context(hook(root, 'user-prompt-submit', { prompt })), /Profil kartı/);
});

test('user-prompt-submit maps identifiers to file:line through the code graph', () => {
  const root = projectWithMemory();
  write(
    root,
    '.legacies/graph/graph.json',
    JSON.stringify({
      directed: false,
      multigraph: false,
      graph: {},
      built_at_commit: 'abc1234',
      nodes: [
        { id: 'server', label: 'server.ts', file_type: 'code', source_file: 'src/lib/supabase/server.ts', source_location: 'L1' },
        { id: 'server_create', label: 'createServerClient()', file_type: 'code', source_file: 'src/lib/supabase/server.ts', source_location: 'L3' },
        { id: 'doc', label: 'createServerClient()', file_type: 'document', source_file: 'README.md', source_location: 'L9' },
      ],
      links: [],
    }),
  );
  const text = context(hook(root, 'user-prompt-submit', { prompt: 'createServerClient neden null dönüyor?' }));
  assert.match(text, /createServerClient\(\) — src\/lib\/supabase\/server\.ts:L3/);
  assert.doesNotMatch(text, /README\.md/);

  const map = cli(root, ['map', 'createServerClient']);
  assert.equal(map.status, 0, map.stderr);
  assert.match(map.stdout, /createServerClient\(\) — src\/lib\/supabase\/server\.ts:L3/);
  const status = cli(root, ['graph', 'status']);
  assert.match(status.stdout, /Kod grafı: 3 düğüm/);
});

test('symbols named like Object.prototype members are indexed and looked up safely', () => {
  const root = projectWithMemory();
  write(
    root,
    '.legacies/graph/graph.json',
    JSON.stringify({
      nodes: [
        { id: 'a', label: '.constructor()', file_type: 'code', source_file: 'src/lib/cache.ts', source_location: 'L4' },
        { id: 'b', label: 'toString()', file_type: 'code', source_file: 'src/lib/money.ts', source_location: 'L9' },
        { id: 'c', label: '__proto__', file_type: 'code', source_file: 'src/x.ts', source_location: 'L1' },
      ],
      links: [],
    }),
  );
  const status = cli(root, ['graph', 'status']);
  assert.equal(status.status, 0, status.stderr);
  assert.match(cli(root, ['map', 'constructor']).stdout, /src\/lib\/cache\.ts:L4/);
  assert.match(cli(root, ['map', 'toString']).stdout, /src\/lib\/money\.ts:L9/);
  const cached = cli(root, ['map', 'hasOwnProperty valueOf']);
  assert.equal(cached.status, 0, 'a name missing from the cached index must not resolve to Object.prototype');
});

function projectWithNamedSymbols() {
  const root = projectWithMemory();
  write(
    root,
    '.legacies/graph/graph.json',
    JSON.stringify({
      nodes: [
        { id: 'a', label: 'sendMessage()', file_type: 'code', source_file: 'src/lib/messaging/api.ts', source_location: 'L137' },
        { id: 'b', label: 'hasVerifiedMfaFactor()', file_type: 'code', source_file: 'src/lib/auth/mfa-gate.ts', source_location: 'L128' },
        { id: 'c', label: 'sendEmail()', file_type: 'code', source_file: 'src/lib/mail.ts', source_location: 'L3' },
        { id: 'd', label: 'MessageList()', file_type: 'code', source_file: 'src/components/MessageList.tsx', source_location: 'L5' },
      ],
      links: [],
    }),
  );
  return root;
}

test('map finds a symbol from the words inside its name, not from one shared word', () => {
  const root = projectWithNamedSymbols();
  const res = cli(root, ['map', 'send message']);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /sendMessage\(\) — src\/lib\/messaging\/api\.ts:L137/);
  assert.doesNotMatch(res.stdout, /sendEmail|MessageList/);
});

test('user-prompt-submit finds a symbol named by plain words in the message', () => {
  const root = projectWithNamedSymbols();
  const text = context(hook(root, 'user-prompt-submit', { prompt: 'send message akışı nerede?' }));
  assert.match(text, /sendMessage\(\) — src\/lib\/messaging\/api\.ts:L137/);
});

test('a Turkish question reaches English-named code through the translation files', () => {
  const root = gitRepo();
  write(root, 'src/messages/tr.json', JSON.stringify({ chest: { open: 'Sandığı aç', title: 'Günlük sandık', empty: 'Sandık boş' } }));
  write(root, 'src/messages/en.json', JSON.stringify({ chest: { open: 'Open chest', title: 'Daily chest', empty: 'Chest is empty' } }));
  write(root, 'src/lib/chest/rarity.ts', 'export const frames = [];\n');
  write(root, 'src/lib/deck/source.ts', 'export const cards = [];\n');
  commit(root, 'app files');
  initMemory(root);
  const text = context(hook(root, 'user-prompt-submit', { prompt: 'sandıktan çıkan ifadelerin çerçevesi nerede ayarlanıyor?' }));
  assert.match(text, /src\/lib\/chest\/rarity\.ts/);
  assert.doesNotMatch(text, /src\/lib\/deck/);
});

test('map finds a function hidden behind a same-named type by reading its definition', () => {
  const root = projectWithMemory();
  write(root, 'src/lib/revert.ts', 'export type FieldRevertConfig = { table: string };\n\n\n\nexport function fieldRevertConfig(source: string): FieldRevertConfig {\n  return { table: source };\n}\n');
  // graphify ids ignore case, so the type and the function collapse into one node that points at the type.
  write(root, '.legacies/graph/graph.json', JSON.stringify({
    nodes: [{ id: 'src_lib_revert_fieldrevertconfig', label: 'FieldRevertConfig', file_type: 'code', source_file: 'src/lib/revert.ts', source_location: 'L1' }],
    links: [],
  }));
  const res = cli(root, ['map', 'fieldRevertConfig']);
  assert.equal(res.status, 0, res.stderr);
  const lines = res.stdout.split('\n').filter((l) => l.startsWith('- '));
  assert.match(lines[0], /fieldRevertConfig — src\/lib\/revert\.ts:L5/);
});

test('prompt context can be turned off', () => {
  const root = projectWithMemory();
  const res = hook(root, 'user-prompt-submit', { prompt: 'Webhook imzası HMAC doğrulama' }, { env: { LEGACIES_PROMPT_CONTEXT: 'off' } });
  assert.equal(res.json, null);
});
