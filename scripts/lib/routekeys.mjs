import path from 'node:path';

// Where a file sits in a framework's routing: a page, an API handler, a mobile screen, or a component,
// hook, store or service. Shared by migrate (to pair source and target) and the route index (to name
// routes by their URL); kept free of heavy imports because the prompt hook loads it.
const NAME_SUFFIX = /(screen|page|view|container|component|service|client|api|store|slice)$/;
const NEXT_SPECIAL = /^_(app|document|error)$/;
const EXPO_SPECIAL = /^(_layout|\+html|\+not-found)$/;
// i18n segments such as [locale] are not part of what a screen shows.
const LOCALE_SEGMENT = /^\[(locale|lang|lng|language)\]$/i;

// Route groups `(auth)` vanish, `[id]` becomes `:id`, and index files name their folder.
function routeKey(segments) {
  const parts = segments
    .filter((s) => s && !/^\(.*\)$/.test(s) && !LOCALE_SEGMENT.test(s) && s !== 'index' && s !== 'page')
    .map((s) => s.replace(/^\[\.{3}(.+)\]$/, '*$1').replace(/^\[(.+)\]$/, ':$1').toLowerCase());
  return `/${parts.join('/')}`;
}

export function baseName(file) {
  const name = path.posix.basename(file).replace(/\.[^.]+$/, '');
  return name === 'index' ? path.posix.basename(path.posix.dirname(file)) : name;
}

export const normalizeName = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, '').replace(NAME_SUFFIX, '') || name.toLowerCase();

// The first rule that matches a file decides its kind; files no rule claims stay out of the plan.
export function classify(file, { expoRouter }) {
  let m;
  if ((m = /(?:^|\/)app\/(.*?)\/?route\.(?:ts|js)$/.exec(file))) return { kind: 'api', key: routeKey(m[1].split('/')) };
  if ((m = /(?:^|\/)app\/(.*?)\/?page\.(?:tsx|jsx|ts|js|mdx)$/.exec(file))) return { kind: 'route', key: routeKey(m[1].split('/')) };
  if ((m = /(?:^|\/)pages\/api\/(.+)\.(?:ts|js)$/.exec(file))) return { kind: 'api', key: routeKey(m[1].split('/')) };
  if ((m = /(?:^|\/)pages\/(.+)\.(?:tsx|jsx|ts|js|vue)$/.exec(file)) && !NEXT_SPECIAL.test(baseName(file))) return { kind: 'route', key: routeKey(m[1].split('/')) };
  if ((m = /(?:^|\/)routes\/(.*?)\/?\+page\.svelte$/.exec(file))) return { kind: 'route', key: routeKey(m[1].split('/')) };
  if ((m = /(?:^|\/)routes\/(.*?)\/?\+server\.(?:ts|js)$/.exec(file))) return { kind: 'api', key: routeKey(m[1].split('/')) };
  if (expoRouter && (m = /(?:^|\/)app\/(.+)\.(?:tsx|jsx|ts|js)$/.exec(file))) {
    if (EXPO_SPECIAL.test(baseName(file))) return null;
    if (/\+api$/.test(baseName(file))) return { kind: 'api', key: routeKey(m[1].replace(/\+api$/, '').split('/')) };
    return { kind: 'screen', key: routeKey(m[1].split('/')) };
  }
  if (/(?:^|\/)screens?\/.+\.(?:tsx|jsx|ts|js|dart)$/.test(file) || /Screen\.(?:tsx|jsx)$/.test(file) || /_(?:screen|page)\.dart$/.test(file)) {
    return { kind: 'screen', key: `/${normalizeName(baseName(file))}` };
  }
  if (/(?:^|\/)components?\/.+\.(?:tsx|jsx|vue|svelte|dart)$/.test(file)) return { kind: 'component', key: normalizeName(baseName(file)) };
  if (/(?:^|\/)use[A-Z][\w]*\.(?:ts|tsx|js)$/.test(file)) return { kind: 'hook', key: normalizeName(baseName(file)) };
  if (/(?:^|\/)(?:store|stores|state|slices|redux)\/.+\.(?:ts|tsx|js)$/.test(file)) return { kind: 'store', key: normalizeName(baseName(file)) };
  if (/(?:^|\/)(?:services?|api|clients?|repositories)\/.+\.(?:ts|tsx|js|dart)$/.test(file)) return { kind: 'service', key: normalizeName(baseName(file)) };
  return null;
}
