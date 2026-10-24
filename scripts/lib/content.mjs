import fs from 'node:fs';
import path from 'node:path';
import { gitIndexStamp, PATH_STOPWORDS } from './codeindex.mjs';
import { classify } from './routekeys.mjs';
import { tokenize } from './search.mjs';
import { readJson, readText, writeAtomic } from './util.mjs';

// Questions describe what code does ("refuse to open a chest without enough coins"), and those words
// live inside the code: identifiers, error codes, table names, comments, URL strings. Every tracked code
// file, in any language, becomes a small document of its path words and its most frequent words, scored
// against the question. Framework routes (Next.js, SvelteKit, Expo Router) also get a method/URL label.
const CONTENT_VERSION = 1;
const WORDS_PER_FILE = 40;
const MAX_FILE_BYTES = 512 * 1024;
// A minified or generated file has very long lines; its words say little about intent.
const MAX_LINE_LENGTH = 2000;
// A word in the file's path says more about the file than a word in its body.
const PATH_WEIGHT = 1.5;
// A file needs this many of the question's words; one shared word is chance.
const MIN_MATCHED_TERMS = 2;
const RELATIVE_FLOOR = 0.6;
const MIN_STEM = 4;
// About 600 tokens: enough for a project's domain words; candidates beyond it are checked by name.
const VOCAB_LIMIT = 300;
const NEAR_LIMIT = 5;
const CODE_FILE = /\.(?:[cm]?[jt]sx?|vue|svelte|astro|py|pyi|go|rb|php|java|kt|kts|scala|groovy|cs|fs|vb|swift|m|mm|rs|c|cc|cpp|cxx|h|hh|hpp|lua|dart|ex|exs|erl|hrl|clj|cljs|hs|ml|r|jl|zig|nim|cr|pl|pm|sql|sh|ps1|tf|proto|graphql|gql)$/i;
const HANDLER = /^export\s+(?:async\s+)?(?:function\s+|const\s+)(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/;
// Keywords and words every file has, across languages; they say nothing about this one.
const CODE_WORDS = new Set([
  'const', 'let', 'var', 'return', 'await', 'async', 'import', 'from', 'export', 'function', 'default', 'true',
  'false', 'null', 'undefined', 'new', 'else', 'try', 'catch', 'throw', 'type', 'interface', 'string', 'number',
  'boolean', 'json', 'then', 'this', 'void', 'any', 'object', 'promise', 'props', 'react', 'div', 'span', 'classname',
  'def', 'class', 'self', 'none', 'elif', 'except', 'raise', 'pass', 'lambda', 'yield', 'with', 'not', 'and',
  'public', 'private', 'protected', 'static', 'final', 'int', 'bool', 'float', 'double', 'char', 'long', 'func',
  'package', 'struct', 'impl', 'pub', 'mod', 'use', 'end', 'begin', 'require', 'module', 'nil', 'err', 'val',
  'override', 'extends', 'implements', 'enum', 'case', 'switch', 'break', 'continue', 'while', 'for', 'str', 'dict',
  'list', 'args', 'kwargs', 'value', 'data', 'result', 'error', 'index', 'item', 'items', 'key', 'name', 'get', 'set',
]);
const KIND_LABEL = { route: 'sayfa', screen: 'ekran' };

function expoRouterIn(root) {
  const pkg = readJson(path.join(root, 'package.json')) || {};
  return Boolean({ ...pkg.dependencies, ...pkg.devDependencies }['expo-router']);
}

function fileStamp(root, file) {
  try {
    const stat = fs.statSync(path.join(root, file));
    return stat.size > MAX_FILE_BYTES ? null : `${stat.size}:${stat.mtimeMs}`;
  } catch {
    return null;
  }
}

function fileDocument(root, file, route) {
  const text = readText(path.join(root, file), '');
  if (!text) return null;
  const lines = text.split(/\r?\n/);
  if (lines.some((l) => l.length > MAX_LINE_LENGTH)) return null;
  const counts = new Map();
  for (const word of tokenize(text)) {
    if (word.length < 3 || /^\d+$/.test(word) || CODE_WORDS.has(word)) continue;
    counts.set(word, (counts.get(word) || 0) + 1);
  }
  const words = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, WORDS_PER_FILE).flat();
  const pathWords = tokenize((route ? route.key : file).replace(/\.[^./]+$/, '')).filter((w) => w.length >= 3 && !CODE_WORDS.has(w));
  if (!route) return { words, pathWords, label: null, line: null, page: false };
  const methods = [];
  let line = 1;
  lines.forEach((l, i) => {
    const m = HANDLER.exec(l);
    if (!m) return;
    if (methods.length === 0) line = i + 1;
    if (!methods.includes(m[1])) methods.push(m[1]);
  });
  const label = `${methods.length ? methods.join('|') : KIND_LABEL[route.kind] || 'API'} ${route.key}`;
  return { words, pathWords, label, line, page: route.kind !== 'api' };
}

