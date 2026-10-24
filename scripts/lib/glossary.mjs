import fs from 'node:fs';
import path from 'node:path';
import { tokenize } from './search.mjs';
import { foldTurkish, readJson, readText, writeAtomic } from './util.mjs';

// The project's own translation files say which English words its Turkish words stand for: the same
// key holds "Sandığı aç" and "Open chest", and the key itself is named in code vocabulary. Counting
// which words keep appearing together gives a glossary, so a Turkish question can reach English code.
const GLOSSARY_VERSION = 3;
const MIN_PAIR_KEYS = 2;
const MIN_DICE = 0.15;
const MAX_TRANSLATIONS = 3;
const MAX_EXPANSIONS = 8;
const MIN_STEM = 4;
// A pair seen in only a couple of keys is weak evidence however well it scores: weight = keys / (keys + 2).
const EVIDENCE_PRIOR = 2;
// A suffixed form ("sandıktan") is a slightly weaker match than the word itself.
const FORM_MATCH_WEIGHT = 0.7;
// Turkish softens a final k, p or t before a vowel suffix (sandık -> sandığı, kitap -> kitabı, kanat -> kanadı).
const SOFTENED = { k: 'g', p: 'b', t: 'd' };
const MESSAGE_FILE = /\.(?:json|arb|ya?ml|po|properties|xml|strings|resx)$/i;
const TR_TOKEN = /^tr(?:[-_]tr)?$/i;
const EN_TOKENS = ['en', 'en-US', 'en_US', 'en-GB', 'en_GB'];
const ICU_WORDS = new Set(['plural', 'select', 'selectordinal', 'other', 'one', 'few', 'many', 'zero']);

// A translation file is Turkish when its name or a folder says so: tr.json, app_tr.arb, tr.yml,
// messages_tr.properties, Strings.tr.resx, locale/tr/LC_MESSAGES/*.po, values-tr/strings.xml,
// tr.lproj/*.strings. Its English counterpart swaps that token (or drops it: messages.properties,
// values/strings.xml, Strings.resx). gettext catalogs carry the English source themselves.
function isTurkish(file) {
  if (!MESSAGE_FILE.test(file)) return false;
  if (/\.xml$/i.test(file) && !/(^|\/)values-tr[^/]*\/strings\.xml$/i.test(file)) return false;
  const segments = file.split('/');
  const base = segments.pop().replace(MESSAGE_FILE, '');
  return base.split(/[._-]/).some((t) => /^tr$/i.test(t)) || segments.some((seg) => TR_TOKEN.test(seg) || /^values-tr/i.test(seg) || /^tr(?:[-_]tr)?\.lproj$/i.test(seg));
}

function englishCandidates(file) {
  const segments = file.split('/');
  const name = segments.pop();
  const ext = name.slice(name.search(MESSAGE_FILE));
  const base = name.slice(0, name.length - ext.length);
  const out = [];
  // Locale token in the file name: swap it, or drop it with its separator.
  const parts = base.split(/([._-])/);
  const at = parts.findIndex((p) => /^tr$/i.test(p));
  if (at >= 0) {
    for (const en of EN_TOKENS) out.push([...segments, parts.map((p, i) => (i === at ? en : p)).join('') + ext].join('/'));
    const dropped = parts.filter((_, i) => i !== at && !(i === at - 1 && /^[._-]$/.test(parts[i]))).join('').replace(/^[._-]|[._-]$/g, '');
    if (dropped) out.push([...segments, dropped + ext].join('/'));
  }
  // Locale folder: tr/ -> en/, values-tr/ -> values/, tr.lproj/ -> en.lproj/ or Base.lproj/.
  segments.forEach((segment, i) => {
    const swap = (to) => out.push([...segments.slice(0, i), to, ...segments.slice(i + 1), name].join('/'));
    if (TR_TOKEN.test(segment)) EN_TOKENS.forEach(swap);
    if (/^values-tr/i.test(segment)) swap('values');
    if (/^tr(?:[-_]tr)?\.lproj$/i.test(segment)) ['en.lproj', 'Base.lproj'].forEach(swap);
  });
  return out;
}

export function messageFilePairs(files) {
  const tracked = new Set(files);
  return files.filter(isTurkish).map((file) => ({ tr: file, en: /\.po$/i.test(file) ? null : englishCandidates(file).find((c) => tracked.has(c)) || null }));
}

