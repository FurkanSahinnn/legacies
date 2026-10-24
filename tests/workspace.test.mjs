import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cli, gitRepo, hook, initMemory, run, tempDir, write } from './helpers.mjs';

const FAKE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-claude.mjs');
const context = (res) => res.json?.hookSpecificOutput?.additionalContext || '';

// Two projects with memory, one Claude config folder and one plugin data folder shared by every call,
// so a session's hooks see each other's records.
function twoProjects() {
  const a = gitRepo();
  const b = gitRepo();
  initMemory(a);
  initMemory(b);
  const config = tempDir('legacies-config-');
  const pluginData = tempDir('legacies-data-');
  const env = { CLAUDE_CONFIG_DIR: config };
  return {
    a,
    b,
    config,
    run: (cwd, args, extra = {}) => cli(cwd, args, { env: { ...env, ...extra }, pluginData }),
    hook: (cwd, event, payload = {}, extra = {}) => hook(cwd, event, payload, { env: { ...env, ...extra }, pluginData }),
  };
}

const ledger = (root) => {
  const file = path.join(root, '.legacies', 'state', 'sessions', 'test-session-0001.jsonl');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
};

test('workspace add keeps a shared memory outside both repositories', () => {
  const p = twoProjects();
  const res = p.run(p.a, ['workspace', 'add', 'hobi', p.a, p.b]);
  assert.equal(res.status, 0, res.stderr);
  const file = path.join(p.config, 'legacies-workspaces', 'hobi', 'workspace.json');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).members.map((m) => m.path), [p.a, p.b].map((d) => path.resolve(d)));
  assert.equal(run(p.a, 'git', ['status', '--porcelain']), '');
  assert.equal(run(p.b, 'git', ['status', '--porcelain']), '');
});

test('add --workspace writes a shared note that search --workspace finds', () => {
  const p = twoProjects();
  p.run(p.a, ['workspace', 'add', 'hobi', p.a, p.b]);
  const added = p.run(p.a, ['add', '--workspace', 'hobi', '--type', 'decision', '--title', 'Mobil ve web aynı oturum token formatını kullanır', '--text', 'JWT, 15 dk.']);
  assert.equal(added.status, 0, added.stderr);
  const found = p.run(p.b, ['search', 'oturum token formatı', '--workspace', 'hobi']);
  assert.match(found.stdout, /\[çalışma alanı hobi · decision\] Mobil ve web aynı oturum token formatını kullanır/);
});

test('search --all covers the projects the session added, with their names', () => {
  const p = twoProjects();
  p.run(p.b, ['add', '--type', 'gotcha', '--title', 'Webhook imzası ham gövdeyle doğrulanır', '--text', 'x']);
  p.hook(p.a, 'directory-added', { directory: p.b, source: 'slash_command' });
  const res = p.run(p.a, ['search', 'webhook imzası', '--all']);
  assert.match(res.stdout, new RegExp(`\\[${path.basename(p.b)} · gotcha\\] Webhook imzası ham gövdeyle doğrulanır`));
});

test('workspace delete asks for --yes, because it removes the shared notes', () => {
  const p = twoProjects();
  p.run(p.a, ['workspace', 'add', 'hobi', p.a, p.b]);
  const refused = p.run(p.a, ['workspace', 'delete', 'hobi']);
  assert.equal(refused.status, 2);
  assert.ok(fs.existsSync(path.join(p.config, 'legacies-workspaces', 'hobi')));
  assert.equal(p.run(p.a, ['workspace', 'delete', 'hobi', '--yes']).status, 0);
  assert.equal(fs.existsSync(path.join(p.config, 'legacies-workspaces', 'hobi')), false);
});

test('directory-added briefs Claude about the added project and how to search it', () => {
  const p = twoProjects();
  const res = p.hook(p.a, 'directory-added', { directory: p.b, source: 'slash_command' });
  assert.match(res.json.systemMessage, new RegExp(`başka bir proje eklendi \\(/add-dir\\): ${path.basename(p.b)}`));
  assert.match(res.json.systemMessage, /--project/);
});

