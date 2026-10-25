import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  describeRole,
  EFFORTS,
  effectiveSettings,
  MAX_PARALLEL,
  MODEL_LABEL,
  MODELS,
  PROFILE_LABEL,
  resetSettings,
  ROLE_LABEL,
  roleOf,
  ROLES,
  roleTable,
  updateSettings,
} from './multiagent.mjs';
import { packIdOf } from './packs.mjs';
import * as ui from './tui.mjs';
import { readJson } from './util.mjs';

// `legacies multiagent`: the commands, the settings screen and the status lines.
export class UsageError extends Error {}

const BUILTIN_AGENTS = ['Explore', 'Plan', 'general-purpose'];
// The settings screen lists agents with a plain menu; longer lists are handled with `role <ajan> <rol>`.
const AGENT_MENU_LIMIT = 15;
const LABEL_WIDTH = 19;

function oneOf(word, allowed, what) {
  if (allowed.includes(word)) return word;
  throw new UsageError(`${what} "${word ?? ''}" olmaz; şunlardan biri: ${allowed.join(', ')}`);
}

const parseModel = (word) => oneOf(word === 'senin' ? 'inherit' : word, MODELS, 'Model');
const parseRole = (word) => oneOf(word, ROLES, 'Rol');
const parseProfile = (word) => oneOf(word, Object.keys(PROFILE_LABEL), 'Denge');

export function statusLines({ settings, fromProject }, where) {
  const table = roleTable(settings);
  const row = (label, value) => `  ${label.padEnd(LABEL_WIDTH)} ${value}`;
  const lines = [
    `Çoklu ajan düzeni (${where}): ${settings.on ? 'açık' : 'kapalı'} · ${PROFILE_LABEL[settings.profile] || settings.profile}`,
    ...ROLES.map((role) => row(ROLE_LABEL[role], describeRole(table[role]))),
    row('Aynı anda en fazla', `${settings.maxParallel} ajan`),
    row('Yükseltme', settings.escalate ? 'açık' : 'kapalı'),
  ];
  const assigned = Object.entries(settings.agents || {});
  if (assigned.length) lines.push(row('Ajan atamaları', assigned.map(([agent, role]) => `${agent} → ${ROLE_LABEL[role] || role}`).join(', ')));
  if (fromProject) lines.push(fromProject.size ? `Bu projenin kendi ayarları: ${[...fromProject].join(', ')}; gerisi bilgisayar varsayılanından.` : 'Bu proje bilgisayar varsayılanını kullanıyor.');
  return lines;
}

// One command after `legacies multiagent` (or `legacies multiagent default`), saved at once.
export function applyCommand({ root, target, words }) {
  const [action, ...rest] = words;
  const { settings } = effectiveSettings(target === 'project' ? root : null);
  const save = (change) => updateSettings({ root, target, change });
  if (action === 'on') return save({ on: true, ...(rest[0] ? { profile: parseProfile(rest[0]) } : {}) });
  if (action === 'off') return save({ on: false });
  if (action === 'profile') return save({ profile: parseProfile(rest[0]) });
  if (action === 'reset') return resetSettings({ root, target });
  if (action === 'role') {
    const [agent, role] = rest;
    if (!agent || !role) throw new UsageError('Kullanım: legacies multiagent role <ajan> <rol|varsayilan>');
    const agents = { ...settings.agents };
    if (role === 'varsayilan') delete agents[agent];
    else agents[agent] = parseRole(role);
    return save({ agents });
  }
  if (action === 'set') return save(setChange(settings, rest));
  throw new UsageError('Kullanım: legacies multiagent [status|on [denge]|off|profile <denge>|set ...|role <ajan> <rol>|reset] (bilgisayar varsayılanı için: legacies multiagent default ...)');
}

function setChange(settings, [what, ...values]) {
  if (what === 'paralel') {
    const n = Number(values[0]);
    if (!Number.isInteger(n) || n < 1 || n > MAX_PARALLEL) throw new UsageError(`Ajan sayısı 1 ile ${MAX_PARALLEL} arasında olmalı`);
    return { maxParallel: n };
  }
  if (what === 'yukselt') return { escalate: oneOf(values[0], ['on', 'off'], 'Yükseltme') === 'on' };
  const role = parseRole(what);
  const roles = roleTable(settings);
  roles[role] = { model: parseModel(values[0]), effort: oneOf(values[1], EFFORTS, 'Effort') };
  return { profile: 'ozel', roles };
}

// Agents worth listing on the screen: Claude Code's own, legacies' core agents, the agents of packs on
// in this project, and the user's own agent files.
function agentsHere(pluginRoot, root) {
  const names = (dir) => {
    try {
      return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3));
    } catch {
      return [];
    }
  };
  const enabled = root
    ? ['settings.json', 'settings.local.json'].flatMap((f) => Object.entries((readJson(path.join(root, '.claude', f), {}) || {}).enabledPlugins || {}).filter(([, on]) => on).map(([id]) => packIdOf(id)))
    : [];
  return [
    ...new Set([
      ...BUILTIN_AGENTS,
      ...names(path.join(pluginRoot, 'agents')),
      ...enabled.filter(Boolean).flatMap((pack) => names(path.join(pluginRoot, 'packs', pack, 'agents'))),
      ...(root ? names(path.join(root, '.claude', 'agents')) : []),
      ...names(path.join(os.homedir(), '.claude', 'agents')),
    ]),
  ];
}

