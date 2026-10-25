import test from 'node:test';
import assert from 'node:assert/strict';
import { cli, commit, gitRepo, hook, initMemory, write } from './helpers.mjs';

const context = (res) => res.json && res.json.hookSpecificOutput && res.json.hookSpecificOutput.additionalContext;

// Route handlers are all named GET or POST; what they do is only in their bodies and their URLs.
function project() {
  const root = gitRepo();
  write(root, 'src/app/api/chest/open/route.ts', [
    'export async function POST() {',
    '  const coins = await getCoins();',
    '  if (coins < CHEST_PRICE) return Response.json({ error: "not_enough_coins" }, { status: 402 });',
    '  return Response.json(await rollEmote());',
    '}',
    '',
  ].join('\n'));
  write(root, 'src/app/api/vouches/route.ts', [
    'import { weeklyLimit } from "@/lib/limits";',
    '',
    'export async function POST(req: Request) {',
    '  const { suggestionId } = await req.json();',
    '  if (await alreadyVouched(suggestionId)) return Response.json({ error: "already_vouched" }, { status: 409 });',
    '  return Response.json(await vouch(suggestionId, weeklyLimit));',
    '}',
    '',
  ].join('\n'));
  write(root, 'src/app/[locale]/settings/privacy/page.tsx', 'export default function PrivacySettingsPage() {\n  return <HideActivityToggle />;\n}\n');
  commit(root, 'routes');
  initMemory(root);
  return root;
}

test('user-prompt-submit finds an API route from what its handler does', () => {
  const root = project();
  const text = context(hook(root, 'user-prompt-submit', { prompt: 'where do we refuse to open a chest when the user does not have enough coins?' }));
  assert.match(text, /POST \/api\/chest\/open — src\/app\/api\/chest\/open\/route\.ts:L1/);
  assert.doesNotMatch(text, /\/api\/vouches/);
});

test('map names routes by method and URL, and pages by their URL', () => {
  const root = project();
  const vouch = cli(root, ['map', 'already vouched suggestion']);
  assert.equal(vouch.status, 0, vouch.stderr);
  assert.match(vouch.stdout, /POST \/api\/vouches — src\/app\/api\/vouches\/route\.ts:L3/);
  const page = cli(root, ['map', 'privacy settings hide activity']);
  assert.match(page.stdout, /sayfa \/settings\/privacy — src\/app\/\[locale\]\/settings\/privacy\/page\.tsx:L1/);
});

test('the prompt hook suggests at most one page, so pages do not push components out', () => {
  const root = gitRepo();
  for (const name of ['privacy', 'profile', 'notifications']) {
    write(root, `src/app/settings/${name}/page.tsx`, `export default function Page() {\n  return <SettingsToggle label="${name} settings toggle" />;\n}\n`);
  }
  write(root, 'src/components/SettingsToggle.tsx', 'export function SettingsToggle() {\n  return null;\n}\n');
  commit(root, 'settings pages');
  initMemory(root);
  const text = context(hook(root, 'user-prompt-submit', { prompt: 'the settings toggle does not save its state' }));
  assert.equal((text.match(/^- sayfa /gm) || []).length, 1, text);
});

test('a Python service is found from what its handler does, without any framework-specific rule', () => {
  const root = gitRepo();
  // The path shares no word with the question: only the handler's own words can point at it.
  write(root, 'app/api/v2/handlers.py', [
    'from fastapi import APIRouter, HTTPException',
    '',
    'router = APIRouter()',
    '',
    '@router.post("/playlists/{playlist_id}/tracks")',
    'async def add_track(playlist_id: str, track: TrackIn):',
    '    if await count_tracks(playlist_id) >= MAX_TRACKS:',
    '        raise HTTPException(status_code=409, detail="playlist_full")',
    '    return await insert_track(playlist_id, track)',
    '',
  ].join('\n'));
  write(root, 'app/services/embeddings.py', 'def embed_lyrics(text: str) -> list[float]:\n    return model.encode(text)\n');
  commit(root, 'service');
  initMemory(root);
  const text = context(hook(root, 'user-prompt-submit', { prompt: 'where do we refuse to add a track when the playlist is already full?' }));
  assert.match(text, /app\/api\/v2\/handlers\.py/);
  assert.doesNotMatch(text, /embeddings\.py/);
});

test('a docstring or doc comment points at its file even when its words appear only once', () => {
  const root = gitRepo();
  // Fifty names used twice each outnumber the doc comment's words, which appear once.
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  const busy = Array.from({ length: 50 }, (_, i) => `busy${letters[i % 26]}${letters[Math.floor(i / 26)]}`);
  write(root, 'app/db/songs_repository.py', [
    'def upsert_song(row):',
    '    """Writes the raw Soundcharts payload once; running it twice is idempotent."""',
    ...busy.map((w) => `    ${w} = ${w} + 1`),
    '',
  ].join('\n'));
  write(root, 'src/lib/ledger.ts', [
    '/** Refunds are reconciled nightly against the acquirer settlement report. */',
    'export function closeDay() {',
    ...busy.map((w) => `  ${w} = ${w} + 1;`),
    '}',
    '',
  ].join('\n'));
  write(root, 'app/services/embeddings.py', 'def embed_lyrics(text: str) -> list[float]:\n    return model.encode(text)\n');
  commit(root, 'documented code');
  initMemory(root);
  const python = cli(root, ['map', 'where is the soundcharts payload written idempotently']);
  assert.equal(python.status, 0, python.stderr);
  assert.match(python.stdout, /app\/db\/songs_repository\.py/);
  const typescript = cli(root, ['map', 'where are refunds reconciled against the settlement report']);
  assert.match(typescript.stdout, /src\/lib\/ledger\.ts/);
});
