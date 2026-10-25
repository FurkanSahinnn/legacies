#!/usr/bin/env node
// legacies: per-project local memory for Claude Code (and any AI CLI that can run a shell command).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { codexHome, codexHooksEnabled, codexStatus, hasProjectCodex, installProjectCodex, launcherDir, onPath, PROJECT_CODEX_HOOKS, uninstallProjectCodex } from './lib/codex.mjs';
import {
  GRAPH_FILE,
  graphIndex,
  graphPath,
  lookupSymbols,
  lookupSymbolWords,
  matchPaths,
  trackedFiles,
} from './lib/codeindex.mjs';
import { buildContext, TEMPLATE_MARKER } from './lib/context.mjs';
import { memorySources, searchSources, workspaceBrief } from './lib/crossproject.mjs';
import { claudeCommand, PLUGIN_ID, spawnCommand } from './lib/installer.mjs';
import { KIND_LABEL, KINDS as MIGRATION_KINDS, migrationLines, nextItems, readPlan, refreshMigration, setStatus, startMigration, STATUSES } from './lib/migrate.mjs';
import { parseFrontmatter, stringifyFrontmatter, toList } from './lib/frontmatter.mjs';
import { expandTerms, glossaryIndex } from './lib/glossary.mjs';
import { affected, explain, loadGraph, pathBetween, querySubgraph } from './lib/graphquery.mjs';
import { BUILD_ARGS, GRAPHIFY_ADVICE, graphifyCommand, runGraphify, startGraphify, UPDATE_ARGS } from './lib/graphify.mjs';
import { contentIndex, lookupContent, projectVocabulary } from './lib/content.mjs';
import { docIndex, lookupDocs } from './lib/docindex.mjs';
import { HANDLERS } from './lib/hooks.mjs';
import { findStale, listMarkdown, loadNotes, NOTE_TYPES, writeIndex } from './lib/notes.mjs';
import { commitsSince, excludePattern, findProjectRoot, git, gitHead, hasMemory, isGitRepo, MEMORY_DIRNAME, memoryPaths } from './lib/project.mjs';
import { bundledRules, installedRuleName, installRules, projectRulesDir, uninstallRules, unscopedBytes } from './lib/rules.mjs';
import { currentSessionFile, logError, pluginDataDir, record, registerProject } from './lib/runtime.mjs';
import { listCards, writeCard } from './lib/sessions.mjs';
import { claudeConfigDir, dateStamp, ensureDir, exists, readJson, readText, samePath, slugify, toPosix, writeAtomic } from './lib/util.mjs';
import { addToWorkspace, deleteWorkspace, listWorkspaces, readWorkspace, removeFromWorkspace, WORKSPACE_ENV, workspacePaths, workspacesOf } from './lib/workspace.mjs';

class UsageError extends Error {}

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const PLUGIN_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      args._.push(a);
      continue;
    }
    const key = a.slice(2);
    const eq = key.indexOf('=');
    if (eq !== -1) args[key.slice(0, eq)] = key.slice(eq + 1);
    else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) args[key] = argv[(i += 1)];
    else args[key] = true;
  }
  return args;
}

// Waits briefly for the first chunk, so a command run without piped input does not hang.
function readStdin({ firstChunkMs = 1500, totalMs = 10000, limit = 4 * 1024 * 1024 } = {}) {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      resolve('');
      return;
    }
    const chunks = [];
    let size = 0;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(first);
      clearTimeout(total);
      process.stdin.removeAllListeners();
      process.stdin.destroy();
      resolve(Buffer.concat(chunks).toString('utf8'));
    };
    const first = setTimeout(() => {
      if (size === 0) finish();
    }, firstChunkMs);
    const total = setTimeout(finish, totalMs);
    process.stdin.on('data', (chunk) => {
      size += chunk.length;
      if (size <= limit) chunks.push(chunk);
    });
    process.stdin.on('end', finish);
    process.stdin.on('error', finish);
  });
}

const out = (text = '') => process.stdout.write(`${text}\n`);

async function readBody(args) {
  if (typeof args.text === 'string') return args.text;
  if (typeof args.file === 'string') {
    const text = readText(path.resolve(args.file));
    if (text == null) throw new UsageError(`Dosya okunamadı: ${args.file}`);
    return text;
  }
  return readStdin();
}

// `--workspace <ad>` targets a workspace's shared memory, `--project <klasör>` another project's memory.
function requireMemory(args) {
  if (typeof args.workspace === 'string') {
    if (!readWorkspace(args.workspace)) throw new UsageError(`"${args.workspace}" adında bir çalışma alanı yok (legacies workspace list).`);
    return workspacePaths(args.workspace);
  }
  const start = typeof args.project === 'string' ? path.resolve(args.project) : args.root || process.cwd();
  const root = findProjectRoot(start);
  if (!hasMemory(root)) throw new UsageError(`${typeof args.project === 'string' ? args.project : 'Bu proje'} için .legacies/ yok. Önce o projede \`legacies init\` çalıştır (ya da /legacies:onboard).`);
  return memoryPaths(root);
}

// Where a memory file is, for messages: relative inside a project, prefixed for a workspace.
function shownPath(paths, file) {
  const rel = toPosix(path.relative(paths.base, file));
  return paths.workspace ? `[çalışma alanı ${paths.workspace}] ${rel}` : `${MEMORY_DIRNAME}/${rel}`;
}

function stamp(root) {
  const head = isGitRepo(root) ? gitHead(root) : null;
  return head ? `${dateStamp()}@${head}` : dateStamp();
}

// Claude Code exposes the session id to shell commands; other tools get one card per day.
function sessionIdFor(args) {
  if (typeof args.session === 'string') return args.session;
  return process.env.CLAUDE_CODE_SESSION_ID || process.env.CLAUDE_SESSION_ID || `manual-${dateStamp().replace(/-/g, '')}`;
}

