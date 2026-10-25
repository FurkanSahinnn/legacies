// The terminal flows behind `legacies packs` and `legacies catalog`: detect the stack, show the grouped
// checklist, then turn the selection into `claude plugin` calls. setup.mjs runs the same pack flow
// right after a per-project install.
import os from 'node:os';
import { findExecutable } from './codeindex.mjs';
import { detectCatalog, scanProject } from './detect.mjs';
import { claude, parseJsonOutput } from './installer.mjs';
import { buildGroups, changeSteps, loadCatalog, OFFICIAL, packIdOf, packPluginId, planPackChanges, projectPlugins, resolvePluginIds } from './packs.mjs';
import { importToPersonal, listPersonal, PERSONAL_MARKETPLACE, personalDir, removePersonal } from './personal.mjs';
import { registerProject } from './runtime.mjs';
import * as ui from './tui.mjs';

const hasBinary = (name) => Boolean(findExecutable(name));

async function readState(root) {
  const [listed, markets] = await Promise.all([
    claude(['plugin', 'list', '--json'], { cwd: root }),
    claude(['plugin', 'marketplace', 'list', '--json'], { cwd: root }),
  ]);
  return { plugins: projectPlugins(parseJsonOutput(listed.stdout, []), root), marketplaces: parseJsonOutput(markets.stdout, []) };
}

// Everything the screens need about one project, gathered once.
export async function inspectProject(pluginRoot, root) {
  const catalog = loadCatalog(pluginRoot);
  const detection = detectCatalog(catalog.registry, scanProject(root));
  const state = await readState(root);
  const personal = listPersonal();
  const groups = buildGroups({ catalog, detection, plugins: state.plugins, personal, hasBinary });
  return { catalog, detection, personal, groups, ...state };
}

function finalPacks(plugins, changes) {
  const on = new Set([...plugins.entries()].filter(([, p]) => p.on).map(([id]) => id));
  for (const c of changes.add) on.add(c.id);
  for (const c of changes.remove) on.delete(c.id);
  return [...on].map(packIdOf).filter(Boolean);
}

async function applyChanges({ pluginRoot, root, scope, info, changes }) {
  const failedIds = new Set();
  const done = (list) => list.filter((c) => !failedIds.has(c.id));
  const packsAfter = () => finalPacks(info.plugins, { add: done(changes.add), remove: done(changes.remove) });
  const steps = changeSteps({ pluginRoot, root, scope, changes, packsAfter, marketplaces: info.marketplaces });
  let failed = 0;
  for (const step of steps) {
    if ((await ui.task(step.title, step.run)).ok) continue;
    failed += 1;
    if (step.change) failedIds.add(step.change.id);
  }
  registerProject(root, { packs: true });
  return failed;
}

function showPlan(changes) {
  for (const c of changes.add) ui.item('add', c.id, c.action === 'install' ? `kurulacak (${c.scope})` : 'açılacak');
  for (const c of changes.remove) ui.item('remove', c.id, c.action === 'uninstall' ? 'silinecek; kuralları da projeden çekilir' : 'kapatılacak; kurulu kalır, yeniden açmak anında');
}

function finish(failed) {
  if (failed) {
    ui.box('Bazı adımlar başarısız oldu', ['Yukarıdaki hataları düzeltip komutu yeniden çalıştır; tamamlananlar tekrar yapılmaz.'], { tone: 'fail' });
    process.exitCode = 1;
    return;
  }
  ui.box('Paketler güncellendi', [
    "Açık bir Claude Code oturumunda /reload-plugins çalıştır; yeni oturumlar kendiliğinden yükler.",
    'Sonradan değiştirmek için: legacies packs (ya da Claude Code içinde /plugin).',
  ]);
}

export async function choosePacks({ pluginRoot, root, scope = 'local', yes = false, dryRun = false }) {
  ui.section('Teknoloji tespiti');
  const scan = await ui.task('Proje ve kurulu plugin\'ler inceleniyor', () => inspectProject(pluginRoot, root), { minMs: 500 });
  if (!scan.ok) {
    process.exitCode = 1;
    return;
  }
  const info = scan.result;
  for (const hit of info.detection.packs) ui.item(hit.weak ? 'skip' : 'ok', hit.id, hit.reasons.slice(0, 3).join(', '));
  for (const hit of info.detection.official) ui.item('info', `${hit.name} (resmi)`, hit.reasons[0]);
  if (!info.detection.packs.length && !info.detection.official.length) ui.item('skip', 'Belirgin bir teknoloji işareti bulunamadı', 'katalogdan elle seçebilirsin');
  ui.section('Seçim');
  const values = info.groups.flatMap((g) => g.options.map((o) => o.value));
  const picked = yes ? info.groups.flatMap((g) => g.options.filter((o) => o.checked).map((o) => o.value)) : await ui.checklist('Bu projede hangileri açık olsun?', info.groups);
  const changes = planPackChanges({ selected: new Set(picked), options: values, plugins: info.plugins, scope });
  ui.section('Yapılacaklar');
  if (!changes.add.length && !changes.remove.length) {
    ui.item('ok', 'Değişiklik yok; seçim zaten bu projede açık olanlarla aynı.');
    return;
  }
  showPlan(changes);
  if (dryRun) {
    ui.box('Deneme modu', ['--dry-run: plan gösterildi, hiçbir şey değiştirilmedi.']);
    return;
  }
  if (!yes && !(await ui.confirm('Uygulansın mı?', { initial: true }))) {
    ui.item('info', 'Vazgeçildi; hiçbir şey değiştirilmedi.');
    return;
  }
  ui.section('Uygulanıyor');
  finish(await applyChanges({ pluginRoot, root, scope, info, changes }));
}

