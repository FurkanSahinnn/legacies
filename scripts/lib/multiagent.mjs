import path from 'node:path';
import { claudeConfigDir, readJson, writeAtomic } from './util.mjs';

// The multi-agent setup: when it is on, the lead (the main session) is told which model and effort to
// give each subagent by its role, how many may run at once and when to retry a stronger way. Users pick
// a balance or set each role themselves, per project or as this computer's default for every project.
export const ROLES = ['inceleme', 'tasarim', 'uygulama', 'arama'];
export const ROLE_LABEL = { inceleme: 'İnceleme', tasarim: 'Tasarım ve teşhis', uygulama: 'Uygulama', arama: 'Arama' };
export const MODELS = ['inherit', 'opus', 'sonnet', 'haiku'];
export const MODEL_LABEL = { inherit: 'senin modelin', opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku' };
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
export const PROFILE_LABEL = { dengeli: 'Dengeli', kalite: 'Kalite', maliyet: 'Maliyet', ozel: 'Özel' };
export const PROFILES = {
  dengeli: { inceleme: ['inherit', 'high'], tasarim: ['inherit', 'high'], uygulama: ['sonnet', 'medium'], arama: ['haiku', 'low'] },
  kalite: { inceleme: ['inherit', 'high'], tasarim: ['inherit', 'high'], uygulama: ['inherit', 'high'], arama: ['haiku', 'low'] },
  maliyet: { inceleme: ['sonnet', 'high'], tasarim: ['sonnet', 'high'], uygulama: ['sonnet', 'low'], arama: ['haiku', 'low'] },
};
export const MAX_PARALLEL = 8;
const BUILTIN = { on: false, profile: 'dengeli', roles: {}, agents: {}, maxParallel: 4, escalate: true };

// Which role an agent has when the user has not given it one. Claude Code's own agents by name, the
// agents legacies ships by the shape of their names.
const ROLE_BY_NAME = { Explore: 'arama', Plan: 'tasarim', 'general-purpose': 'uygulama', 'type-design-analyzer': 'tasarim', 'network-troubleshooter': 'tasarim', 'spec-miner': 'tasarim', 'performance-optimizer': 'tasarim' };
const ROLE_PATTERNS = [
  [/architect$/, 'tasarim'],
  [/-lookup$/, 'arama'],
  [/-reviewer$|-analyzer$|^silent-failure-hunter$/, 'inceleme'],
];
// The same defaults in words, for the lead.
const ROLE_MEMBERS = {
  inceleme: 'adı -reviewer ya da -analyzer ile bitenler, silent-failure-hunter',
  tasarim: 'Plan, adı architect ile bitenler, type-design-analyzer, network-troubleshooter, spec-miner, performance-optimizer',
  uygulama: 'general-purpose ve tabloda adı geçmeyen diğer ajanlar',
  arama: 'Explore, adı -lookup ile bitenler',
};

// One file for this computer: the default every project follows, and what each project changed.
export const settingsFile = () => path.join(claudeConfigDir(), 'legacies-multiagent.json');

const projectKey = (root) => {
  const resolved = path.resolve(root).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
};

function readStore() {
  const data = readJson(settingsFile(), null) || {};
  return { default: data.default || {}, projects: data.projects || {} };
}

// The settings in force for a project (or, without one, for the computer), and which keys the project
// itself set.
export function effectiveSettings(root = null) {
  const store = readStore();
  const own = root ? store.projects[projectKey(root)] || {} : {};
  return { settings: { ...BUILTIN, ...store.default, ...own }, fromProject: new Set(Object.keys(own)) };
}

// `target` is 'project' (needs a root) or 'default'. `change` holds only the keys to set.
export function updateSettings({ root = null, target, change }) {
  const store = readStore();
  if (target === 'default') store.default = { ...store.default, ...change };
  else store.projects[projectKey(root)] = { ...(store.projects[projectKey(root)] || {}), ...change };
  writeAtomic(settingsFile(), JSON.stringify(store, null, 2));
}

export function resetSettings({ root = null, target }) {
  const store = readStore();
  if (target === 'default') store.default = {};
  else delete store.projects[projectKey(root)];
  writeAtomic(settingsFile(), JSON.stringify(store, null, 2));
}

// Model and effort per role: a named balance, or the user's own table on top of the balanced one.
export function roleTable(settings) {
  const base = PROFILES[settings.profile] || PROFILES.dengeli;
  const table = {};
  for (const role of ROLES) {
    const own = settings.profile === 'ozel' ? settings.roles?.[role] : null;
    const [model, effort] = own ? [own.model, own.effort] : base[role];
    table[role] = { model, effort };
  }
  return table;
}

// Plugin agents are named `plugin:agent`; only the agent part says what it does.
export function roleOf(agent, assignments = {}) {
  const name = String(agent).split(':').pop();
  if (assignments[name]) return assignments[name];
  if (ROLE_BY_NAME[name]) return ROLE_BY_NAME[name];
  const hit = ROLE_PATTERNS.find(([pattern]) => pattern.test(name));
  return hit ? hit[1] : 'uygulama';
}

export const describeRole = ({ model, effort }) => `${MODEL_LABEL[model] || model} · ${effort}`;

// What the lead reads at session start while the setup is on.
export function policyText(settings) {
  const table = roleTable(settings);
  const lines = [
    `## Çoklu ajan düzeni (açık · ${PROFILE_LABEL[settings.profile] || settings.profile})`,
    'Ajan kullanırken lider sensin: işi böl, ajanlara ver, sonuçları birleştir ve doğrula. Bir ajanı Agent aracıyla başlatırken rolüne göre aşağıdaki model ve effort\'u ver; model "senin modelin" ise model verme. Ajan adı `paket:ad` biçimindeyse `ad` kısmına bak.',
    '| Rol | Ajanlar | Model | Effort |',
    '|---|---|---|---|',
    ...ROLES.map((role) => `| ${ROLE_LABEL[role]} | ${ROLE_MEMBERS[role]} | ${MODEL_LABEL[table[role].model] || table[role].model} | ${table[role].effort} |`),
  ];
  const assigned = Object.entries(settings.agents || {});
  if (assigned.length) lines.push(`Kullanıcının atamaları tablodan önce gelir: ${assigned.map(([agent, role]) => `${agent} → ${ROLE_LABEL[role] || role}`).join(', ')}.`);
  // When not to fan out, and how writers stay apart: the parts of ruflo's and ECC's orchestration rules
  // that cost almost nothing and save the most tokens and broken merges.
  lines.push(
    '- Tek dosyalık ya da birkaç satırlık değişiklik, belge ya da ayar düzenlemesi ve kısa sorular için ajan açma; kendin yap.',
    `- Aynı anda en fazla ${settings.maxParallel} ajan çalıştır. Bağımsız işleri paralel, birbirine bağlı olanları sırayla ver.`,
    '- Yalnız okuyan ajanlar aynı çalışma kopyasını paylaşabilir. Yazan her ajanın dosyaları ayrı olsun; çakışma riski varsa ayrı worktree ver. Paket tanımı ve kilit dosyalarını (package.json, pyproject.toml, go.mod, *.lock) ve ortak ayarları yalnız sen değiştir.',
  );
  if (settings.escalate) lines.push('- Bir ajan başarısız olursa ya da sonucu kontrolünden geçmezse bir kez daha bir üst effort\'la dene; yine olmazsa senin modelinle.');
  lines.push('- Ajanın "bitti" demesi yetmez: sonucu sen doğrula. Bitince kısa bir özet ver: hangi işi hangi ajan yaptı, nasıl doğrulandı.');
  return lines.join('\n');
}