function resolveMemoryFile(paths, target) {
  const clean = String(target).replace(/\\/g, '/').replace(new RegExp(`^(\\./)?${MEMORY_DIRNAME}/`), '');
  const candidates = [path.resolve(target), path.join(paths.base, clean), path.join(paths.memory, clean)];
  return candidates.find((c) => c.startsWith(paths.base) && exists(c) && fs.statSync(c).isFile()) || null;
}

function projectTemplate(root) {
  return `# ${path.basename(root)}

> ${TEMPLATE_MARKER}. En fazla ~150 satır; ayrıntılar memory/ notlarına gider.

## Amaç

## Stack

## Komutlar

## Mimari harita

## Önemli akışlar

## Kurallar ve konvansiyonlar

## Tuzaklar
`;
}

const STATE_TEMPLATE = `# Güncel durum

> Şu anki odak ve açık işler. Yerinde güncellenir, en fazla ~40 satır.

## Odak

## Açık işler

## Bekleyen kararlar
`;

function ensureExcluded(root, dirname = MEMORY_DIRNAME) {
  return excludePattern(root, `/${dirname}/`, dirname);
}

function cmdInit(args) {
  const start = path.resolve(args.root || process.cwd());
  const root = findProjectRoot(start) || start;
  const paths = memoryPaths(root);
  const created = [];
  for (const dir of [paths.base, paths.memory, ...NOTE_TYPES.map((t) => path.join(paths.memory, t)), paths.sessions, paths.runtime]) {
    if (!exists(dir)) {
      ensureDir(dir);
      created.push(`${toPosix(path.relative(root, dir))}/`);
    }
  }
  if (!exists(paths.project)) {
    writeAtomic(paths.project, projectTemplate(root));
    created.push(`${MEMORY_DIRNAME}/PROJECT.md`);
  }
  if (!exists(paths.state)) {
    writeAtomic(paths.state, STATE_TEMPLATE);
    created.push(`${MEMORY_DIRNAME}/STATE.md`);
  }
  writeIndex(paths);
  registerProject(root, { memory: true });
  out(`Proje kökü: ${root}`);
  out(created.length ? `Oluşturulanlar: ${created.join(', ')}` : 'Yapı zaten vardı; eksik bir şey yok.');
  out(`Git: ${isGitRepo(root) ? ensureExcluded(root) : 'git reposu değil, gizleme gerekmiyor'}`);
}

// The installer and pack screens live in scripts/setup.mjs and scripts/packs.mjs; these commands open them from any shell.
function runScript(script, mode, argv) {
  const res = spawnSync(process.execPath, [path.join(PLUGIN_ROOT, 'scripts', script), mode, ...argv], { stdio: 'inherit' });
  process.exitCode = res.status ?? 1;
}

function cmdContext(args) {
  const paths = requireMemory(args);
  out(
    buildContext({
      paths,
      source: typeof args.source === 'string' ? args.source : 'startup',
      sessionId: typeof args.session === 'string' ? args.session : process.env.CLAUDE_CODE_SESSION_ID || null,
      budget: args.budget ? Number(args.budget) : undefined,
      // Claude Code sets CLAUDECODE=1 for its shell; anything else (Codex, a plain terminal) gets CLI wording.
      harness: typeof args.harness === 'string' ? args.harness : process.env.CLAUDECODE ? 'claude' : 'cli',
    }),
  );
}

// One memory by default; --all adds the session's other projects and every workspace they belong to.
function searchTargets(args) {
  if (!args.all) {
    const paths = requireMemory(args);
    return [{ label: paths.workspace ? `çalışma alanı ${paths.workspace}` : path.basename(paths.root), paths }];
  }
  const root = findProjectRoot(process.cwd());
  const sources = memorySources({ root, sessionId: sessionIdFor(args), all: true });
  if (!sources.length) throw new UsageError('Aranacak hafıza yok: bu projede ve oturumun diğer projelerinde .legacies/ bulunamadı.');
  return sources;
}

function cmdSearch(args) {
  const query = args._.slice(1).join(' ').trim();
  if (!query) throw new UsageError('Kullanım: legacies search "<terimler>" [--limit 5] [--all | --project <klasör> | --workspace <ad>]');
  const sources = searchTargets(args);
  const results = searchSources(sources, query, { limit: Number(args.limit) || 5 });
  if (results.length === 0) {
    out(`"${query}" için hafızada eşleşme yok. Normal keşfe devam et; kalıcı bir şey öğrenirsen /legacies:remember ile kaydet.`);
    return;
  }
  const labelled = sources.length > 1 || Boolean(sources[0].paths.workspace) || typeof args.project === 'string';
  results.forEach((r, i) => {
    const code = r.paths.length ? `  (kod: ${r.paths.join(', ')})` : '';
    const where = labelled ? toPosix(path.join(r.base, r.rel)) : `${MEMORY_DIRNAME}/${r.rel}`;
    out(`${i + 1}. [${labelled ? `${r.label} · ` : ''}${r.kind}] ${r.title} — ${where}${code}`);
    if (r.snippet) out(`   ${r.snippet}`);
  });
}

async function cmdAdd(args) {
  const paths = requireMemory(args);
  const type = args.type;
  if (!NOTE_TYPES.includes(type)) throw new UsageError(`--type şunlardan biri olmalı: ${NOTE_TYPES.join(', ')}`);
  if (typeof args.title !== 'string' || !args.title.trim()) throw new UsageError('--title "<kısa iddia>" gerekli');
  const file = path.join(paths.memory, type, `${slugify(args.title)}.md`);
  const rel = shownPath(paths, file);
  if (exists(file) && !args.update) {
    throw new UsageError(`Bu başlıkta not zaten var: ${rel}. Değiştirmek için --update ekle ya da dosyayı düzenleyip \`legacies verify ${rel}\` çalıştır.`);
  }
  const body = (await readBody(args)).trim();
  const data = {
    title: args.title.trim(),
    type,
    summary: typeof args.summary === 'string' ? args.summary.trim() : '',
    paths: toList(args.paths),
    tags: toList(args.tags),
    verified: stamp(paths.root),
    status: 'active',
  };
  writeAtomic(file, stringifyFrontmatter(data, body ? `${body}\n` : ''));
  writeIndex(paths);
  out(`Not yazıldı: ${rel}`);
}

