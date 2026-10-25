// Per-project packs and plugins: what the catalog offers, what this project has turned on, and the
// `claude plugin` calls and rule files that turn a selection into that state.
import path from 'node:path';
import { claude, MARKETPLACE } from './installer.mjs';
import { PERSONAL_MARKETPLACE } from './personal.mjs';
import { syncPackRules } from './rules.mjs';
import { readJson, samePath } from './util.mjs';

export const OFFICIAL = 'claude-plugins-official';
export const PACK_SCOPES = ['local', 'project'];
const KIND_LABEL = { skill: 'skill', agent: 'ajan', rule: 'kural', command: 'komut' };
const LSP = /^LSP \(([^;)\s]+)/;

export const packPluginId = (id) => `${MARKETPLACE}-${id}@${MARKETPLACE}`;
export function packIdOf(pluginId) {
  const match = new RegExp(`^${MARKETPLACE}-(.+)@${MARKETPLACE}$`).exec(pluginId);
  return match ? match[1] : null;
}

// Only packs that were built (packs/<id>/pack.json exists) can be installed.
export function loadCatalog(pluginRoot) {
  const file = path.join(pluginRoot, 'catalog', 'registry.json');
  const registry = readJson(file);
  if (!registry) throw new Error(`${file} okunamadı`);
  const packs = registry.packs
    .filter((p) => p.members.length)
    .map((p) => ({ ...p, manifest: readJson(path.join(pluginRoot, 'packs', p.id, 'pack.json')) }))
    .filter((p) => p.manifest);
  return { registry, packs, official: registry.official || [] };
}

// This folder's plugins from `claude plugin list --json`. Local scope wins over project scope, as in
// Claude Code; `scopes` lists every scope the plugin is installed at here.
export function projectPlugins(listed, root) {
  const here = new Map();
  for (const p of listed) {
    if (p.scope === 'user' || !samePath(p.projectPath, root)) continue;
    const previous = here.get(p.id);
    const effective = previous && p.scope !== 'local' ? previous : { scope: p.scope, on: Boolean(p.projectEnabled || p.enabled) };
    here.set(p.id, { scope: effective.scope, on: effective.on, scopes: [...(previous?.scopes || []), p.scope] });
  }
  return here;
}

function packContents(manifest) {
  const counts = {};
  for (const m of manifest?.members || []) counts[m.kind] = (counts[m.kind] || 0) + 1;
  return Object.keys(KIND_LABEL).filter((kind) => counts[kind]).map((kind) => `${counts[kind]} ${KIND_LABEL[kind]}`).join(', ');
}

function officialHint(plugin, hasBinary) {
  const brings = plugin.brings || '';
  const lsp = LSP.exec(brings);
  if (lsp) return hasBinary(lsp[1]) ? `dil sunucusu: ${lsp[1]} kurulu` : `dil sunucusu: önce ${lsp[1]} kurulmalı`;
  if (/hook/i.test(brings)) return 'hook ekliyor; açmadan önce incele';
  if (/mcp/i.test(brings)) return /oauth/i.test(brings) ? 'MCP sunucusu, OAuth ister' : 'MCP sunucusu ekliyor';
  if (/unknown/i.test(brings)) return 'içeriği yerelde doğrulanmadı';
  return brings;
}

// An official plugin is pre-checked only when turning it on cannot surprise: no hooks, no MCP server,
// nothing unverified, and for a language server only when its binary is installed.
function safeToPrecheck(plugin, hasBinary) {
  const brings = plugin.brings || '';
  const lsp = LSP.exec(brings);
  if (lsp) return hasBinary(lsp[1]);
  return Boolean(brings) && !/hook|mcp|unknown/i.test(brings);
}