test('post-tool-use records an edit in another project in that project\'s own ledger', () => {
  const p = twoProjects();
  p.hook(p.a, 'post-tool-use', { tool_name: 'Write', tool_input: { file_path: path.join(p.b, 'src', 'api.ts') } });
  assert.deepEqual(ledger(p.b).filter((e) => e.kind === 'edit').map((e) => e.file), ['src/api.ts']);
  assert.equal(ledger(p.a).some((e) => e.kind === 'edit'), false);
});

test('post-tool-use lists an edit in a folder without memory as outside this project', () => {
  const p = twoProjects();
  const plain = tempDir('legacies-plain-');
  p.hook(p.a, 'post-tool-use', { tool_name: 'Edit', tool_input: { file_path: path.join(plain, 'notes.txt') } });
  assert.deepEqual(ledger(p.a).filter((e) => e.kind === 'edit-outside').map((e) => path.basename(e.file)), ['notes.txt']);
});

test('stop asks for a card in the other project the session edited, with the command for it', () => {
  const p = twoProjects();
  for (const f of ['a.ts', 'b.ts', 'c.ts']) p.hook(p.a, 'post-tool-use', { tool_name: 'Write', tool_input: { file_path: path.join(p.b, 'src', f) } });
  const res = p.hook(p.a, 'stop', {});
  assert.equal(res.json.decision, 'block');
  assert.match(res.json.reason, /3 dosya → `legacies handoff --project/);
});

test('handoff --project writes the card into the other project and satisfies its reminder', () => {
  const p = twoProjects();
  for (const f of ['a.ts', 'b.ts', 'c.ts']) p.hook(p.a, 'post-tool-use', { tool_name: 'Write', tool_input: { file_path: path.join(p.b, 'src', f) } });
  const card = p.run(p.a, ['handoff', '--project', p.b, '--text', '## Sonraki adım\nmobil girişi bağla']);
  assert.equal(card.status, 0, card.stderr);
  assert.equal(fs.readdirSync(path.join(p.b, '.legacies', 'sessions')).filter((f) => f.endsWith('.md')).length, 1);
  assert.equal(p.hook(p.a, 'stop', {}).json, null);
});

test('session-end leaves a mechanical card in another project the session edited', () => {
  const p = twoProjects();
  p.hook(p.a, 'post-tool-use', { tool_name: 'Write', tool_input: { file_path: path.join(p.b, 'src', 'api.ts') } });
  p.hook(p.a, 'session-end', {});
  const cards = fs.readdirSync(path.join(p.b, '.legacies', 'sessions')).filter((f) => f.endsWith('.md'));
  assert.equal(cards.length, 1);
  assert.match(fs.readFileSync(path.join(p.b, '.legacies', 'sessions', cards[0]), 'utf8'), /src\/api\.ts/);
});

test('user-prompt-submit brings matching notes from the session\'s other projects, labelled', () => {
  const p = twoProjects();
  p.run(p.b, ['add', '--type', 'gotcha', '--title', 'Webhook imzası ham gövdeyle doğrulanır', '--paths', 'src/payments/**', '--text', 'JSON parse etmeden önce doğrula.']);
  p.hook(p.a, 'directory-added', { directory: p.b, source: 'slash_command' });
  const res = p.hook(p.a, 'user-prompt-submit', { prompt: 'webhook imzası neden tutmuyor' });
  assert.match(context(res), new RegExp(`\\[${path.basename(p.b)} · gotcha\\] Webhook imzası ham gövdeyle doğrulanır`));
});

test('session-start in a workspace opened with legacies open briefs the other members', () => {
  const p = twoProjects();
  p.run(p.a, ['workspace', 'add', 'hobi', p.a, p.b]);
  const res = p.hook(p.a, 'session-start', { source: 'startup' }, { LEGACIES_WORKSPACE: 'hobi' });
  assert.match(context(res), /"hobi" çalışma alanında/);
  assert.match(context(res), new RegExp(`"hobi" çalışma alanıyla açıldı: ${path.basename(p.b)}`));
  assert.ok(context(res).length < 10000);
});

test('user-prompt-submit gives a project\'s startup context once after the session moved into it', () => {
  const p = twoProjects();
  p.hook(p.a, 'session-start', { source: 'startup' });
  const first = p.hook(p.b, 'user-prompt-submit', { prompt: 'şimdi mobil tarafta giriş ekranına bakalım' });
  const second = p.hook(p.b, 'user-prompt-submit', { prompt: 'şimdi mobil tarafta giriş ekranına bakalım' });
  assert.match(context(first), /klasöründe başladı, şimdi bu projede/);
  assert.doesNotMatch(context(second), /klasöründe başladı/);
});

test('open starts Claude Code in one member with the other members added', () => {
  const p = twoProjects();
  p.run(p.a, ['workspace', 'add', 'hobi', p.a, p.b]);
  const state = path.join(tempDir(), 'fake-claude.json');
  fs.writeFileSync(state, JSON.stringify({ plugins: [], marketplaces: [], calls: [] }));
  const res = p.run(p.a, ['open', 'hobi'], { LEGACIES_CLAUDE_BIN: FAKE, FAKE_CLAUDE_STATE: state });
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(state, 'utf8')).calls, [`--add-dir ${path.resolve(p.b)}`]);
});

function webAndMobile() {
  const web = tempDir('legacies-web-');
  write(web, 'package.json', JSON.stringify({ dependencies: { next: '15', react: '19' } }));
  write(web, 'app/page.tsx', 'export default function Home() {}\n');
  write(web, 'app/(account)/settings/profile/page.tsx', 'export default function Profile() {}\n');
  write(web, 'app/api/users/route.ts', 'export async function GET() {}\n');
  write(web, 'components/UserCard.tsx', 'export function UserCard() {}\n');
  write(web, 'hooks/useAuth.ts', 'export function useAuth() {}\n');
  write(web, 'components/UserCard.test.tsx', 'test("x", () => {});\n');
  const mobile = tempDir('legacies-mobile-');
  write(mobile, 'package.json', JSON.stringify({ dependencies: { expo: '52', 'expo-router': '4' } }));
  write(mobile, 'app/(tabs)/index.tsx', 'export default function Home() {}\n');
  write(mobile, 'app/settings/profile.tsx', 'export default function Profile() {}\n');
  write(mobile, 'app/_layout.tsx', 'export default function Layout() {}\n');
  write(mobile, 'src/components/user-card.tsx', 'export function UserCard() {}\n');
  return { web, mobile };
}

test('migrate start inventories the source and matches what already exists in the target', () => {
  const p = twoProjects();
  const { web, mobile } = webAndMobile();
  const res = p.run(web, ['migrate', 'start', 'web-mobil', '--from', web, '--to', mobile]);
  assert.equal(res.status, 0, res.stderr);
  const plan = JSON.parse(fs.readFileSync(path.join(p.config, 'legacies-workspaces', 'web-mobil', 'migrations', 'web-mobil.json'), 'utf8'));
  const item = (id) => plan.items.find((i) => i.id === id);
  assert.deepEqual(plan.items.map((i) => i.id).sort(), ['component:usercard', 'hook:useauth', 'route:home', 'route:settings/profile']);
  assert.deepEqual([item('route:settings/profile').target, item('route:settings/profile').match], ['app/settings/profile.tsx', 'exact']);
  assert.deepEqual([item('component:usercard').target, item('component:usercard').match], ['src/components/user-card.tsx', 'exact']);
  assert.equal(item('hook:useauth').match, 'none');
});

const planOf = (config, name, workspace = name) => JSON.parse(fs.readFileSync(path.join(config, 'legacies-workspaces', workspace, 'migrations', `${name}.json`), 'utf8'));

test('migrate keys routes without their locale segment, so localized pages find their screens', () => {
  const p = twoProjects();
  const web = tempDir('legacies-web-');
  write(web, 'app/[locale]/settings/page.tsx', 'export default function Settings() {}\n');
  const mobile = tempDir('legacies-mobile-');
  write(mobile, 'package.json', JSON.stringify({ dependencies: { 'expo-router': '4' } }));
  write(mobile, 'app/settings.tsx', 'export default function Settings() {}\n');
  p.run(web, ['migrate', 'start', 'yerel', '--from', web, '--to', mobile]);
  assert.deepEqual(planOf(p.config, 'yerel').items.map((i) => [i.id, i.target, i.match]), [['route:settings', 'app/settings.tsx', 'exact']]);
});

test('migrate leaves server API routes out when the target is a mobile app, unless --kinds asks for them', () => {
  const p = twoProjects();
  const { web, mobile } = webAndMobile();
  const res = p.run(web, ['migrate', 'start', 'sade', '--from', web, '--to', mobile]);
  assert.equal(planOf(p.config, 'sade').items.some((i) => i.kind === 'api'), false);
  assert.match(res.stdout, /API uçları \(1\)/);
  p.run(web, ['migrate', 'start', 'tam', '--from', web, '--to', mobile, '--kinds', 'route,api']);
  // Both projects already share the workspace the first plan created, so the second plan joins it.
  assert.deepEqual(planOf(p.config, 'tam', 'sade').items.map((i) => i.kind).sort(), ['api', 'route', 'route']);
});

test('migrate does not match a page to a non-screen file that only shares its name', () => {
  const p = twoProjects();
  const web = tempDir('legacies-web-');
  write(web, 'app/activities/page.tsx', 'export default function Activities() {}\n');
  const mobile = tempDir('legacies-mobile-');
  write(mobile, 'src/lib/activities.ts', 'export const list = [];\n');
  p.run(web, ['migrate', 'start', 'ad', '--from', web, '--to', mobile]);
  assert.deepEqual(planOf(p.config, 'ad').items.map((i) => i.match), ['none']);
});

test('migrate start keeps a monorepo subfolder given as --from', () => {
  const p = twoProjects();
  const repo = gitRepo();
  write(repo, 'apps/web/app/page.tsx', 'export default function Home() {}\n');
  write(repo, 'apps/api/app/users/route.ts', 'export async function GET() {}\n');
  const mobile = tempDir('legacies-mobile-');
  write(mobile, 'app/index.tsx', 'export default function Home() {}\n');
  p.run(repo, ['migrate', 'start', 'alt', '--from', path.join(repo, 'apps', 'web'), '--to', mobile, '--kinds', 'route,api']);
  const plan = planOf(p.config, 'alt');
  assert.equal(plan.from, path.resolve(repo, 'apps', 'web'));
  assert.deepEqual(plan.items.map((i) => i.id), ['route:home']);
});

test('migrate done updates the plan and status reports the progress', () => {
  const p = twoProjects();
  const { web, mobile } = webAndMobile();
  p.run(web, ['migrate', 'start', 'web-mobil', '--from', web, '--to', mobile]);
  const done = p.run(web, ['migrate', 'done', 'web-mobil', 'route:settings/profile', '--note', 'form doğrulaması eklendi', '--workspace', 'web-mobil']);
  assert.equal(done.status, 0, done.stderr);
  const status = p.run(web, ['migrate', 'status', '--workspace', 'web-mobil']);
  assert.match(status.stdout, /web-mobil: .* 1\/4 tamam/);
  const md = fs.readFileSync(path.join(p.config, 'legacies-workspaces', 'web-mobil', 'migrations', 'web-mobil.md'), 'utf8');
  assert.match(md, /- \[x\] `route:settings\/profile` — .* · form doğrulaması eklendi/);
});
