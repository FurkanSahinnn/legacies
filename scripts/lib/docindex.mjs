import fs from 'node:fs';
import path from 'node:path';
import { graphPath, normLabel } from './codeindex.mjs';
import { CODE_WORDS, stemMatch } from './content.mjs';
import { tokenize } from './search.mjs';
import { readJson, writeAtomic } from './util.mjs';

// A doc comment or docstring says what one definition does, in the words a question tends to use. Each is
// tied to the definition graphify located (in any language it parses), so a question worded like the
// documentation gets the function's line, where the content index only knows its file. graphify keeps
// Python docstrings as nodes of their own but skips JSDoc and answers with whole subgraphs; this reads both
// kinds next to the definition and answers in one line per hit.
const DOC_INDEX_VERSION = 1;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_DOC_LINES = 40;
// How far a Python signature may run below its `def` line before the docstring.
const MAX_SIGNATURE_LINES = 12;
// One shared word is chance, and so are two out of ten: a match must also cover this share of the question.
// On 200 hand-written questions, matches below 40% were right 8 times in 180; on questions worded like the
// documentation nearly every match is above it.
const MIN_MATCHED_TERMS = 2;
const MIN_COVERAGE = 0.4;
// A match this complete is the answer, as graphify ranks a docstring node first: it goes ahead of matches
// by name. No hand-written question reached it; 84-100% of the questions worded like the documentation did.
const STRONG_COVERAGE = 0.7;
const RELATIVE_FLOOR = 0.6;
// BM25: a long docstring matches more of a question's words by chance than a one-line summary does.
const K1 = 1.2;
const B = 0.75;

