import fs from 'node:fs';
import path from 'node:path';
import { git, MEMORY_DIRNAME } from './project.mjs';
import { tokenize } from './search.mjs';
import { exists, foldTurkish, mtimeMs, readJson, readText, writeAtomic } from './util.mjs';

// graphify writes the code graph inside the memory folder, which is already kept out of git.
export const GRAPH_FILE = path.join(MEMORY_DIRNAME, 'graph', 'graph.json');
// Bumped whenever the cached index gains fields, so an older cache is rebuilt instead of read.
const GRAPH_INDEX_VERSION = 2;
// A word this rare can name a symbol on its own ("factor" finds hasVerifiedMfaFactor); commoner ones need company.
const RARE_WORD_MAX_SYMBOLS = 3;
// Word matches below this share of the best one are dropped as noise.
const WORD_MATCH_RELATIVE_FLOOR = 0.6;
// Files larger than this are generated or vendored; reading them to fix a line is not worth it.
const MAX_DEFINITION_SCAN = 2 * 1024 * 1024;

// Path segments that appear everywhere and say nothing about where a feature lives.
export const PATH_STOPWORDS = new Set([
  'src', 'lib', 'libs', 'app', 'apps', 'api', 'page', 'pages', 'route', 'routes', 'index', 'components',
  'component', 'utils', 'util', 'helpers', 'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json', 'md', 'css',
  'test', 'tests', 'spec', 'main', 'packages', 'public', 'styles', 'types', 'type', 'dist', 'core', 'common',
]);
const SKIP_FILES = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb)$|\.(png|jpe?g|gif|webp|ico|svg|woff2?|ttf|mp4|zip|pdf)$/i;

// The index file changes on every add, commit and checkout, so its mtime keys the cache without running git.
function gitIndexFile(root) {
  const dotGit = path.join(root, '.git');
  try {
    if (fs.statSync(dotGit).isFile()) {
      const m = /gitdir:\s*(.+)/.exec(readText(dotGit, ''));
      return m ? path.join(path.resolve(root, m[1].trim()), 'index') : null;
    }
  } catch {
    return null;
  }
  return path.join(dotGit, 'index');
}

// Changes whenever the tracked files may have: caches built from them use it as their key.
export function gitIndexStamp(paths) {
  const indexFile = gitIndexFile(paths.root);
  return indexFile && exists(indexFile) ? String(mtimeMs(indexFile)) : null;
}

export function trackedFiles(paths) {
  const key = gitIndexStamp(paths);
  if (!key) return [];
  const cacheFile = path.join(paths.runtime, 'files.json');
  const cached = readJson(cacheFile);
  if (cached && cached.key === key && Array.isArray(cached.files)) return cached.files;
  const out = git(paths.root, ['ls-files'], { timeout: 5000 });
  const files = out ? out.split('\n').filter((f) => f && !SKIP_FILES.test(f)) : [];
  try {
    writeAtomic(cacheFile, JSON.stringify({ key, files }));
  } catch {
    // A read-only checkout still gets results, just without the cache.
  }
  return files;
}

function stemMatch(token, term) {
  if (token === term) return 2;
  if (Math.min(token.length, term.length) >= 4 && (token.startsWith(term) || term.startsWith(token))) return 1;
  return 0;
}

// Query terms worth matching against paths and symbol names, plus any glossary translations.
function queryTerms(query, extraTerms) {
  return [...new Set([...tokenize(query), ...extraTerms])].filter((t) => t.length >= 3 && !PATH_STOPWORDS.has(t));
}