async function cmdHandoff(args) {
  const paths = requireMemory(args);
  const sid = sessionIdFor(args);
  if (args.skip) {
    record(paths, sid, { kind: 'skip', reason: typeof args.skip === 'string' ? args.skip : '' });
    out('Tamam: bu değişiklikler için devir kartı atlandı.');
    return;
  }
  const content = await readBody(args);
  if (!content.trim()) throw new UsageError('Devir kartı içeriği boş. Metni stdin (heredoc), --text ya da --file ile ver.');
  const file = writeCard(paths, sid, content);
  record(paths, sid, { kind: 'handoff' });
  out(`Devir kartı yazıldı: ${shownPath(paths, file)}`);
}

function cmdIndex(args) {
  const paths = requireMemory(args);
  const notes = loadNotes(paths);
  const stale = isGitRepo(paths.root) ? findStale(paths.root, notes) : new Map();
  writeIndex(paths, notes, stale);
  out(`Dizin güncellendi: ${notes.length} not${stale.size ? `, ${stale.size} tanesi doğrulanmalı` : ''}.`);
}

function cmdStale(args) {
  const paths = requireMemory(args);
  if (!isGitRepo(paths.root)) {
    out('Git reposu değil; bayatlık commit geçmişinden hesaplandığı için kontrol edilemiyor.');
    return;
  }
  const notes = loadNotes(paths);
  const stale = findStale(paths.root, notes);
  if (stale.size === 0) {
    out('Bayat not yok: notların işaret ettiği dosyalar doğrulandıklarından beri değişmedi.');
    return;
  }
  for (const note of notes.filter((n) => stale.has(n.rel))) {
    const files = stale.get(note.rel);
    out(`- ${note.title} — ${MEMORY_DIRNAME}/${note.rel} (doğrulandı: ${note.verified})`);
    out(`  değişenler: ${files.slice(0, 5).join(', ')}${files.length > 5 ? ` +${files.length - 5}` : ''}`);
  }
  out('Notu kodla karşılaştır, gerekirse düzelt, sonra `legacies verify <dosya>` çalıştır.');
}

function cmdVerify(args) {
  const paths = requireMemory(args);
  const target = args._[1];
  if (!target) throw new UsageError('Kullanım: legacies verify <PROJECT.md | memory/<tür>/<not>.md>');
  const file = resolveMemoryFile(paths, target);
  if (!file) throw new UsageError(`Hafızada böyle bir dosya yok: ${target}`);
  const { data, body } = parseFrontmatter(readText(file, ''));
  data.verified = stamp(paths.root);
  writeAtomic(file, stringifyFrontmatter(data, body));
  if (file.startsWith(paths.memory)) writeIndex(paths);
  out(`Doğrulandı: ${MEMORY_DIRNAME}/${toPosix(path.relative(paths.base, file))} → ${data.verified}`);
}

const GRAPH_QUESTIONS = ['explain', 'path', 'affected', 'query'];
const GRAPHIFY_MISSING = 'graphify kurulu değil. Kurmak için projede: legacies setup';

function requireGraphify() {
  if (!graphifyCommand()) throw new UsageError(GRAPHIFY_MISSING);
}


// What a question points at: symbols by exact name or by the words inside their names (with the
// glossary's translations), and files by path.
function codeMatches(paths, query) {
  const index = graphIndex(paths);
  const tracked = trackedFiles(paths);
  const extraTerms = expandTerms(glossaryIndex(paths, tracked), query);
  const exact = lookupSymbols(index, query, { limit: 10, allWords: true, root: paths.root });
  const content = lookupContent(contentIndex(paths, tracked), query, { limit: 4, extraTerms });
  const routes = content.filter((c) => c.label);
  const sameAs = (s) => (e) => e.file === s.file && e.loc === s.loc;
  const documented = lookupDocs(docIndex(paths), query, { limit: 4, extraTerms }).filter((s) => ![...exact, ...routes].some(sameAs(s)));
  const strong = documented.filter((d) => d.strong);
  const named = lookupSymbolWords(index, query, { limit: 6, extraTerms }).filter((s) => ![...exact, ...strong, ...routes].some(sameAs(s)));
  const weak = documented.filter((d) => !d.strong && !named.some(sameAs(d)));
  // An exact name, then documentation that covers the question, then words inside a symbol's name, then other
  // documentation matches, then files whose own words match (routes with their method and URL), then paths.
  const files = [...new Set([...content.filter((c) => !c.label).map((c) => c.file), ...matchPaths(tracked, query, { limit: 8, extraTerms })])];
  return { index, extraTerms, symbols: [...exact, ...strong, ...named, ...weak, ...routes], files };
}