// Comment lines in the common syntaxes: //, ///, /* */, *, # (not #[attr] or #!), --, ;;.
const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*|#(?=\s|$)|--|;;)/;
// Decorators and attributes sit between a doc comment and its definition.
const ANNOTATION_LINE = /^\s*(?:@|#\[)/;
const DOCSTRING_OPEN = /^\s*[rRuUbB]?("""|''')/;
const PYTHON_DEFINITION = /^\s*(?:async\s+def|def|class)\b|^\s*@/;

const isDocWord = (word) => word.length >= 3 && !/^\d+$/.test(word) && !CODE_WORDS.has(word);

// The comment block right above a definition (index `at`, 0-based), skipping its decorators.
function docAbove(lines, at) {
  let i = at - 1;
  while (i >= 0 && ANNOTATION_LINE.test(lines[i])) i -= 1;
  const doc = [];
  while (i >= 0 && doc.length < MAX_DOC_LINES && COMMENT_LINE.test(lines[i])) doc.unshift(lines[i--]);
  return doc.join('\n');
}

// A Python docstring: the first statement after the signature, which may span several lines.
function docstringBelow(lines, at) {
  let i = at;
  const end = Math.min(lines.length, at + MAX_SIGNATURE_LINES);
  while (i < end && !/:\s*(?:#.*)?$/.test(lines[i])) {
    i += 1;
    if (i < end && PYTHON_DEFINITION.test(lines[i])) return '';
  }
  i += 1;
  while (i < lines.length && !lines[i].trim()) i += 1;
  const open = DOCSTRING_OPEN.exec(lines[i] || '');
  if (!open) return '';
  const quote = open[1];
  const first = lines[i].slice(lines[i].indexOf(quote) + 3);
  if (first.includes(quote)) return first.slice(0, first.indexOf(quote));
  const doc = [first];
  for (let j = i + 1; j < lines.length && doc.length < MAX_DOC_LINES; j += 1) {
    const close = lines[j].indexOf(quote);
    if (close >= 0) {
      doc.push(lines[j].slice(0, close));
      break;
    }
    doc.push(lines[j]);
  }
  return doc.join('\n');
}

// Definitions graphify located, grouped by file so each file is read once.
function definitionsByFile(graph) {
  const byFile = new Map();
  for (const node of graph.nodes) {
    if (!node || !node.label || !node.source_file || node.file_type !== 'code') continue;
    const norm = normLabel(node.label);
    if (norm.length < 3 || /\.[a-z0-9]{1,5}$/.test(norm)) continue;
    const line = Number((/^L(\d+)/.exec(node.source_location || '') || [])[1]);
    if (!line) continue;
    const file = String(node.source_file).replace(/\\/g, '/');
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file).push([node.label, line]);
  }
  return byFile;
}

function readSource(root, file) {
  const full = path.isAbsolute(file) ? file : path.join(root, file);
  try {
    return fs.statSync(full).size > MAX_FILE_BYTES ? null : fs.readFileSync(full, 'utf8');
  } catch {
    return null;
  }
}

// Rebuilt when graph.json changes: entries [label, file, loc, words] and word -> flat [entry, count, ...].
export function docIndex(paths) {
  let stat;
  try {
    stat = fs.statSync(graphPath(paths));
  } catch {
    return null;
  }
  const key = `${DOC_INDEX_VERSION}-${stat.size}-${stat.mtimeMs}`;
  const cacheFile = path.join(paths.runtime, 'doc-index.json');
  const cached = readJson(cacheFile);
  if (cached && cached.key === key) return cached;
  const graph = readJson(graphPath(paths));
  if (!graph || !Array.isArray(graph.nodes)) return null;
  const entries = [];
  const words = Object.create(null);
  let totalLength = 0;
  for (const [file, definitions] of definitionsByFile(graph)) {
    const text = readSource(paths.root, file);
    if (!text) continue;
    const lines = text.split(/\r?\n/);
    const python = /\.pyi?$/.test(file);
    for (const [label, line] of definitions) {
      const doc = `${docAbove(lines, line - 1)}\n${python ? docstringBelow(lines, line - 1) : ''}`;
      const counts = new Map();
      for (const word of tokenize(doc)) if (isDocWord(word)) counts.set(word, (counts.get(word) || 0) + 1);
      if (counts.size === 0) continue;
      // The name's own words join its documentation's, so a question may mix the two.
      for (const word of tokenize(label)) if (isDocWord(word)) counts.set(word, (counts.get(word) || 0) + 1);
      let length = 0;
      for (const [word, n] of counts) {
        (words[word] ||= []).push(entries.length, n);
        length += n;
      }
      totalLength += length;
      entries.push([label, file, `L${line}`, length]);
    }
  }
  const index = { key, entries, words, averageLength: entries.length ? totalLength / entries.length : 0 };
  try {
    fs.mkdirSync(paths.runtime, { recursive: true });
    writeAtomic(cacheFile, JSON.stringify(index));
  } catch {
    // Still usable for this call.
  }
  return index;
}

// Definitions whose documentation shares the most (and the rarest) of the question's words.
export function lookupDocs(index, query, { limit = 2, extraTerms = [] } = {}) {
  if (!index || index.entries.length === 0) return [];
  const terms = [...new Set([...tokenize(query), ...extraTerms])].filter(isDocWord);
  if (terms.length === 0) return [];
  index.vocabulary ||= Object.keys(index.words);
  const scores = new Map();
  for (const term of terms) {
    const counts = new Map();
    for (const word of index.vocabulary) {
      if (!stemMatch(word, term)) continue;
      const pairs = index.words[word];
      for (let k = 0; k < pairs.length; k += 2) counts.set(pairs[k], Math.max(counts.get(pairs[k]) || 0, pairs[k + 1]));
    }
    if (counts.size === 0) continue;
    const idf = Math.log(1 + index.entries.length / counts.size);
    for (const [i, n] of counts) {
      const lengthRatio = index.entries[i][3] / (index.averageLength || 1);
      const s = scores.get(i) || { score: 0, matched: 0 };
      s.score += (idf * n * (K1 + 1)) / (n + K1 * (1 - B + B * lengthRatio));
      s.matched += 1;
      scores.set(i, s);
    }
  }
  const needed = Math.max(MIN_MATCHED_TERMS, Math.ceil(terms.length * MIN_COVERAGE));
  const ranked = [...scores.entries()].filter(([, s]) => s.matched >= needed).sort((a, b) => b[1].score - a[1].score);
  if (ranked.length === 0) return [];
  const floor = ranked[0][1].score * RELATIVE_FLOOR;
  return ranked
    .filter(([, s]) => s.score >= floor)
    .slice(0, limit)
    .map(([i, s]) => {
      const [label, file, loc] = index.entries[i];
      return { label, file, loc, strong: s.matched >= terms.length * STRONG_COVERAGE };
    });
}