const draftOf = (settings) => ({ ...settings, roles: roleTable(settings), agents: { ...settings.agents } });

// The settings screen: one row per setting, Enter changes it, the confirm row ends with "Emin misiniz?".
// Returns the edited settings; the caller saves them, so the installer can still show its plan first.
export async function chooseSettings({ pluginRoot, root, initial, title = 'Çoklu ajan düzeni' }) {
  let draft = draftOf(initial);
  let at = 0;
  for (;;) {
    const rows = [
      { value: 'on', label: `Durum: ${draft.on ? 'açık' : 'kapalı'}` },
      { value: 'profile', label: `Denge: ${PROFILE_LABEL[draft.profile]}` },
      ...ROLES.map((role) => ({ value: `role:${role}`, label: `${ROLE_LABEL[role]}: ${describeRole(draft.roles[role])}` })),
      { value: 'maxParallel', label: `Aynı anda en fazla: ${draft.maxParallel} ajan` },
      { value: 'escalate', label: `Başarısız olursa yükselt: ${draft.escalate ? 'açık' : 'kapalı'}` },
      { value: 'agents', label: `Ajan atamaları: ${Object.keys(draft.agents).length ? Object.entries(draft.agents).map(([a, r]) => `${a} → ${ROLE_LABEL[r]}`).join(', ') : 'varsayılan'}` },
      { value: 'confirm', label: '[ Onaylıyorum ]' },
    ];
    const choice = await ui.select(title, rows, { initial: at });
    at = rows.findIndex((r) => r.value === choice);
    if (choice === 'confirm') {
      if (await ui.confirm('Emin misiniz?')) return draft;
      continue;
    }
    draft = await editRow(choice, draft, { pluginRoot, root });
  }
}

async function editRow(choice, draft, { pluginRoot, root }) {
  if (choice === 'on') return { ...draft, on: !draft.on };
  if (choice === 'escalate') return { ...draft, escalate: !draft.escalate };
  if (choice === 'profile') {
    const profile = await ui.select('Hangi denge?', Object.entries(PROFILE_LABEL).map(([value, label]) => ({ value, label })), { initial: Object.keys(PROFILE_LABEL).indexOf(draft.profile) });
    return profile === 'ozel' ? { ...draft, profile } : { ...draft, profile, roles: roleTable({ profile }) };
  }
  if (choice === 'maxParallel') {
    const n = await ui.select('Aynı anda en fazla kaç ajan?', Array.from({ length: MAX_PARALLEL }, (_, i) => ({ value: i + 1, label: `${i + 1} ajan` })), { initial: draft.maxParallel - 1 });
    return { ...draft, maxParallel: n };
  }
  if (choice.startsWith('role:')) {
    const role = choice.slice(5);
    const model = await ui.select(`${ROLE_LABEL[role]}: model`, MODELS.map((m) => ({ value: m, label: MODEL_LABEL[m] })), { initial: MODELS.indexOf(draft.roles[role].model) });
    const effort = await ui.select(`${ROLE_LABEL[role]}: effort`, EFFORTS.map((e) => ({ value: e, label: e })), { initial: EFFORTS.indexOf(draft.roles[role].effort) });
    return { ...draft, profile: 'ozel', roles: { ...draft.roles, [role]: { model, effort } } };
  }
  if (choice === 'agents') {
    const all = agentsHere(pluginRoot, root);
    const shown = all.slice(0, AGENT_MENU_LIMIT);
    if (all.length > shown.length) ui.detail(`${all.length - shown.length} ajan daha var; onlar için: legacies multiagent role <ajan> <rol>`);
    const agent = await ui.select('Hangi ajan?', shown.map((a) => ({ value: a, label: `${a} · ${ROLE_LABEL[roleOf(a, draft.agents)]}${draft.agents[a] ? ' (senin atamın)' : ''}` })));
    const role = await ui.select(`${agent} hangi rolde olsun?`, [...ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] })), { value: 'varsayilan', label: 'Varsayılan rolüne dön' }]);
    const agents = { ...draft.agents };
    if (role === 'varsayilan') delete agents[agent];
    else agents[agent] = role;
    return { ...draft, agents };
  }
  return draft;
}

// What the screen saves: the role table is kept only for a custom balance.
export function changeFromDraft(draft) {
  const { on, profile, maxParallel, escalate, agents } = draft;
  return { on, profile, maxParallel, escalate, agents, ...(profile === 'ozel' ? { roles: draft.roles } : {}) };
}