function cmdMap(args) {
  const paths = requireMemory(args);
  const query = args._.slice(1).join(' ').trim();
  if (!query) throw new UsageError('Kullanım: legacies map "<soru ya da tanımlayıcı>" [--deep]');
  const { index, extraTerms, symbols, files } = codeMatches(paths, query);
  if (extraTerms.length) out(`(Sözlük: ${extraTerms.join(', ')})`);
  if (symbols.length) {
    out('Semboller (kod grafı):');
    for (const s of symbols) out(`- ${s.label} — ${s.file}${s.loc ? `:${s.loc}` : ''}`);
  }
  if (files.length) {
    out('Dosyalar (yol eşleşmesi):');
    for (const f of files) out(`- ${f}`);
  }
  if (!index) out('(Kod grafı yok: sembol araması için `legacies graph build`.)');
  if (args.deep && index) {
    out('Bağlantılar:');
    out(querySubgraph(loadGraph(paths), symbols));
  } else if (!symbols.length && !files.length) {
    out('Eşleşme yok. Gerçek tanımlayıcı adlarıyla tekrar dene ya da normal aramaya geç.');
  }
}

const VOCAB_LINE_WIDTH = 100;

// The project's code words for translating a question asked in another language; with words given, which
// of them the project uses.
function cmdVocab(args) {
  const paths = requireMemory(args);
  const near = args._.slice(1).map((w) => w.toLowerCase());
  const limit = Number(args.limit) > 0 ? Number(args.limit) : undefined;
  const vocab = projectVocabulary(graphIndex(paths), contentIndex(paths, trackedFiles(paths)), { limit, near });
  if (near.length) {
    for (const [word, hits] of vocab.matches) out(`${word}: ${hits.length ? hits.map(([w, n]) => `${w} (${n})`).join(', ') : 'yok'}`);
    return;
  }
  if (vocab.words.length === 0) {
    out('Kelime bulunamadı: projede izlenen kod dosyası yok.');
    return;
  }
  out(`Projenin kod kelimeleri, en çok kullanılandan aza (${vocab.words.length}/${vocab.total}). Sorunun anlamına uyanlarla ara: legacies map "<kelimeler>"`);
  let line = '';
  for (const [word] of vocab.words) {
    if (line && line.length + word.length + 1 > VOCAB_LINE_WIDTH) {
      out(line);
      line = '';
    }
    line = line ? `${line} ${word}` : word;
  }
  if (line) out(line);
}