export function buildGroups({ catalog, detection, plugins, personal = [], hasBinary = () => false }) {
  const on = (id) => plugins.get(id)?.on === true;
  const packHits = new Map(detection.packs.map((d) => [d.id, d]));
  const officialHits = new Map(detection.official.map((d) => [d.name, d]));
  const packOption = (pack) => {
    const hit = packHits.get(pack.id);
    const value = packPluginId(pack.id);
    const hint = [hit ? null : pack.layer, packContents(pack.manifest), hit?.reasons.slice(0, 2).join(', ')].filter(Boolean).join(' · ');
    return { value, label: pack.id, hint, checked: on(value) || Boolean(hit && !hit.weak) };
  };
  const officialOption = (plugin) => {
    const hit = officialHits.get(plugin.name);
    const value = `${plugin.name}@${OFFICIAL}`;
    const hint = [officialHint(plugin, hasBinary), hit?.reasons[0]].filter(Boolean).join(' · ');
    return { value, label: `${plugin.name} (resmi)`, hint, checked: on(value) || Boolean(hit && !hit.weak && safeToPrecheck(plugin, hasBinary)) };
  };
  const mine = personal.map((p) => {
    const value = `${p.name}@${PERSONAL_MARKETPLACE}`;
    return { value, label: p.name, hint: p.description || '', checked: on(value) };
  });
  return [
    { title: 'Bu projede tespit edilenler', options: [...catalog.packs.filter((p) => packHits.has(p.id)).map(packOption), ...catalog.official.filter((o) => officialHits.has(o.name)).map(officialOption)] },
    { title: 'Diğer legacies paketleri', options: catalog.packs.filter((p) => !packHits.has(p.id)).map(packOption) },
    { title: 'Kendi eklediklerin', options: mine },
    { title: "Diğer resmi plugin'ler", options: catalog.official.filter((o) => !officialHits.has(o.name)).map(officialOption) },
  ].filter((g) => g.options.length);
}

// What to run so that exactly `selected` (out of `options`) is on in this project.
export function planPackChanges({ selected, options, plugins, scope }) {
  const add = [];
  const remove = [];
  for (const id of options) {
    const current = plugins.get(id);
    if (selected.has(id) && !current?.on) add.push({ id, action: current ? 'enable' : 'install', scope });
    if (selected.has(id) || !current?.on) continue;
    // Turning a plugin off keeps it installed, so turning it on again is instant and nobody hesitates to
    // switch one off. One the team enabled in .claude/settings.json is turned off only for this user.
    remove.push({ id, action: 'disable', scope: current.scope === 'local' || scope === 'project' ? current.scope : 'local' });
  }
  return { add, remove };
}

// Command-line names: a pack id, an official plugin name, a personal plugin name or a full plugin id.
export function resolvePluginIds(names, { catalog, personal }) {
  const ids = [];
  const unknown = [];
  for (const name of names) {
    if (name.includes('@')) ids.push(name);
    else if (catalog.packs.some((p) => p.id === name)) ids.push(packPluginId(name));
    else if (catalog.official.some((o) => o.name === name)) ids.push(`${name}@${OFFICIAL}`);
    else if (personal.some((p) => p.name === name)) ids.push(`${name}@${PERSONAL_MARKETPLACE}`);
    else unknown.push(name);
  }
  return { ids, unknown };
}

// One runnable step per change, in an order that never leaves a pack without its marketplace.
// `packsAfter` is called when the rules step runs, so packs whose step failed keep their old rules state.
export function changeSteps({ pluginRoot, root, scope, changes, packsAfter, marketplaces }) {
  const steps = [];
  const known = (name) => marketplaces.some((m) => m.name === name);
  const addsPack = changes.add.some((c) => packIdOf(c.id));
  if (addsPack && !known(MARKETPLACE)) {
    steps.push({ title: 'legacies marketplace kaydı', run: async () => (await claude(['plugin', 'marketplace', 'add', pluginRoot], { cwd: root }), 'eklendi') });
  } else if (addsPack) {
    steps.push({ title: 'legacies paket listesi', run: async () => (await claude(['plugin', 'marketplace', 'update', MARKETPLACE], { cwd: root }), 'güncel') });
  }
  for (const change of changes.add) {
    const args = change.action === 'install' ? ['plugin', 'install', change.id, '--scope', change.scope] : ['plugin', 'enable', change.id, '--scope', change.scope];
    steps.push({ change, title: `${change.id} açılıyor`, run: async () => (await claude(args, { cwd: root }), change.action === 'install' ? 'kuruldu' : 'açıldı') });
  }
  // Off keeps a plugin installed; only `legacies packs remove` uninstalls one.
  for (const change of changes.remove) {
    const uninstall = change.action === 'uninstall';
    const args = uninstall ? ['plugin', 'uninstall', change.id, '--scope', change.scope, '-y'] : ['plugin', 'disable', change.id, '--scope', change.scope];
    steps.push({ change, title: `${change.id} ${uninstall ? 'siliniyor' : 'kapatılıyor'}`, run: async () => (await claude(args, { cwd: root }), uninstall ? 'silindi' : 'kapatıldı; kurulu kalır') });
  }
  steps.push({
    title: 'Paket kuralları (.claude/rules)',
    run: async () => {
      const r = syncPackRules(pluginRoot, root, packsAfter(), { exclude: scope === 'local' });
      return `${r.count} kural${r.removed ? `, ${r.removed} kaldırıldı` : ''}`;
    },
  });
  return steps;
}
