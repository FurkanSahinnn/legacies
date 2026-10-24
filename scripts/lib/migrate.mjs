// Migration plans between two projects of a workspace, such as a web client moving to its mobile app.
// The source project's routes, screens, API handlers, components, hooks, stores and services become a
// checklist, each item matched to what already exists in the target. The inventory is a heuristic
// starting point: sessions refine it, mark items done and add notes as they port.
import fs from 'node:fs';
import path from 'node:path';
import { scanProject } from './detect.mjs';
import { baseName, classify, normalizeName } from './routekeys.mjs';
import { ensureDir, readJson, slugify, writeAtomic } from './util.mjs';

export const STATUSES = ['todo', 'partial', 'done', 'skip'];
const MARK = { todo: '[ ]', partial: '[~]', done: '[x]', skip: '[-]' };
const KIND_LABEL = {
  route: 'Sayfalar ve rotalar', screen: 'Ekranlar', api: 'API uçları', component: 'Bileşenler', hook: 'Hook\'lar',
  store: 'Durum yönetimi', service: 'Servisler ve istemciler',
};
export const KINDS = Object.keys(KIND_LABEL);
export { KIND_LABEL };
// Route-like kinds match each other, so a web page can find the mobile screen that replaces it.
const COMPATIBLE = { route: ['route', 'screen'], screen: ['route', 'screen'] };
const NOISE = /(^|\/)(__tests__|__mocks__|tests?|e2e|stories|storybook|node_modules)(\/|$)|\.(test|spec|stories|d)\.[a-z]+$/i;
export function inventory(root, facts = scanProject(root)) {
  const expoRouter = facts.deps.npm.has('expo-router');
  return facts.files
    .filter((file) => !NOISE.test(file))
    .map((file) => ({ file, ...classify(file, { expoRouter }) }))
    .filter((unit) => unit.kind)
    .map((unit) => ({ ...unit, name: normalizeName(unit.key.split('/').filter(Boolean).pop() || 'home') }));
}

function matchTarget(unit, targets, targetFiles) {
  const kinds = COMPATIBLE[unit.kind] || [unit.kind];
  const exact = targets.find((t) => kinds.includes(t.kind) && t.key === unit.key);
  if (exact) return { target: exact.file, match: 'exact' };
  const named = targets.find((t) => kinds.includes(t.kind) && t.name === unit.name);
  if (named) return { target: named.file, match: 'name' };
  // A page only maps to a screen; a helper file with the same name is not its counterpart.
  if (COMPATIBLE[unit.kind]) return { target: null, match: 'none' };
  const file = targetFiles.find((f) => normalizeName(baseName(f)) === unit.name && /\.(tsx|jsx|ts|js|vue|svelte|dart|swift|kt)$/.test(f));
  return file ? { target: file, match: 'name' } : { target: null, match: 'none' };
}

const isMobileApp = (facts) => ['expo', 'expo-router', 'react-native'].some((d) => facts.deps.npm.has(d)) || facts.deps.pub.has('flutter');

function countKinds(units) {
  const counts = {};
  for (const u of units) counts[u.kind] = (counts[u.kind] || 0) + 1;
  return counts;
}

// Server API handlers do not move into a mobile app, so they stay out unless `kinds` asks for them.
function buildItems(fromRoot, toRoot, kinds = null) {
  const targetFacts = scanProject(toRoot);
  const wanted = kinds || KINDS.filter((k) => k !== 'api' || !isMobileApp(targetFacts));
  const all = inventory(fromRoot);
  const source = all.filter((u) => wanted.includes(u.kind));
  const targets = inventory(toRoot, targetFacts);
  const used = new Set();
  const items = source.map((unit) => {
    let id = `${unit.kind}:${unit.key.replace(/^\//, '') || 'home'}`;
    for (let n = 2; used.has(id); n += 1) id = `${unit.kind}:${unit.key.replace(/^\//, '') || 'home'}-${n}`;
    used.add(id);
    return { id, kind: unit.kind, source: unit.file, ...matchTarget(unit, targets, targetFacts.files), status: 'todo', note: '' };
  });
  return { items, kinds: wanted, excluded: countKinds(all.filter((u) => !wanted.includes(u.kind))) };
}

const planFile = (paths, name) => path.join(paths.migrations, `${name}.json`);
export const readPlan = (paths, name) => readJson(planFile(paths, name));

export function listPlans(paths) {
  try {
    return fs.readdirSync(paths.migrations).filter((f) => f.endsWith('.json')).map((f) => readJson(path.join(paths.migrations, f))).filter(Boolean);
  } catch {
    return [];
  }
}