export async function changePacks({ pluginRoot, root, names, enable, scope = 'local' }) {
  const info = await inspectProject(pluginRoot, root);
  const { ids, unknown } = resolvePluginIds(names, { catalog: info.catalog, personal: info.personal });
  if (unknown.length) throw new Error(`Katalogda yok: ${unknown.join(', ')} (legacies packs list ile bak)`);
  const changes = planPackChanges({ selected: new Set(enable ? ids : []), options: ids, plugins: info.plugins, scope });
  if (!changes.add.length && !changes.remove.length) {
    ui.item('ok', enable ? 'Hepsi zaten açık.' : 'Hiçbiri açık değil.');
    return;
  }
  showPlan(changes);
  finish(await applyChanges({ pluginRoot, root, scope, info, changes }));
}

// Deleting a pack for good: it is uninstalled at its own scope and its rules leave the project. Turning
// it off (`legacies packs off`) is the everyday way, so this one asks first.
export async function removePacks({ pluginRoot, root, names, scope = 'local', yes = false }) {
  const info = await inspectProject(pluginRoot, root);
  const { ids, unknown } = resolvePluginIds(names, { catalog: info.catalog, personal: info.personal });
  if (unknown.length) throw new Error(`Katalogda yok: ${unknown.join(', ')} (legacies packs list ile bak)`);
  const installed = ids.filter((id) => info.plugins.has(id));
  if (!installed.length) {
    ui.item('ok', 'Hiçbiri bu projede kurulu değil.');
    return;
  }
  const elsewhere = installed.filter((id) => info.plugins.get(id).scope !== scope);
  if (elsewhere.length) {
    const how = scope === 'local' ? 'ekip için açılmış (.claude/settings.json): yalnız senin için kapatmak için legacies packs off, ekipten silmek için --scope project' : 'yalnız bu bilgisayarda kurulu: --scope local ile sil';
    throw new Error(`${elsewhere.join(', ')} ${how}`);
  }
  const changes = { add: [], remove: installed.map((id) => ({ id, action: 'uninstall', scope })) };
  showPlan(changes);
  if (!yes && !(await ui.confirm('Emin misin? Yalnız kapatmak için: legacies packs off', { initial: false }))) {
    ui.item('info', `Vazgeçildi; hiçbir şey silinmedi.${ui.interactive ? '' : ' Sormadan silmek için --yes ekle.'}`);
    process.exitCode = 1;
    return;
  }
  finish(await applyChanges({ pluginRoot, root, scope, info, changes }));
}

export function describeSuggestions(info) {
  const on = (id) => info.plugins.get(id)?.on === true;
  return {
    packs: info.detection.packs.map((d) => ({ ...d, enabled: on(packPluginId(d.id)) })),
    official: info.detection.official.map((d) => ({ ...d, enabled: on(`${d.name}@${OFFICIAL}`) })),
  };
}

export function printGroups(groups) {
  for (const group of groups) {
    process.stdout.write(`\n${group.title}\n`);
    for (const o of group.options) process.stdout.write(`  [${o.checked ? 'x' : ' '}] ${o.label}${o.hint ? ` · ${o.hint}` : ''}\n`);
  }
}

async function ensurePersonalMarketplace() {
  const markets = parseJsonOutput((await claude(['plugin', 'marketplace', 'list', '--json'], { cwd: os.homedir() })).stdout, []);
  if (markets.some((m) => m.name === PERSONAL_MARKETPLACE)) await claude(['plugin', 'marketplace', 'update', PERSONAL_MARKETPLACE], { cwd: os.homedir() });
  else await claude(['plugin', 'marketplace', 'add', personalDir()], { cwd: os.homedir() });
}

export async function addToCatalog(source, { name } = {}) {
  const imported = importToPersonal(source, { name });
  await ensurePersonalMarketplace();
  return imported;
}

// Projects that turned the plugin on keep a record of it; it is uninstalled there before it disappears.
export async function removeFromCatalog(name) {
  const id = `${name}@${PERSONAL_MARKETPLACE}`;
  const listed = parseJsonOutput((await claude(['plugin', 'list', '--json'], { cwd: os.homedir() })).stdout, []);
  for (const p of listed.filter((x) => x.id === id)) {
    await claude(['plugin', 'uninstall', id, '--scope', p.scope, '-y'], { cwd: p.projectPath || os.homedir() });
  }
  removePersonal(name);
  await ensurePersonalMarketplace();
}