function cmdGraph(args) {
  const paths = requireMemory(args);
  const action = args._[1] || 'status';
  if (action === 'status') {
    const command = graphifyCommand();
    out(`graphify: ${command ? 'kurulu' : `kurulu değil (${GRAPHIFY_MISSING.split('. ')[1]})`}`);
    const index = graphIndex(paths);
    if (!index) {
      out(`Kod grafı: yok (${GRAPH_FILE})${command ? '. Oturum başında kendiliğinden kurulur; hemen kurmak için `legacies graph build`' : ''}`);
      return;
    }
    const behind = index.builtAt && isGitRepo(paths.root) ? commitsSince(paths.root, index.builtAt) : null;
    out(`Kod grafı: ${index.nodes} düğüm, ${Object.keys(index.entries).length} sembol adı`);
    out(`Kurulduğu commit: ${index.builtAt || 'bilinmiyor'}${behind ? ` (${behind} commit geride; \`legacies graph update\`)` : ''}`);
    return;
  }
  if (GRAPH_QUESTIONS.includes(action)) {
    const terms = args._.slice(2);
    if (terms.length === 0 || (action === 'path' && terms.length < 2)) throw new UsageError(`Kullanım: legacies graph ${action} "<ad>"${action === 'path' ? ' "<ad>"' : ''}`);
    // Answered here from a compact copy of the graph: no Python start-up, and bounded output.
    const graph = loadGraph(paths);
    if (!graph) throw new UsageError('Kod grafı henüz yok: `legacies graph build`');
    if (action === 'explain') out(explain(graph, terms.join(' ')));
    else if (action === 'affected') out(affected(graph, terms.join(' ')));
    else if (action === 'path') out(pathBetween(graph, terms[0], terms[1]));
    else out(querySubgraph(graph, codeMatches(paths, terms.join(' ')).symbols));
    return;
  }
  if (action !== 'build' && action !== 'update') throw new UsageError('Kullanım: legacies graph [status|build|update|explain|path|affected|query]');
  requireGraphify();
  const graphArgs = action === 'build' ? BUILD_ARGS : UPDATE_ARGS;
  if (args.background) {
    startGraphify(paths, graphArgs);
    out(`graphify ${graphArgs.join(' ')} arka planda başladı; durum: legacies graph status`);
    return;
  }
  out(`Çalıştırılıyor: graphify ${graphArgs.join(' ')} (yalnız AST, LLM yok)`);
  const res = runGraphify(paths, graphArgs);
  // graphify ends with a next step (cluster-only, its site) that legacies never takes; only its progress is shown.
  const shown = `${res.stdout || ''}${res.stderr || ''}`.split(/\r?\n/).filter((line) => line.trim() && !GRAPHIFY_ADVICE.test(line));
  if (shown.length) out(shown.join('\n'));
  if (res.status !== 0) throw new Error(`graphify ${action} başarısız (çıkış kodu ${res.status ?? res.signal})`);
  const index = graphIndex(paths);
  out(index ? `Hazır: ${index.nodes} düğüm.` : 'graphify bitti ama graph.json okunamadı.');
}

// The Codex adapter is per project, like the plugin: <repo>/.codex/hooks.json, kept out of git.
function cmdCodex(args) {
  const action = args._[1] || 'status';
  const root = findProjectRoot(args.root || process.cwd());
  if (action === 'status') {
    const s = codexStatus();
    out(`Codex klasörü: ${s.home}${s.exists ? '' : ' (yok)'}`);
    out(`config.toml [features] hooks = true: ${s.hooksEnabled ? 'evet' : 'HAYIR ⚠ Codex hook çalıştırmaz'}`);
    out(root ? `Bu projede legacies hook'ları (${PROJECT_CODEX_HOOKS}): ${hasProjectCodex(root) ? 'var' : 'yok; kurmak için legacies codex install'}` : 'Proje kökü bulunamadı (.git ya da .legacies olan bir klasörde çalıştır).');
    if (s.ourHooks || s.agentsBlock) out('⚠ Eski sürümün global adaptörü hâlâ ~/.codex içinde; kaldırmak için bir projede: legacies setup');
    const launcher = path.join(launcherDir(), process.platform === 'win32' ? 'legacies.cmd' : 'legacies');
    out(`legacies komutu: ${fs.existsSync(launcher) ? launcher : 'yok'}${onPath(launcherDir()) ? '' : ` ⚠ ${launcherDir()} PATH'te değil`}`);
    return;
  }
  if (action !== 'install' && action !== 'uninstall') throw new UsageError('Kullanım: legacies codex [status|install|uninstall]');
  if (!root) throw new UsageError('Codex adaptörü proje başına kurulur; bir proje klasöründe (.git ya da .legacies olan) çalıştır.');
  if (action === 'uninstall') {
    out(uninstallProjectCodex(root) ? `legacies hook'ları kaldırıldı (${PROJECT_CODEX_HOOKS}); diğer hook'lara dokunulmadı.` : "Bu projede legacies'in Codex hook'u yok.");
    return;
  }
  if (!fs.existsSync(codexHome())) throw new UsageError(`Codex klasörü bulunamadı: ${codexHome()}`);
  const r = installProjectCodex(SCRIPT_PATH, root);
  out(`Codex hook'ları yazıldı: ${r.file}`);
  if (r.git) out(`Git: ${r.git}`);
  if (!codexHooksEnabled()) out('⚠ ~/.codex/config.toml içinde [features] altında hooks = true yok; Codex hook çalıştırmaz.');
  out("Sıradaki adım: Codex'i bu projede aç, projeye güven ve /hooks ekranında legacies hook'larını onayla.");
}

// Rules go to <repo>/.claude/rules/ and stay out of git; legacies installs no rules for every project.
function rulesTarget(args) {
  const root = findProjectRoot(args.root || process.cwd());
  if (!root) throw new UsageError('Kurallar proje başına kurulur; bir proje klasöründe (.git ya da .legacies olan) çalıştır.');
  return { dir: projectRulesDir(root), root };
}

function cmdRules(args) {
  const action = args._[1] || 'status';
  const { dir: target, root: projectRoot } = rulesTarget(args);
  const rules = bundledRules(PLUGIN_ROOT);
  if (action === 'status') {
    if (rules.length === 0) {
      out('Pakette kural yok.');
      out(`Hedef: ${target}`);
      return;
    }
    const total = rules.reduce((n, r) => n + r.bytes, 0);
    for (const r of rules) {
      const installed = readText(path.join(target, installedRuleName(r.rel))) === r.text;
      out(`- ${r.rel} · ${r.scoped ? 'dosya türüne bağlı' : 'HER OTURUM'} · ${r.bytes} bayt${installed ? ' · kurulu' : ''}`);
    }
    const unscoped = unscopedBytes(rules);
    out(`Toplam ${total} bayt; her oturuma eklenen (kapsamsız) ${unscoped} bayt ≈ ${Math.round(unscoped / 4)} token.`);
    out(`Hedef: ${target}`);
    return;
  }
  if (action === 'install') {
    const r = installRules(PLUGIN_ROOT, target, { projectRoot });
    out(`${r.count} kural kuruldu: ${target} (legacies-*.md)`);
    if (r.git) out(`Git: ${r.git}`);
    if (projectRoot) registerProject(projectRoot, { rules: true });
    out('Kapsamlı kurallar yalnız eşleşen dosya okunduğunda yüklenir; değişiklikler yeni oturumda geçerli olur.');
    return;
  }
  if (action === 'uninstall') {
    const count = uninstallRules(target, { projectRoot });
    out(`legacies kuralları kaldırıldı (${count} dosya); senin kural dosyalarına dokunulmadı.`);
    return;
  }
  throw new UsageError('Kullanım: legacies rules [status|install|uninstall]');
}

function workspaceRoots(dirs) {
  return dirs.map((dir) => {
    const abs = path.resolve(dir);
    if (!exists(abs)) throw new UsageError(`Klasör yok: ${dir}`);
    return findProjectRoot(abs) || abs;
  });
}

function cmdWorkspace(args) {
  const [, action = 'list', name, ...dirs] = args._;
  if (action === 'list') {
    const all = listWorkspaces();
    if (!all.length) out('Çalışma alanı yok. Oluşturmak için: legacies workspace add <ad> <proje-klasörü>...');
    for (const w of all) out(`- ${w.name}: ${w.members.map((m) => `${m.label} (${m.path})`).join(', ')}`);
    return;
  }
  if (!name) throw new UsageError('Kullanım: legacies workspace [list|show|add|remove|delete] <ad> [proje-klasörü...]');
  if (action === 'add') {
    if (!dirs.length) throw new UsageError('Kullanım: legacies workspace add <ad> <proje-klasörü>...');
    const result = addToWorkspace(name, workspaceRoots(dirs));
    out(`${result.created ? 'Oluşturuldu' : 'Güncellendi'}: ${name} · üyeler: ${result.members.map((m) => m.label).join(', ')}`);
    out(`Ortak hafıza (bu bilgisayarda, hiçbir reponun içinde değil): ${workspacePaths(name).base}`);
    for (const m of result.members.filter((x) => !hasMemory(x.path))) out(`  ${m.label}: legacies hafızası yok; istersen o projede /legacies:onboard`);
    out(`Birlikte açmak için: legacies open ${name}`);
    return;
  }
  const workspace = readWorkspace(name);
  if (!workspace) throw new UsageError(`"${name}" adında bir çalışma alanı yok (legacies workspace list).`);
  if (action === 'show') out(workspaceBrief(workspace, { budget: 8000, currentRoot: findProjectRoot(process.cwd()) }));
  else if (action === 'remove') {
    if (!dirs.length) throw new UsageError('Kullanım: legacies workspace remove <ad> <proje-klasörü>');
    const left = removeFromWorkspace(name, workspaceRoots(dirs)[0]);
    out(`Çıkarıldı. Kalan üyeler: ${left.map((m) => m.label).join(', ') || 'yok'}`);
  } else if (action === 'delete') {
    if (!args.yes) throw new UsageError(`Bu, "${name}" çalışma alanını ortak notları ve göç planlarıyla birlikte siler. Onaylamak için --yes ekle.`);
    deleteWorkspace(name);
    out(`Silindi: ${name}. Üye projelerin kendi .legacies/ hafızalarına dokunulmadı.`);
  } else throw new UsageError('Kullanım: legacies workspace [list|show|add|remove|delete] <ad> [proje-klasörü...]');
}

// Starts Claude Code in one member with the others added, so all of them are readable and editable;
// the workspace name tells the session-start hook to brief the other members.
function cmdOpen(args) {
  const workspace = readWorkspace(args._[1]);
  if (!workspace) throw new UsageError('Kullanım: legacies open <çalışma-alanı> [--from <üye-klasörü>] (liste: legacies workspace list)');
  const here = findProjectRoot(process.cwd());
  const from = typeof args.from === 'string' ? workspaceRoots([args.from])[0] : null;
  const primary = from || workspace.members.find((m) => here && samePath(m.path, here))?.path || workspace.members[0].path;
  const others = workspace.members.map((m) => m.path).filter((p) => !samePath(p, primary));
  const claudeArgs = others.flatMap((p) => ['--add-dir', p]);
  if (args['dry-run']) {
    out(`cd "${primary}" && ${WORKSPACE_ENV}=${workspace.name} CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1 claude ${claudeArgs.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`);
    return undefined;
  }
  const command = claudeCommand();
  if (!command) throw new UsageError('Claude Code CLI (claude) bulunamadı.');
  // CLAUDE.md files and rules of added directories load only with this variable.
  const env = { ...process.env, [WORKSPACE_ENV]: workspace.name, CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: '1' };
  return new Promise((resolve) => {
    const child = spawnCommand(command, claudeArgs, { cwd: primary, env, stdio: 'inherit' });
    child.on('error', (err) => {
      process.stderr.write(`legacies open: ${err.message}\n`);
      process.exitCode = 1;
      resolve();
    });
    child.on('exit', (code) => {
      process.exitCode = code ?? 1;
      resolve();
    });
  });
}

// Plans live in a workspace: the one named, the only one this project belongs to, or (for start)
// one that holds both projects; start creates it when none does.
function migrationWorkspace(args, { from = null, to = null } = {}) {
  if (typeof args.workspace === 'string') {
    if (!readWorkspace(args.workspace)) throw new UsageError(`"${args.workspace}" adında bir çalışma alanı yok.`);
    return args.workspace;
  }
  if (from && to) {
    const both = listWorkspaces().find((w) => [from, to].every((r) => w.members.some((m) => samePath(m.path, r))));
    if (both) return both.name;
    const name = slugify(args._[2]);
    addToWorkspace(name, [from, to]);
    out(`"${name}" çalışma alanı oluşturuldu (üyeler: ${path.basename(from)}, ${path.basename(to)}).`);
    return name;
  }
  const mine = workspacesOf(findProjectRoot(process.cwd()));
  if (mine.length === 1) return mine[0].name;
  throw new UsageError(mine.length ? `Bu proje birden çok çalışma alanında; --workspace ile seç: ${mine.map((w) => w.name).join(', ')}` : 'Bu proje bir çalışma alanında değil; --workspace <ad> ver.');
}

function printNext(plan, limit) {
  const items = nextItems(plan, limit);
  if (!items.length) {
    out('Sırada bekleyen madde yok.');
    return;
  }
  out('Sıradaki maddeler:');
  for (const i of items) out(`- ${i.id} · ${i.source}${i.target ? ` → ${i.target}${i.match === 'name' ? ' (adı eşleşiyor, kontrol et)' : ''}` : ' → hedefte karşılığı yok'}`);
}

function cmdMigrate(args) {
  const [, action = 'status', plan, ...ids] = args._;
  if (action === 'start') {
    if (!plan || typeof args.from !== 'string' || typeof args.to !== 'string') throw new UsageError('Kullanım: legacies migrate start <ad> --from <kaynak> --to <hedef> [--kinds route,screen,...] [--workspace <ad>]');
    // The folders stay as given, so a monorepo's apps/web can be the source on its own.
    const [from, to] = [args.from, args.to].map((dir) => {
      if (!exists(path.resolve(dir))) throw new UsageError(`Klasör yok: ${dir}`);
      return path.resolve(dir);
    });
    const kinds = typeof args.kinds === 'string' ? args.kinds.split(',').map((k) => k.trim()).filter(Boolean) : null;
    const unknown = (kinds || []).filter((k) => !MIGRATION_KINDS.includes(k));
    if (unknown.length) throw new UsageError(`Bilinmeyen tür: ${unknown.join(', ')} (türler: ${MIGRATION_KINDS.join(', ')})`);
    const ws = workspacePaths(migrationWorkspace(args, { from: findProjectRoot(from) || from, to: findProjectRoot(to) || to }));
    const created = startMigration(ws, { name: plan, from, to, kinds });
    const counts = (kind) => created.items.filter((i) => i.kind === kind).length;
    out(`Göç planı: ${created.name} · ${created.items.length} madde (${created.kinds.map((k) => `${k} ${counts(k)}`).filter((t) => !t.endsWith(' 0')).join(', ')})`);
    out(`Hedefte karşılığı bulunan: ${created.items.filter((i) => i.match !== 'none').length} · liste: ${path.join(ws.migrations, `${created.name}.md`)}`);
    const left = Object.entries(created.excluded || {}).map(([k, n]) => `${KIND_LABEL[k]} (${n})`);
    const why = kinds ? 'seçtiğin türlerin dışında kaldı' : 'hedef bir mobil uygulama, sunucu kodu oraya taşınmaz';
    if (left.length) out(`Listeye alınmayanlar: ${left.join(', ')}; ${why}. Dahil etmek için --kinds ${MIGRATION_KINDS.join(',')}`);
    printNext(created, 10);
    return;
  }
  const ws = workspacePaths(migrationWorkspace(args));
  if (action === 'status' && !plan) {
    const lines = migrationLines(ws);
    out(lines.length ? lines.join('\n') : 'Bu çalışma alanında göç planı yok. Başlatmak için: legacies migrate start <ad> --from <kaynak> --to <hedef>');
    return;
  }
  if (!plan) throw new UsageError('Kullanım: legacies migrate [status|next|refresh|done|partial|skip|todo] <ad> [madde...]');
  if (action === 'status' || action === 'next') {
    const current = readPlan(ws, plan);
    if (!current) throw new UsageError(`"${plan}" adında bir göç yok.`);
    if (action === 'status') out(migrationLines(ws).find((l) => l.startsWith(`- ${plan}:`)) || plan);
    printNext(current, Number(args.limit) || 10);
  } else if (action === 'refresh') {
    const refreshed = refreshMigration(ws, plan);
    out(`Envanter tazelendi: ${refreshed.items.length} madde, durumlar korundu.`);
  } else if (STATUSES.includes(action)) {
    if (!ids.length) throw new UsageError(`Kullanım: legacies migrate ${action} <ad> <madde...> [--note "..."]`);
    const updated = setStatus(ws, plan, ids, action, typeof args.note === 'string' ? args.note : '');
    out(`${ids.length} madde: ${action}. ${migrationLines(ws).find((l) => l.startsWith(`- ${updated.name}:`)) || ''}`);
  } else throw new UsageError('Kullanım: legacies migrate [start|status|next|refresh|done|partial|skip|todo] ...');
}

// Whether legacies is on in this project, read from the settings files in Claude Code's order: this
// computer's (.claude/settings.local.json), the shared one (.claude/settings.json), then the user's. The
// first file that names the plugin decides. No `claude` call: it costs seconds and lists every project.
function pluginLine(root) {
  const sources = [
    ['.claude/settings.local.json', path.join(root, '.claude', 'settings.local.json')],
    ['.claude/settings.json', path.join(root, '.claude', 'settings.json')],
    [null, path.join(claudeConfigDir(), 'settings.json')],
  ];
  for (const [label, file] of sources) {
    const enabled = (readJson(file, {}) || {}).enabledPlugins;
    if (!enabled || !Object.hasOwn(enabled, PLUGIN_ID)) continue;
    const on = enabled[PLUGIN_ID] === true;
    if (!label) return `kullanıcı genelinde ${on ? 'açık' : 'kapalı'} (${file}) ⚠ legacies proje bazlı kurulur; bu klasörde legacies setup eski kurulumu kaldırıp projeye kurar`;
    return on ? `açık — ${label}` : `kapalı — ${label} (açmak için bu klasörde: legacies setup)`;
  }
  return 'kurulu değil (kurmak için bu klasörde: legacies setup)';
}

function cmdDoctor(args) {
  const [major] = process.versions.node.split('.').map(Number);
  out(`Node: ${process.versions.node}${major < 18 ? ' ⚠ en az 18 gerekli' : ''}`);
  const root = findProjectRoot(args.root || process.cwd());
  out(`Proje kökü: ${root || 'bulunamadı (.git ya da .legacies olan bir klasörde çalıştır)'}`);
  if (root) {
    out(`Eklenti (bu proje): ${pluginLine(root)}`);
    out(`Git: ${isGitRepo(root) ? 'evet' : 'hayır'}`);
    if (hasMemory(root)) {
      const paths = memoryPaths(root);
      const notes = loadNotes(paths);
      out(`Hafıza: ${paths.base}`);
      if (isGitRepo(root)) out(`Git'ten gizli: ${git(root, ['check-ignore', '-q', MEMORY_DIRNAME]) !== null ? 'evet' : 'HAYIR ⚠ `legacies init` çalıştır'}`);
      out(`Notlar: ${notes.length} · devir kartları: ${listCards(paths).length} · arşiv: ${listMarkdown(paths.archive).length}`);
      out(`PROJECT.md: ${readText(paths.project, '').includes(TEMPLATE_MARKER) ? 'şablon (doldurulmamış)' : 'dolu'}`);
      if (isGitRepo(root)) out(`Bayat not: ${findStale(root, notes).size}`);
      const current = readJson(currentSessionFile(paths));
      if (current) out(`Son oturum başlangıcı: ${current.at} (${current.source})`);
    } else {
      out('Hafıza: yok (`legacies init` ile kur)');
    }
  }
  out(`Plugin verisi: ${pluginDataDir()}`);
  const errors = readText(path.join(pluginDataDir(), 'errors.log'), '').trim().split('\n').filter(Boolean);
  out(errors.length ? `Son hatalar:\n  ${errors.slice(-3).join('\n  ')}` : 'Hook hatası kaydı yok.');
  if (process.env.LEGACIES_DISABLED === '1') out('⚠ LEGACIES_DISABLED=1: hook\'lar devre dışı.');
}

const HELP = `legacies — projeye özel yerel hafıza
Kullanım rehberi: ${path.join(PLUGIN_ROOT, 'docs', 'KULLANIM.md')}

Kullanım:
  legacies init                    .legacies/ yapısını kur (repo dosyaları değişmez)
  legacies context                 oturum başı bağlamını yazdır (Codex vb. için)
  legacies search "<terimler>"     hafızada ara (notlar, PROJECT, STATE, devir kartları)
  legacies add --type <tür> --title "<iddia>" [--paths a,b] [--tags x,y] [--summary "..."]
                                   not ekle (gövde: stdin, --text ya da --file)
                                   türler: ${NOTE_TYPES.join(', ')}
  legacies handoff                 bu oturumun devir kartını yaz (stdin, --text, --file)
  legacies handoff --skip "<neden>"  bu değişiklikler için kartı bilerek atla
  legacies verify <dosya>          notu (ya da PROJECT.md'yi) bugün ve HEAD ile doğrulanmış işaretle
  legacies stale                   doğrulandıktan sonra kodu değişmiş notlar
  legacies index                   memory/INDEX.md'yi yeniden üret
  legacies map "<soru>" [--deep]   ilgili sembolleri (kod grafı) ve dosyaları bul
  legacies vocab [kelime...]       projenin kod kelimeleri (başka dildeki soruyu çevirmek için);
                                   kelime verilirse projede hangileri geçiyor (--limit <n>)
  legacies graph [status|build|update]  kod grafını yönet: graphify, yalnız AST, LLM yok (--background)
  legacies graph explain|path|affected "<ad>"  bir sembolün bağlantıları, iki sembol arası yol, neyi etkilediği
  legacies rules [status|install|uninstall]  kodlama kurallarını bu projenin .claude/rules/ klasörüne
                                   git'e girmeden kur
  legacies codex [status|install|uninstall]  bu projenin Codex hook'ları (.codex/hooks.json, git'e girmez)
  legacies search "<terimler>" --all  oturumun diğer projeleri ve çalışma alanları dahil ara
                                   (--project <klasör> ya da --workspace <ad> ile tek bir hafıza)
  legacies add --workspace <ad> ...   projeler arası bir notu çalışma alanının ortak hafızasına yaz
  legacies handoff --project <klasör> başka bir projenin devir kartını yaz
  legacies workspace [list|show|add|remove|delete] <ad> [klasör...]  birlikte çalışılan projeler
  legacies open <çalışma-alanı>     Claude Code'u üyelerle birlikte aç (--add-dir; ortak bağlam)
  legacies migrate start <ad> --from <kaynak> --to <hedef>   projeler arası göç planı
  legacies migrate [status|next|refresh|done|partial|skip|todo] <ad> [madde...]
  legacies packs [suggest|list|on|off|remove]  bu projenin teknoloji paketleri (tespit + seçim ekranı)
  legacies catalog [add|list|remove]  kendi skill'lerin: projelerde paket gibi açılır
  legacies multiagent [on [denge]|off|set|role|reset]  çoklu ajan düzeni (ayar ekranı; default: bilgisayar varsayılanı)
  legacies doctor                  kurulum ve hafıza sağlık kontrolü
  legacies setup                   kurulum programını aç (bileşen ekle/çıkar, yeniden kur)
  legacies uninstall               legacies'i tamamen kaldır (hafızaları silmek isteğe bağlı)
`;

const COMMANDS = {
  init: cmdInit,
  context: cmdContext,
  search: cmdSearch,
  add: cmdAdd,
  handoff: cmdHandoff,
  index: cmdIndex,
  stale: cmdStale,
  verify: cmdVerify,
  map: cmdMap,
  vocab: cmdVocab,
  graph: cmdGraph,
  rules: cmdRules,
  codex: cmdCodex,
  workspace: cmdWorkspace,
  open: cmdOpen,
  migrate: cmdMigrate,
  doctor: cmdDoctor,
  setup: () => runScript('setup.mjs', 'install', process.argv.slice(3)),
  uninstall: () => runScript('setup.mjs', 'uninstall', process.argv.slice(3)),
  packs: () => runScript('packs.mjs', 'packs', process.argv.slice(3)),
  catalog: () => runScript('packs.mjs', 'catalog', process.argv.slice(3)),
  multiagent: () => runScript('multiagent.mjs', 'multiagent', process.argv.slice(3)),
};

// Claude Code and Codex send nearly the same payload; other clients may spell the ids differently.
function normalizeHookInput(input, harness) {
  const out = { ...input, harness: harness || input.harness || 'claude' };
  out.session_id = input.session_id || input.sessionId || input.conversation_id || input.conversationId || input.thread_id || null;
  out.cwd = input.cwd || input.workspace_root || (Array.isArray(input.workspacePaths) ? input.workspacePaths[0] : undefined) || process.cwd();
  out.tool_name = input.tool_name || input.toolName;
  out.tool_input = input.tool_input || input.toolInput;
  return out;
}

// Hooks always exit 0 and print nothing on failure: a memory problem must never break the session.
async function runHook(event, harness) {
  if (process.env.LEGACIES_DISABLED === '1') return;
  const handler = HANDLERS[event];
  if (!handler) return;
  try {
    const raw = await readStdin({ firstChunkMs: 3000, totalMs: 5000 });
    const result = handler(normalizeHookInput(raw.trim() ? JSON.parse(raw) : {}, harness));
    if (result) out(JSON.stringify(result));
  } catch (err) {
    logError(err, `hook ${event}`);
  }
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === 'hook') {
    const at = argv.indexOf('--harness');
    return runHook(argv[1], at !== -1 ? argv[at + 1] : null);
  }
  const args = parseArgs(argv);
  const command = COMMANDS[args._[0]];
  if (!command) {
    out(HELP);
    if (args._[0] && args._[0] !== 'help') process.exitCode = 2;
    return undefined;
  }
  return command(args);
}

main().catch((err) => {
  process.stderr.write(`legacies: ${err.message}\n`);
  process.exitCode = err instanceof UsageError ? 2 : 1;
});
