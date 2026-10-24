import path from 'node:path';
import { parseFrontmatter } from './frontmatter.mjs';
import { loadNotes } from './notes.mjs';
import { latestCards } from './sessions.mjs';
import { foldTurkish, oneLine, readText, toPosix } from './util.mjs';

// Folded (ASCII) forms, because tokens are folded before the lookup.
const STOPWORDS = new Set([
  'the', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'is', 'are', 'be', 'it', 'this', 'that',
  'with', 'as', 'at', 'by', 'from', 'how', 'what', 'where', 'why', 'when', 'do', 'does', 'we', 'you',
  've', 'veya', 'ile', 'bir', 'bu', 'su', 'da', 'de', 'mi', 'mu', 'ne', 'nasil', 'neden', 'nerede',
  'icin', 'gibi', 'daha', 'cok', 'en', 'ama', 'fakat', 'ki', 'sey', 'var', 'yok', 'olan', 'olarak',
  'bana', 'beni', 'sen', 'biz', 'siz', 'onu', 'bunu', 'sunu', 'hem', 'ya', 'yani',
]);

const K1 = 1.2;
const B = 0.75;
const PREFIX_WEIGHT = 0.6;
const MIN_PREFIX = 4;

// Splits camelCase, snake_case, kebab-case and paths; folds Turkish letters; keeps 2-letter terms like db/ui/id.
export function tokenize(text) {
  const spaced = String(text)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  return foldTurkish(spaced)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

// Prefix matching stands in for stemming: "dogrulamayi" finds "dogrulama" without mangling English words.
function termMatch(token, term) {
  if (token === term) return 1;
  if (Math.min(token.length, term.length) >= MIN_PREFIX && (token.startsWith(term) || term.startsWith(token))) {
    return PREFIX_WEIGHT;
  }
  return 0;
}

function termFreq(counts, term) {
  let tf = 0;
  for (const [token, count] of counts) tf += count * termMatch(token, term);
  return tf;
}

export function rankDocuments(docs, query, { limit = 5 } = {}) {
  const terms = [...new Set(tokenize(query))];
  if (terms.length === 0 || docs.length === 0) return [];
  const prepared = docs.map((doc) => {
    const tokens = tokenize(doc.text);
    const counts = new Map();
    for (const t of tokens) counts.set(t, (counts.get(t) || 0) + 1);
    return { doc, counts, length: Math.max(tokens.length, 1) };
  });
  const avg = prepared.reduce((sum, p) => sum + p.length, 0) / prepared.length;
  const n = prepared.length;
  const idf = terms.map((term) => {
    const df = prepared.filter((p) => termFreq(p.counts, term) > 0).length;
    return Math.log(1 + (n - df + 0.5) / (df + 0.5));
  });
  return prepared
    .map((p) => {
      let score = 0;
      let matched = 0;
      terms.forEach((term, i) => {
        const tf = termFreq(p.counts, term);
        if (!tf) return;
        matched += 1;
        score += (idf[i] * tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * p.length) / avg));
      });
      return { ...p.doc, score, matched, coverage: matched / terms.length };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function splitSections(body) {
  const sections = [];
  let current = { title: '', lines: [] };
  for (const line of body.split('\n')) {
    const m = line.match(/^#{1,3}\s+(.+)$/);
    if (m) {
      if (current.lines.join('').trim()) sections.push(current);
      current = { title: m[1].trim(), lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  if (current.lines.join('').trim()) sections.push(current);
  return sections.map((s) => ({ title: s.title, text: s.lines.join('\n').trim() }));
}

export function collectDocuments(paths, { sessionCards = 20 } = {}) {
  const docs = [];
  for (const note of loadNotes(paths)) {
    if (note.status !== 'active') continue;
    docs.push({
      kind: note.type,
      title: note.title,
      rel: note.rel,
      paths: note.paths,
      summary: note.summary,
      body: note.body,
      // The title is repeated so that a title hit outweighs a passing mention in a long body.
      text: [note.title, note.title, note.title, note.tags.join(' '), note.paths.join(' '), note.summary, note.body].join('\n'),
    });
  }
  for (const [file, kind] of [
    [paths.project, 'proje'],
    [paths.state, 'durum'],
  ]) {
    const raw = readText(file);
    if (!raw) continue;
    const rel = toPosix(path.relative(paths.base, file));
    for (const section of splitSections(parseFrontmatter(raw).body)) {
      docs.push({ kind, title: section.title || rel, rel, paths: [], body: section.text, text: `${section.title}\n${section.title}\n${section.text}` });
    }
  }
  for (const card of latestCards(paths, { limit: sessionCards })) {
    const rel = toPosix(path.relative(paths.base, card.file));
    docs.push({ kind: 'oturum', title: path.basename(card.file, '.md'), rel, paths: [], body: card.body, text: card.body });
  }
  return docs;
}

export function snippet(text, query, max = 220) {
  const terms = tokenize(query);
  const lines = String(text)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('---'));
  let best = lines[0] || '';
  let bestHits = 0;
  for (const line of lines) {
    const tokens = tokenize(line);
    const hits = terms.filter((term) => tokens.some((t) => termMatch(t, term) > 0)).length;
    if (hits > bestHits) {
      best = line;
      bestHits = hits;
    }
  }
  return oneLine(best, max);
}

export function searchMemory(paths, query, { limit = 5 } = {}) {
  return rankDocuments(collectDocuments(paths), query, { limit }).map((r) => ({ ...r, snippet: snippet(r.body, query) }));
}