export function renderPlan(plan) {
  const counts = countByStatus(plan);
  const lines = [
    `# Göç: ${plan.name}`,
    '',
    `Kaynak: ${plan.from}`,
    `Hedef: ${plan.to}`,
    `Durum: ${counts.done}/${plan.items.length} tamam · ${counts.partial} kısmi · ${counts.skip} atlandı · güncelleme ${plan.updatedAt}`,
    '',
    '> `legacies migrate` üretir; durumları `legacies migrate done|partial|skip|todo` ile değiştir. Liste sezgiseldir: eksik ya da gereksiz maddeleri not düşerek atla.',
    '',
  ];
  for (const kind of KINDS) {
    const items = plan.items.filter((i) => i.kind === kind);
    if (!items.length) continue;
    lines.push(`## ${KIND_LABEL[kind]} (${items.length})`);
    for (const i of items) {
      const target = i.target ? ` → ${i.target}${i.match === 'name' ? ' (adı eşleşiyor, kontrol et)' : ''}` : ' → hedefte karşılığı yok';
      lines.push(`- ${MARK[i.status]} \`${i.id}\` — ${i.source}${target}${i.note ? ` · ${i.note}` : ''}${i.gone ? ' · kaynakta artık yok' : ''}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function savePlan(paths, plan) {
  ensureDir(paths.migrations);
  const updated = { ...plan, updatedAt: new Date().toISOString() };
  writeAtomic(planFile(paths, plan.name), `${JSON.stringify(updated, null, 2)}\n`);
  writeAtomic(path.join(paths.migrations, `${plan.name}.md`), renderPlan(updated));
  return updated;
}

export function startMigration(paths, { name, from, to, kinds = null }) {
  const slug = slugify(name);
  if (readPlan(paths, slug)) throw new Error(`"${slug}" göçü zaten var; envanteri tazelemek için: legacies migrate refresh ${slug}`);
  const built = buildItems(from, to, kinds);
  return savePlan(paths, { name: slug, from: path.resolve(from), to: path.resolve(to), createdAt: new Date().toISOString(), ...built });
}

// Keeps every status and note; new source files join as todo, and items whose file is gone are flagged.
export function refreshMigration(paths, name) {
  const plan = readPlan(paths, name);
  if (!plan) throw new Error(`"${name}" adında bir göç yok`);
  const fresh = buildItems(plan.from, plan.to, plan.kinds).items;
  const old = new Map(plan.items.map((i) => [i.id, i]));
  const items = fresh.map((i) => (old.has(i.id) ? { ...i, status: old.get(i.id).status, note: old.get(i.id).note } : i));
  for (const i of plan.items) if (!fresh.some((f) => f.id === i.id)) items.push({ ...i, gone: true });
  return savePlan(paths, { ...plan, items });
}

export function setStatus(paths, name, ids, status, note = '') {
  if (!STATUSES.includes(status)) throw new Error(`Durum şunlardan biri olmalı: ${STATUSES.join(', ')}`);
  const plan = readPlan(paths, name);
  if (!plan) throw new Error(`"${name}" adında bir göç yok`);
  const unknown = ids.filter((id) => !plan.items.some((i) => i.id === id));
  if (unknown.length) throw new Error(`Planda yok: ${unknown.join(', ')}`);
  const items = plan.items.map((i) => (ids.includes(i.id) ? { ...i, status, note: note || i.note } : i));
  return savePlan(paths, { ...plan, items });
}

export function countByStatus(plan) {
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const i of plan.items) counts[i.status] += 1;
  return counts;
}

// Route-like work first (whole screens), then the pieces they need.
export function nextItems(plan, limit = 10) {
  const order = (i) => KINDS.indexOf(i.kind);
  return plan.items.filter((i) => i.status === 'todo' && !i.gone).sort((a, b) => order(a) - order(b)).slice(0, limit);
}

export function migrationLines(paths) {
  return listPlans(paths).map((plan) => {
    const counts = countByStatus(plan);
    const next = nextItems(plan, 3).map((i) => i.id);
    const from = path.basename(plan.from);
    const to = path.basename(plan.to);
    return `- ${plan.name}: ${from} → ${to} · ${counts.done}/${plan.items.length} tamam, ${counts.partial} kısmi${next.length ? ` · sıradaki: ${next.join(', ')} (legacies migrate next ${plan.name})` : ''}`;
  });
}