// Scores tracked files by how many prompt terms their path names; a single generic hit is not enough.
export function matchPaths(files, query, { limit = 4, extraTerms = [] } = {}) {
  const terms = queryTerms(query, extraTerms);
  if (terms.length === 0) return [];
  const scored = [];
  for (const file of files) {
    const tokens = tokenize(file).filter((t) => !PATH_STOPWORDS.has(t));
    if (tokens.length === 0) continue;
    const base = new Set(tokenize(path.posix.basename(file).replace(/\.[^.]+$/, '')));
    let score = 0;
    for (const term of terms) {
      let best = 0;
      for (const token of tokens) best = Math.max(best, stemMatch(token, term) + (base.has(token) && stemMatch(token, term) ? 1 : 0));
      score += best;
    }
    if (score >= 2) scored.push({ file, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.file.length - b.file.length)
    .slice(0, limit)
    .map((s) => s.file);
}

export function normLabel(label) {
  return foldTurkish(String(label))
    .replace(/^\.+/, '')
    .replace(/\(.*\)$/, '')
    .trim()
    .toLowerCase();
}

export function graphPath(paths) {
  return path.join(paths.root, GRAPH_FILE);
}

export function graphDir(paths) {
  return path.dirname(graphPath(paths));
}

// Turns graph.json into label -> [label, file, line] so a prompt lookup never parses the full graph.
export function graphIndex(paths) {
  const file = graphPath(paths);
  if (!exists(file)) return null;
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return null;
  }
  const key = `${GRAPH_INDEX_VERSION}-${stat.size}-${stat.mtimeMs}`;
  const cacheFile = path.join(paths.runtime, 'graph-index.json');
  const cached = readJson(cacheFile);
  if (cached && cached.key === key) return cached;
  const graph = readJson(file);
  if (!graph || !Array.isArray(graph.nodes)) return null;
  // No prototype: symbols named `constructor` or `toString` must not hit Object.prototype.
  const entries = Object.create(null);
  for (const node of graph.nodes) {
    if (!node || !node.label || !node.source_file || node.file_type !== 'code') continue;
    const norm = normLabel(node.label);
    if (norm.length < 3 || /\.[a-z0-9]{1,5}$/.test(norm)) continue;
    (entries[norm] ||= []).push([node.label, String(node.source_file).replace(/\\/g, '/'), node.source_location || '']);
  }
  // The words inside each name (sendMessage -> send, message) point back at the names that contain them.
  const words = Object.create(null);
  for (const norm of Object.keys(entries)) {
    for (const word of new Set(tokenize(entries[norm][0][0]))) if (word.length >= 3) (words[word] ||= []).push(norm);
  }
  const index = { key, builtAt: graph.built_at_commit || (graph.graph && graph.graph.built_at_commit) || null, nodes: graph.nodes.length, entries, words };
  try {
    writeAtomic(cacheFile, JSON.stringify(index));
  } catch {
    // Still usable for this call.
  }
  return index;
}

// Words that look like code: camelCase, PascalCase, snake_case, dotted names or anything in backticks.
export function identifierCandidates(prompt) {
  const text = String(prompt);
  const found = new Set();
  for (const m of text.matchAll(/`([^`\n]{2,80})`/g)) {
    for (const part of m[1].split(/[^A-Za-z0-9_$.]+/)) if (part) found.add(part);
  }
  for (const m of text.matchAll(/[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*/g)) {
    const word = m[0];
    if (/[a-z][A-Z]|[A-Z][a-z]+[A-Z]|_|\.|\d/.test(word) || /^[A-Z][a-z]{3,}[A-Z]?/.test(word)) found.add(word);
  }
  const out = new Set();
  for (const word of found) {
    out.add(word);
    const last = word.split('.').pop();
    if (last && last !== word) out.add(last);
  }
  return [...out].filter((w) => w.length >= 3);
}

// The line where `name`, with exactly this case, is defined: a declaration keyword before it, or a method
// signature at the start of a line. Big generated files are not scanned.
function exactDefinitionLine(root, file, name) {
  const text = readText(path.join(root, file), '');
  if (!text || text.length > MAX_DEFINITION_SCAN) return null;
  const id = name.replace(/\$/g, '\\$');
  const declared = new RegExp(`(?:function|class|interface|type|enum|const|let|var|def|fn|func|struct|trait|record)\\s+\\*?\\s*${id}\\b`);
  const member = new RegExp(`^\\s*(?:(?:public|private|protected|static|async|readonly|override|export|default)\\s+)*${id}\\s*(?:<[^>]*>)?\\s*\\(`);
  const at = text.split(/\r?\n/).findIndex((line) => declared.test(line) || member.test(line));
  return at >= 0 ? at + 1 : null;
}

// The prompt hook only tries code-looking words; an explicit `legacies map` query tries every word.
// graphify ids ignore case, so a function and a type that differ only in case collapse into one node
// that points at one of them; with `root`, the other is found by reading its definition.
export function lookupSymbols(index, prompt, { limit = 6, maxPerName = 3, allWords = false, root = null } = {}) {
  if (!index) return [];
  const hits = [];
  const seen = new Set();
  const add = (hit) => {
    const key = `${hit.file}:${hit.loc}:${hit.label}`;
    if (seen.has(key)) return;
    seen.add(key);
    hits.push(hit);
  };
  const plain = allWords ? String(prompt).split(/[^A-Za-z0-9_$.]+/).filter((w) => w.length >= 3) : [];
  for (const word of new Set([...identifierCandidates(prompt), ...plain])) {
    const key = normLabel(word);
    // A cached index is parsed back into a plain object, so only its own keys count.
    const matches = Object.hasOwn(index.entries, key) ? index.entries[key] : null;
    if (!Array.isArray(matches)) continue;
    for (const [label, file, loc] of matches.slice(0, maxPerName)) {
      const bare = label.replace(/^\.+/, '').replace(/\(.*\)$/, '');
      if (root && bare !== word && /^[A-Za-z_$][\w$]*$/.test(word)) {
        const line = exactDefinitionLine(root, file, word);
        if (line && `L${line}` !== loc) add({ label: word, file, loc: `L${line}` });
      }
      add({ label, file, loc });
    }
    if (hits.length >= limit) break;
  }
  return hits.slice(0, limit);
}

// Plain-language lookup: ranks symbols whose names contain the query's words, rarer words weighing more.
// A multi-word name needs two of its words in the query, so "send message" finds sendMessage but not
// sendEmail; a single very rare word is enough on its own.
export function lookupSymbolWords(index, query, { limit = 3, maxPerName = 2, extraTerms = [] } = {}) {
  if (!index || !index.words) return [];
  const terms = queryTerms(query, extraTerms);
  if (terms.length === 0) return [];
  const vocabulary = Object.keys(index.words);
  const names = Object.keys(index.entries).length || 1;
  const scores = new Map();
  for (const term of terms) {
    const best = new Map();
    for (const word of vocabulary) {
      const match = stemMatch(word, term);
      if (!match) continue;
      const holders = index.words[word];
      const weight = match * Math.log(1 + names / holders.length);
      const rare = match === 2 && holders.length <= RARE_WORD_MAX_SYMBOLS;
      for (const name of holders) {
        const prev = best.get(name) || { weight: 0, rare: false };
        best.set(name, { weight: Math.max(prev.weight, weight), rare: prev.rare || rare });
      }
    }
    for (const [name, { weight, rare }] of best) {
      const s = scores.get(name) || { score: 0, terms: 0, rare: false };
      scores.set(name, { score: s.score + weight, terms: s.terms + 1, rare: s.rare || rare });
    }
  }
  const ranked = [...scores.entries()]
    .filter(([name, s]) => {
      if (!Object.hasOwn(index.entries, name)) return false;
      const size = new Set(tokenize(index.entries[name][0][0]).filter((w) => w.length >= 3)).size;
      return s.terms >= Math.min(2, size) || s.rare;
    })
    .sort((a, b) => b[1].score - a[1].score || b[1].terms - a[1].terms || a[0].length - b[0].length);
  if (ranked.length === 0) return [];
  const floor = ranked[0][1].score * WORD_MATCH_RELATIVE_FLOOR;
  const hits = [];
  for (const [name, s] of ranked) {
    if (s.score < floor || hits.length >= limit) break;
    for (const [label, file, loc] of index.entries[name].slice(0, maxPerName)) {
      if (hits.length < limit) hits.push({ label, file, loc });
    }
  }
  return hits;
}

// Finds an executable on PATH with plain filesystem checks; spawning `graphify --version` costs seconds.
export function findExecutable(name) {
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir.replace(/^"|"$/g, ''), name + ext);
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch {
        // Not in this directory.
      }
    }
  }
  return null;
}