const unquote = (v) => v.trim().replace(/^(['"])([\s\S]*)\1$/, '$2');
const xmlText = (v) => v.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;|\\'/g, "'").replace(/&amp;/g, '&');

// Key -> text for one translation file, whatever its format. YAML is read as nested "key: value" lines,
// which is how locale files are written; a leading locale key (tr:, en:) is dropped so both sides align.
function readMessages(root, file) {
  const text = readText(path.join(root, file), '');
  const out = new Map();
  if (/\.(?:json|arb)$/i.test(file)) {
    flatten(readJson(path.join(root, file)), '', out);
    for (const k of [...out.keys()]) if (k.split('.').pop().startsWith('@')) out.delete(k);
  } else if (/\.ya?ml$/i.test(file)) {
    const stack = [];
    for (const line of text.split(/\r?\n/)) {
      const m = /^(\s*)([^#:\s][^:]*?):(?:\s+(.*))?$/.exec(line);
      if (!m) continue;
      const depth = m[1].length;
      while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
      stack.push({ depth, key: unquote(m[2]) });
      if (m[3] && !/^[|>]/.test(m[3])) out.set(stack.map((e) => e.key).filter((k, i) => !(i === 0 && /^(tr|en)([-_]\w+)?$/i.test(k))).join('.'), unquote(m[3]));
    }
  } else if (/\.properties$/i.test(file)) {
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s*([^#!\s][^=:\s]*)\s*[=:\s]\s*(.*)$/.exec(line);
      if (m) out.set(m[1], m[2].replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))));
    }
  } else if (/\.xml$/i.test(file)) {
    for (const m of text.matchAll(/<string\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/string>/g)) out.set(m[1], xmlText(m[2]));
  } else if (/\.strings$/i.test(file)) {
    for (const m of text.matchAll(/"((?:[^"\\]|\\.)*)"\s*=\s*"((?:[^"\\]|\\.)*)"\s*;/g)) out.set(m[1], m[2]);
  } else if (/\.resx$/i.test(file)) {
    for (const m of text.matchAll(/<data\s+name="([^"]+)"[^>]*>\s*<value>([\s\S]*?)<\/value>/g)) out.set(m[1], xmlText(m[2]));
  } else if (/\.po$/i.test(file)) {
    // gettext: msgid is the English source, msgstr the translation; quoted continuation lines join up.
    const entry = { msgid: '', msgstr: '' };
    let field = null;
    const flush = () => {
      if (entry.msgid && entry.msgstr) out.set(entry.msgid, entry.msgstr);
      entry.msgid = '';
      entry.msgstr = '';
    };
    for (const line of text.split(/\r?\n/)) {
      const head = /^(msgid|msgstr)(?:\[\d+\])?\s+"(.*)"\s*$/.exec(line);
      const more = /^\s*"(.*)"\s*$/.exec(line);
      if (head) {
        if (head[1] === 'msgid') flush();
        field = head[1];
        entry[field] += head[2];
      } else if (field && more) {
        entry[field] += more[1];
      } else if (!line.trim()) {
        field = null;
      }
    }
    flush();
  }
  return out;
}

function flatten(value, prefix, out) {
  if (typeof value === 'string') out.set(prefix, value);
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  return out;
}

function wordsOf(text) {
  const plain = String(text).replace(/<[^>]*>|\{[\w.]+\}/g, ' ');
  return new Set(tokenize(plain).filter((t) => t.length >= 3 && !/^\d+$/.test(t) && !ICU_WORDS.has(t)));
}

// entries: [{ key, tr, en }]. Returns { turkishWord: [[englishWord, weight], ...] }, strongest first.
export function buildGlossary(entries) {
  const trCount = new Map();
  const enCount = new Map();
  const pairCount = new Map();
  const bump = (map, k) => map.set(k, (map.get(k) || 0) + 1);
  for (const { key, tr, en } of entries) {
    const trWords = wordsOf(tr);
    const enWords = new Set([...wordsOf(key.replace(/\./g, ' ')), ...(en ? wordsOf(en) : [])]);
    // Words written the same in both (brand names, untranslated text) translate nothing.
    for (const w of [...trWords]) if (enWords.has(w)) trWords.delete(w);
    if (trWords.size === 0 || enWords.size === 0) continue;
    for (const w of trWords) bump(trCount, w);
    for (const e of enWords) bump(enCount, e);
    for (const w of trWords) for (const e of enWords) bump(pairCount, `${w} ${e}`);
  }
  // No prototype: a word like "constructor" must not land on Object.prototype.
  const glossary = Object.create(null);
  for (const [pair, together] of pairCount) {
    if (together < MIN_PAIR_KEYS) continue;
    const [w, e] = pair.split(' ');
    const dice = (2 * together) / (trCount.get(w) + enCount.get(e));
    if (dice < MIN_DICE) continue;
    const weight = dice * (together / (together + EVIDENCE_PRIOR));
    (glossary[w] ||= []).push([e, Math.round(weight * 1000) / 1000]);
  }
  for (const w of Object.keys(glossary)) glossary[w] = glossary[w].sort((a, b) => b[1] - a[1]).slice(0, MAX_TRANSLATIONS);
  return glossary;
}

function fileStamp(root, file) {
  try {
    const stat = fs.statSync(path.join(root, file));
    return `${file}:${stat.size}:${stat.mtimeMs}`;
  } catch {
    return `${file}:missing`;
  }
}

// Built from the translation files on first use and cached until one of them changes.
export function glossaryIndex(paths, files) {
  const pairs = messageFilePairs(files);
  if (pairs.length === 0) return null;
  const key = [GLOSSARY_VERSION, ...pairs.flatMap((p) => [p.tr, p.en].filter(Boolean).map((f) => fileStamp(paths.root, f)))].join('|');
  const cacheFile = path.join(paths.runtime, 'glossary.json');
  let cached = readJson(cacheFile);
  if (!cached || cached.key !== key || !cached.words) {
    const entries = [];
    for (const pair of pairs) {
      const tr = readMessages(paths.root, pair.tr);
      // A gettext key is the English text itself.
      const gettext = /\.po$/i.test(pair.tr);
      const en = pair.en ? readMessages(paths.root, pair.en) : new Map();
      for (const [k, text] of tr) entries.push({ key: gettext ? '' : k, tr: text, en: gettext ? k : en.get(k) || '' });
    }
    cached = { key, words: buildGlossary(entries) };
    try {
      writeAtomic(cacheFile, JSON.stringify(cached));
    } catch {
      // A read-only checkout still gets the glossary for this call.
    }
  }
  return withPrefixIndex(cached.words);
}

function withPrefixIndex(words) {
  const byPrefix = new Map();
  for (const word of Object.keys(words)) {
    const head = word.slice(0, MIN_STEM);
    if (!byPrefix.has(head)) byPrefix.set(head, []);
    byPrefix.get(head).push(word);
  }
  return { words, byPrefix };
}

// Turkish letters, or a common Turkish word even when typed without them ("nerde", "nasil", "abi").
const TURKISH_LETTERS = /[çğıöşüÇĞİÖŞÜ]/;
const TURKISH_WORDS = new Set([
  've', 'bir', 'bu', 'su', 'ne', 'nerede', 'nerde', 'nereye', 'nasil', 'neden', 'niye', 'icin', 'ile', 'gibi', 'mi', 'mu',
  'var', 'yok', 'olan', 'oldu', 'oluyor', 'yapiyor', 'degil', 'abi', 'bi', 'hangi', 'kim', 'sonra', 'once', 'cok', 'daha',
  'ama', 'ya', 'da', 'de', 'ki', 'misin', 'neresi', 'nerden', 'nereden', 'kac', 'acaba', 'lazim', 'gerek', 'bak',
]);
export function looksTurkish(text) {
  return TURKISH_LETTERS.test(text) || foldTurkish(String(text)).toLowerCase().split(/[^a-z0-9]+/).some((w) => TURKISH_WORDS.has(w));
}

// One word is the other plus suffixes, allowing only the softened final consonant in between.
function sameStem(a, b) {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length < MIN_STEM) return false;
  if (long.startsWith(short)) return true;
  const head = short.slice(0, -1);
  return head.length >= MIN_STEM && long.startsWith(head) && SOFTENED[short.at(-1)] === long[short.length - 1];
}

// English words that the project's translations pair with the message's Turkish words, strongest first.
// English text is left alone: a Turkish stem can open an English word ("para" -> "parameter"). Words the
// project does not translate are left to the model, which reads the project's words with `legacies vocab`.
export function expandTerms(glossary, text) {
  if (!glossary || !looksTurkish(text)) return [];
  const terms = new Set(tokenize(text));
  const found = new Map();
  for (const term of terms) {
    if (term.length < 3) continue;
    const exact = Object.hasOwn(glossary.words, term) ? [term] : [];
    const forms = term.length >= MIN_STEM ? (glossary.byPrefix.get(term.slice(0, MIN_STEM)) || []).filter((w) => w !== term && sameStem(term, w)) : [];
    for (const word of [...exact, ...forms]) {
      const formWeight = word === term ? 1 : FORM_MATCH_WEIGHT;
      for (const [english, weight] of glossary.words[word]) {
        if (!terms.has(english)) found.set(english, Math.max(found.get(english) || 0, weight * formWeight));
      }
    }
  }
  return [...found.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_EXPANSIONS).map(([w]) => w);
}
