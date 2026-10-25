#!/usr/bin/env node
// `legacies packs` and `legacies catalog`: per-project technology packs and the user's own skills.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addToCatalog, changePacks, choosePacks, describeSuggestions, inspectProject, printGroups, removeFromCatalog, removePacks } from './lib/packflow.mjs';
import { PACK_SCOPES } from './lib/packs.mjs';
import { listPersonal } from './lib/personal.mjs';
import { findProjectRoot } from './lib/project.mjs';
import * as ui from './lib/tui.mjs';
import { readJson } from './lib/util.mjs';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = (readJson(path.join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json'), {}) || {}).version || '?';

const HELP = `legacies packs — projeye özel teknoloji paketleri

Kullanım (projenin klasöründe):
  legacies packs                      tespit + seçim ekranı (önerilenler işaretli gelir)
  legacies packs suggest [--json]     bu projede tespit edilen paketler ve resmi plugin'ler
  legacies packs list [--json]        tüm katalog; bu projede açık olanlar [x]
  legacies packs on <ad...>           paket, resmi plugin ya da kendi eklediğin plugin'i aç (eski adı: add)
  legacies packs off <ad...>          kapat (kurulu kalır; yeniden açmak anında)
  legacies packs remove <ad...>       sil: kaldırır ve kurallarını çeker; önce "Emin misin?" diye sorar
                                      (--yes ile sormadan)
    ad: paket kimliği (react), resmi plugin adı (vercel) ya da tam kimlik (prisma@claude-plugins-official)
  Seçenekler: --scope local|project (varsayılan local: yalnız bu bilgisayar; project: ekiple paylaşılır)
              --yes (önerilenleri sormadan uygula)  --dry-run  --no-anim

legacies catalog — kendi skill'lerin
  legacies catalog add <klasör|git-url> [--name <ad>]   skill, skill klasörü ya da plugin ekle
  legacies catalog list
  legacies catalog remove <ad>
`;

function parseFlags(argv) {
  const flags = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) flags._.push(a);
    else if (a === '--scope' || a === '--name') flags[a.slice(2)] = argv[(i += 1)];
    else if (a.startsWith('--no-')) flags[a.slice(5)] = false;
    else flags[a.slice(2)] = true;
  }
  return flags;
}

function projectRoot() {
  const root = findProjectRoot(process.cwd());
  if (!root) throw new Error('Proje klasörü bulunamadı: paketler proje başına kurulur, komutu projenin klasöründe (.git ya da .legacies olan) çalıştır.');
  return root;
}

function scopeOf(flags) {
  const scope = flags.scope || 'local';
  if (!PACK_SCOPES.includes(scope)) throw new Error(`--scope ${scope} olmaz: paketler proje başına kurulur (local ya da project).`);
  return scope;
}

async function packs(flags) {
  const [action, ...names] = flags._;
  const root = projectRoot();
  if (!action) {
    if (!ui.interactive && !flags.yes) {
      printGroups((await inspectProject(PLUGIN_ROOT, root)).groups);
      process.stdout.write('\nSeçmek için terminalde `legacies packs`, ya da `legacies packs on <ad>`.\n');
      return;
    }
    await ui.banner(`v${VERSION} · proje paketleri · ${path.basename(root)}`);
    await choosePacks({ pluginRoot: PLUGIN_ROOT, root, scope: scopeOf(flags), yes: Boolean(flags.yes), dryRun: Boolean(flags['dry-run']) });
    return;
  }
  if (action === 'suggest' || action === 'list') {
    const info = await inspectProject(PLUGIN_ROOT, root);
    const data = action === 'suggest' ? { root, ...describeSuggestions(info) } : { root, groups: info.groups };
    if (flags.json) process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
    else if (action === 'list') printGroups(info.groups);
    else printGroups(info.groups.slice(0, 1));
    return;
  }
  if (['on', 'add', 'off', 'remove'].includes(action) && !names.length) throw new Error(`Kullanım: legacies packs ${action} <ad...>`);
  // Deleting is a separate, confirmed step; off only turns a pack off.
  if (action === 'remove') {
    await removePacks({ pluginRoot: PLUGIN_ROOT, root, names, scope: scopeOf(flags), yes: Boolean(flags.yes) });
    return;
  }
  // on/off are the names users see; add is kept for scripts written against earlier versions.
  const enable = { on: true, add: true, off: false }[action];
  if (enable !== undefined) {
    await changePacks({ pluginRoot: PLUGIN_ROOT, root, names, enable, scope: scopeOf(flags) });
    return;
  }
  process.stdout.write(HELP);
  process.exitCode = 2;
}

async function catalog(flags) {
  const [action, target] = flags._;
  if (action === 'add' && target) {
    const imported = await addToCatalog(target, { name: flags.name });
    ui.item('ok', `${imported.name} kişisel kataloğa eklendi`, `${imported.skills.length} skill: ${imported.skills.join(', ')}`);
    ui.detail(`Bir projede açmak için o projede: legacies packs on ${imported.name}`);
    return;
  }
  if (action === 'list') {
    const items = listPersonal();
    if (!items.length) process.stdout.write('Kişisel katalog boş. Eklemek için: legacies catalog add <klasör|git-url>\n');
    for (const p of items) process.stdout.write(`- ${p.name} · ${p.description || ''} · kaynak: ${p.source || '?'}${p.commit ? `@${p.commit.slice(0, 8)}` : ''}\n`);
    return;
  }
  if (action === 'remove' && target) {
    await removeFromCatalog(target);
    ui.item('ok', `${target} kişisel katalogdan ve açık olduğu projelerden kaldırıldı`);
    return;
  }
  process.stdout.write(HELP);
  process.exitCode = 2;
}

const [mode, ...rest] = process.argv.slice(2);
const flags = parseFlags(rest);
ui.setAnimation(flags.anim !== false);
try {
  if (flags.help || !['packs', 'catalog'].includes(mode)) process.stdout.write(HELP);
  else await (mode === 'packs' ? packs(flags) : catalog(flags));
} catch (err) {
  process.stderr.write(`legacies ${mode}: ${err.message}\n`);
  process.exitCode = 1;
}