// Rebuilt when git's index changes, rereading only the files whose size or time changed.
export function contentIndex(paths, files) {
  const stamp = gitIndexStamp(paths);
  if (!stamp) return null;
  const key = `${CONTENT_VERSION}|${stamp}`;
  const cacheFile = path.join(paths.runtime, 'content.json');
  // The per-file documents live apart from the lookup index: only a rebuild reads them.
  const docsFile = path.join(paths.runtime, 'content-docs.json');
  const cached = readJson(cacheFile);
  if (cached && cached.key === key && Array.isArray(cached.files)) return cached;
  const saved = readJson(docsFile);
  const previous = saved && saved.version === CONTENT_VERSION && Array.isArray(saved.docs) ? new Map(saved.docs.map((d) => [d.file, d])) : new Map();
  const expoRouter = expoRouterIn(paths.root);
  const docs = [];
  for (const file of files) {
    if (!CODE_FILE.test(file)) continue;
    const fstamp = fileStamp(paths.root, file);
    if (!fstamp) continue;
    const old = previous.get(file);
    if (old && old.stamp === fstamp) {
      docs.push(old);
      continue;
    }
    const route = classify(file, { expoRouter });
    const doc = fileDocument(paths.root, file, route && ['route', 'api', 'screen'].includes(route.kind) ? route : null);
    if (doc) docs.push({ file, stamp: fstamp, ...doc });
  }
  // Stored inverted (word -> flat [file, count, ...] pairs) so a prompt parses it and scans the words
  // without rebuilding anything.
  const body = Object.create(null);
  const inPath = Object.create(null);
  docs.forEach((doc, i) => {
    for (let k = 0; k < doc.words.length; k += 2) (body[doc.words[k]] ||= []).push(i, doc.words[k + 1]);
    for (const word of doc.pathWords) (inPath[word] ||= []).push(i);
  });
  const index = { key, files: docs.map((d) => [d.file, d.label, d.line, d.page ? 1 : 0]), body, inPath };
  try {
    fs.mkdirSync(paths.runtime, { recursive: true });
    writeAtomic(cacheFile, JSON.stringify(index));
    writeAtomic(docsFile, JSON.stringify({ version: CONTENT_VERSION, docs }));
  } catch {
    // Still usable for this call.
  }
  return index;
}

const stemMatch = (a, b) => a === b || (Math.min(a.length, b.length) >= MIN_STEM && (a.startsWith(b) || b.startsWith(a)));

function vocabulary(index) {
  if (!index.vocabulary) index.vocabulary = [...new Set([...Object.keys(index.body), ...Object.keys(index.inPath)])];
  return index.vocabulary;
}

// Files whose path and body share the most (and the rarest) of the question's words. Pages share much of
// their wording (layout, labels), so they are capped at `pageLimit` to leave room for the components and
// modules the question is about. Entries carry a route label and line when the file is a known route.
export function lookupContent(index, query, { limit = 2, pageLimit = 1, extraTerms = [] } = {}) {
  if (!index || index.files.length === 0) return [];
  const terms = [...new Set([...tokenize(query), ...extraTerms])].filter((t) => t.length >= 3 && !CODE_WORDS.has(t));
  if (terms.length === 0) return [];
  const scores = new Map();
  for (const term of terms) {
    const counts = new Map();
    const pathHit = new Set();
    for (const word of vocabulary(index)) {
      if (!stemMatch(word, term)) continue;
      const pairs = Object.hasOwn(index.body, word) ? index.body[word] : [];
      for (let k = 0; k < pairs.length; k += 2) counts.set(pairs[k], Math.max(counts.get(pairs[k]) || 0, pairs[k + 1]));
      for (const i of Object.hasOwn(index.inPath, word) ? index.inPath[word] : []) pathHit.add(i);
    }
    const holders = new Set([...counts.keys(), ...pathHit]);
    if (holders.size === 0) continue;
    // A word most files share weighs little.
    const idf = Math.log(1 + index.files.length / holders.size);
    for (const i of holders) {
      const tf = counts.get(i) || 0;
      const s = scores.get(i) || { score: 0, matched: 0 };
      s.score += idf * ((pathHit.has(i) ? PATH_WEIGHT : 0) + tf / (tf + 1.2));
      s.matched += 1;
      scores.set(i, s);
    }
  }
  const ranked = [...scores.entries()].filter(([, s]) => s.matched >= MIN_MATCHED_TERMS).sort((a, b) => b[1].score - a[1].score);
  if (ranked.length === 0) return [];
  const floor = ranked[0][1].score * RELATIVE_FLOOR;
  const hits = [];
  let pages = 0;
  for (const [i, s] of ranked) {
    if (s.score < floor || hits.length >= limit) break;
    const [file, label, line, page] = index.files[i];
    if (page && pages++ >= pageLimit) continue;
    hits.push(label ? { label, file, loc: `L${line}` } : { file });
  }
  return hits;
}

// The project's own words, the most used first: the words in symbol names (from the code graph) and in
// folder and file names, or without a graph the words inside the files. The model translates a question
// in another language into these, as graphify's skill does with its graph's labels. Given candidate
// words, it lists the project words that share a stem with each, so a guessed translation can be checked.
export function projectVocabulary(graph, content, { limit = VOCAB_LIMIT, near = [] } = {}) {
  const uses = new Map();
  const add = (word, n) => {
    if (word.length < 3 || !/[a-z]/.test(word) || CODE_WORDS.has(word) || PATH_STOPWORDS.has(word)) return;
    uses.set(word, (uses.get(word) || 0) + n);
  };
  if (graph && graph.words) for (const [word, names] of Object.entries(graph.words)) add(word, names.length);
  if (content) {
    for (const [word, files] of Object.entries(content.inPath)) add(word, files.length);
    if (!graph) for (const [word, pairs] of Object.entries(content.body)) add(word, pairs.length / 2);
  }
  const ranked = [...uses.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (near.length === 0) return { total: ranked.length, words: ranked.slice(0, limit) };
  const matches = near.map((candidate) => [candidate, ranked.filter(([word]) => stemMatch(word, candidate)).slice(0, NEAR_LIMIT)]);
  return { total: ranked.length, matches };
}
