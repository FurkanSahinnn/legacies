import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFrontmatter, stringifyFrontmatter } from '../scripts/lib/frontmatter.mjs';
import { pathMatches } from '../scripts/lib/notes.mjs';
import { rankDocuments, tokenize } from '../scripts/lib/search.mjs';
import { packSections } from '../scripts/lib/context.mjs';
import { summarizeTranscript } from '../scripts/lib/transcript.mjs';

test('frontmatter round-trips lists, colons and CRLF input', () => {
  const text = stringifyFrontmatter(
    { title: 'Auth: session cookie', paths: ['src/lib/**', 'src/middleware.ts'], verified: '2026-10-22@abcdef12' },
    'Body line\n',
  );
  const parsed = parseFrontmatter(text.replace(/\n/g, '\r\n'));
  assert.equal(parsed.data.title, 'Auth: session cookie');
  assert.deepEqual(parsed.data.paths, ['src/lib/**', 'src/middleware.ts']);
  assert.equal(parsed.data.verified, '2026-10-22@abcdef12');
  assert.equal(parsed.body.trim(), 'Body line');
});

test('tokenize splits code identifiers and folds Turkish letters', () => {
  assert.deepEqual(tokenize('getUserProfile'), ['get', 'user', 'profile']);
  assert.deepEqual(tokenize('db_url ve UI'), ['db', 'url', 'ui']);
  assert.deepEqual(tokenize('Kimlik doğrulaması'), ['kimlik', 'dogrulamasi']);
  assert.deepEqual(tokenize('src/lib/rate-limit.ts'), ['src', 'lib', 'rate', 'limit', 'ts']);
});

test('ranking matches inflected Turkish and plural English through prefixes', () => {
  const docs = [
    { id: 'a', text: 'Ödeme webhook doğrulama adımı' },
    { id: 'b', text: 'Request handler registry for API routes' },
    { id: 'c', text: 'Tamamen ilgisiz bir not' },
  ];
  assert.equal(rankDocuments(docs, 'doğrulamayı nerede yapıyoruz')[0].id, 'a');
  assert.equal(rankDocuments(docs, 'handlers')[0].id, 'b');
  assert.equal(rankDocuments(docs, 'kubernetes').length, 0);
});

test('pathMatches handles globs, directories and exact files', () => {
  assert.ok(pathMatches('src/lib/**', 'src/lib/a/b.ts'));
  assert.ok(pathMatches('src/**/x.ts', 'src/x.ts'));
  assert.ok(pathMatches('src/**/x.ts', 'src/a/b/x.ts'));
  assert.ok(pathMatches('src/lib', 'src/lib/a.ts'));
  assert.ok(!pathMatches('src/lib', 'src/library.ts'));
  assert.ok(pathMatches('src\\middleware.ts', 'src/middleware.ts'));
  assert.ok(!pathMatches('src/*.ts', 'src/a/b.ts'));
});

test('packSections stays within budget and marks the cut', () => {
  const long = Array.from({ length: 200 }, (_, i) => `satır ${i}`).join('\n');
  const text = packSections(
    [
      { title: 'Durum', text: 'kısa durum', min: 300 },
      { title: 'Proje', text: long, min: 400, file: 'PROJECT.md' },
    ],
    900,
  );
  assert.ok(text.length <= 900, `length ${text.length}`);
  assert.match(text, /## Durum\nkısa durum/);
  assert.match(text, /devamı: \.legacies\/PROJECT\.md/);
});

test('packSections fills the note index before the tail of a long project card', () => {
  const project = Array.from({ length: 120 }, (_, i) => `proje satırı ${i}`).join('\n');
  const index = Array.from({ length: 12 }, (_, i) => `- [not ${i}](x.md) — özet`).join('\n');
  const text = packSections(
    [
      { title: 'Proje', text: project, min: 400, fill: 5, file: 'PROJECT.md' },
      { title: 'Dizin', text: index, min: 200, fill: 3 },
    ],
    1600,
  );
  assert.match(text, /not 11/, 'every index line fits');
  assert.match(text, /devamı: \.legacies\/PROJECT\.md/, 'the project card is the one that gets cut');
  assert.ok(text.indexOf('## Proje') < text.indexOf('## Dizin'), 'render order is unchanged');
});

test('summarizeTranscript keeps only human prompts, answers, edits and todos', () => {
  const entries = [
    { type: 'user', origin: { kind: 'human' }, message: { content: 'Giriş sayfasını düzelt' } },
    { type: 'user', isMeta: true, origin: { kind: 'peer' }, message: { content: 'Another Claude session sent a message: x' } },
    { type: 'queue-operation', operation: 'enqueue', content: 'Bir de testleri ekle' },
    { type: 'queue-operation', operation: 'enqueue', content: '<task-notification>done</task-notification>' },
    {
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Başlıyorum' },
          { type: 'tool_use', id: 'ask1', name: 'AskUserQuestion', input: {} },
          { type: 'tool_use', id: 'e1', name: 'Edit', input: { file_path: 'src/login.tsx' } },
          { type: 'tool_use', id: 't1', name: 'TodoWrite', input: { todos: [{ content: 'Test yaz', status: 'pending' }] } },
        ],
      },
    },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'ask1', content: 'Seçenek B' }] } },
  ];
  const s = summarizeTranscript(entries);
  assert.deepEqual(
    s.prompts.map((p) => p.text),
    ['Giriş sayfasını düzelt', 'Bir de testleri ekle', '[Soru cevabı] Seçenek B'],
  );
  assert.deepEqual(s.files, ['src/login.tsx']);
  assert.equal(s.todos[0].content, 'Test yaz');
  assert.equal(s.lastAssistant, 'Başlıyorum');
});
