import fs from 'node:fs';
import path from 'node:path';
import { graphPath, normLabel } from './codeindex.mjs';
import { clip, readJson, writeAtomic } from './util.mjs';

// legacies answers explain, affected, path and query itself, from a compact copy of graphify's graph.
// graphify reloads the whole graph in Python for every question (~1 s on 8.5k nodes)
// and let its answers run past their budget.
const EDGES_VERSION = 1;
export const ANSWER_LIMIT = 2000;
const NEIGHBOR_LIMIT = 12;
const CANDIDATE_LIMIT = 6;
const AFFECTED_DEPTH = 3;
const PATH_DEPTH = 8;
const QUERY_NEIGHBORS = 4;
// Relations through which a change reaches the code that depends on it.
const DEPENDS = new Set(['calls', 'indirect_call', 'references', 'imports', 'imports_from', 're_exports', 'dynamic_import', 'inherits', 'method']);
// What calls or uses a symbol is listed before what merely contains it.
const RELATION_RANK = ['calls', 'indirect_call', 'references', 'inherits', 'method', 'imports', 'imports_from', 're_exports', 'dynamic_import', 'contains', 'rationale_for', 'cites'];
const rankOf = (relation) => (RELATION_RANK.includes(relation) ? RELATION_RANK.indexOf(relation) : RELATION_RANK.length);

// nodes: [label, file, line, fileType]; edges: [source, target, relationIndex, call-site line].
export function loadGraph(paths) {
  const file = graphPath(paths);
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return null;
  }
  const key = `${EDGES_VERSION}-${stat.size}-${stat.mtimeMs}`;
  const cacheFile = path.join(paths.runtime, 'graph-edges.json');
  let compact = readJson(cacheFile);
  if (!compact || compact.key !== key) {
    const graph = readJson(file);
    if (!graph || !Array.isArray(graph.nodes)) return null;
    const at = new Map();
    const nodes = graph.nodes.map((n, i) => {
      at.set(n.id, i);
      return [String(n.label || n.id), String(n.source_file || '').replace(/\\/g, '/'), n.source_location || '', n.file_type || ''];
    });
    const relations = [];
    const relationAt = new Map();
    const edges = [];
    for (const e of graph.links || graph.edges || []) {
      const s = at.get(e.source);
      const t = at.get(e.target);
      if (s === undefined || t === undefined || s === t) continue;
      if (!relationAt.has(e.relation)) {
        relationAt.set(e.relation, relations.length);
        relations.push(e.relation);
      }
      edges.push([s, t, relationAt.get(e.relation), e.source_location || '']);
    }
    compact = { key, nodes, edges, relations };
    try {
      writeAtomic(cacheFile, JSON.stringify(compact));
    } catch {
      // Still answers this question.
    }
  }
  const out = compact.nodes.map(() => []);
  const inc = compact.nodes.map(() => []);
  for (const [s, t, r, site] of compact.edges) {
    out[s].push([t, r, site]);
    inc[t].push([s, r, site]);
  }
  return { ...compact, out, inc };
}

const degree = (graph, i) => graph.out[i].length + graph.inc[i].length;

// "file::Name" picks one of several same-named symbols; a bare name matches all of them, code symbols
// and the best connected first.
export function findNodes(graph, query) {
  const sep = query.lastIndexOf('::');
  const file = sep > 0 ? query.slice(0, sep).replace(/\\/g, '/') : null;
  const name = normLabel(sep > 0 ? query.slice(sep + 2) : query);
  const hits = [];
  graph.nodes.forEach(([label, f], i) => {
    if (normLabel(label) !== name) return;
    if (file && f !== file && !f.endsWith(`/${file}`)) return;
    hits.push(i);
  });
  const isCode = (i) => (graph.nodes[i][3] === 'code' ? 1 : 0);
  return hits.sort((a, b) => isCode(b) - isCode(a) || degree(graph, b) - degree(graph, a));
}

function at(graph, i, line) {
  const [label, file, loc] = graph.nodes[i];
  const where = line || loc;
  return `${label} — ${file}${where ? `:${where}` : ''}`;
}

function neighborLines(graph, list, arrow, { useSite }) {
  const sorted = [...list].sort((a, b) => rankOf(graph.relations[a[1]]) - rankOf(graph.relations[b[1]]) || degree(graph, b[0]) - degree(graph, a[0]));
  const lines = sorted.slice(0, NEIGHBOR_LIMIT).map(([j, r, site]) => `  ${arrow} ${graph.relations[r]}  ${at(graph, j, useSite ? site : '')}`);
  if (sorted.length > NEIGHBOR_LIMIT) lines.push(`  … ${sorted.length - NEIGHBOR_LIMIT} bağlantı daha`);
  return lines;
}

// One symbol and its connections. Several symbols with the name: all are listed with their lines and
// the best connected one is explained.
function resolve(graph, query) {
  const hits = findNodes(graph, query);
  if (hits.length === 0) return { node: null, lines: [`"${query}" adında bir sembol yok. legacies map ile benzer adları ara.`] };
  const lines = [];
  if (hits.length > 1) {
    lines.push(`Bu adla ${hits.length} sembol var; en çok bağlantılı olan ele alındı. Diğerleri:`);
    for (const j of hits.slice(1, CANDIDATE_LIMIT + 1)) lines.push(`- ${at(graph, j)}`);
    if (hits.length > CANDIDATE_LIMIT + 1) lines.push(`- … ${hits.length - CANDIDATE_LIMIT - 1} tane daha`);
    lines.push(`Birini seçmek için: "dosya::${query.split('::').pop()}"`);
  }
  return { node: hits[0], lines };
}

export function explain(graph, query) {
  const { node, lines } = resolve(graph, query);
  if (node === null) return lines.join('\n');
  const head = `${at(graph, node)}  (${graph.inc[node].length} gelen, ${graph.out[node].length} giden bağlantı)`;
  const body = [head, ...lines];
  if (graph.inc[node].length) body.push('Gelen (onu kullananlar, kullanıldığı satırla):', ...neighborLines(graph, graph.inc[node], '<-', { useSite: true }));
  if (graph.out[node].length) body.push('Giden (onun kullandıkları, tanım satırıyla):', ...neighborLines(graph, graph.out[node], '->', { useSite: false }));
  return clip(body.join('\n'), ANSWER_LIMIT);
}

// Everything that calls, imports or extends the symbol, then what depends on those, up to three steps.
export function affected(graph, query) {
  const { node, lines } = resolve(graph, query);
  if (node === null) return lines.join('\n');
  const seen = new Set([node]);
  const levels = [];
  let frontier = [node];
  for (let depth = 1; depth <= AFFECTED_DEPTH && frontier.length; depth += 1) {
    const next = [];
    for (const i of frontier) {
      for (const [j, r] of graph.inc[i]) {
        if (!DEPENDS.has(graph.relations[r]) || seen.has(j)) continue;
        seen.add(j);
        next.push(j);
      }
    }
    if (next.length) levels.push(next);
    frontier = next;
  }
  const all = levels.flat();
  const files = new Set(all.map((j) => graph.nodes[j][1]));
  const body = [`${at(graph, node)} değişirse etkilenenler: ${all.length} sembol, ${files.size} dosya`, ...lines];
  levels.forEach((level, d) => {
    body.push(`${d + 1}. derece:`);
    for (const j of level.slice(0, NEIGHBOR_LIMIT)) body.push(`- ${at(graph, j)}`);
    if (level.length > NEIGHBOR_LIMIT) body.push(`- … ${level.length - NEIGHBOR_LIMIT} tane daha`);
  });
  if (all.length === 0) body.push('Grafta onu kullanan bir şey yok.');
  return clip(body.join('\n'), ANSWER_LIMIT);
}

// Shortest chain of relations between two symbols, in either direction. "contains" (a file holding its
// symbols) is used only when nothing else connects them.
export function pathBetween(graph, fromQuery, toQuery) {
  const from = resolve(graph, fromQuery);
  const to = resolve(graph, toQuery);
  if (from.node === null || to.node === null) return [...from.lines, ...to.lines].filter((l) => l.includes('adında')).join('\n');
  for (const withContains of [false, true]) {
    const chain = shortestPath(graph, from.node, to.node, withContains);
    if (!chain) continue;
    const body = [`${graph.nodes[from.node][0]} → ${graph.nodes[to.node][0]}: ${chain.length} adım`, at(graph, from.node)];
    for (const { node, relation, forward } of chain) body.push(`  ${forward ? `-${relation}->` : `<-${relation}-`} ${at(graph, node)}`);
    return clip(body.join('\n'), ANSWER_LIMIT);
  }
  return `${graph.nodes[from.node][0]} ile ${graph.nodes[to.node][0]} arasında ${PATH_DEPTH} adımda bir bağlantı yok.`;
}

function shortestPath(graph, from, to, withContains) {
  const previous = new Map([[from, null]]);
  let frontier = [from];
  for (let depth = 0; depth < PATH_DEPTH && frontier.length; depth += 1) {
    const next = [];
    for (const i of frontier) {
      const steps = [...graph.out[i].map(([j, r]) => [j, r, true]), ...graph.inc[i].map(([j, r]) => [j, r, false])];
      for (const [j, r, forward] of steps) {
        if (previous.has(j) || (!withContains && graph.relations[r] === 'contains')) continue;
        previous.set(j, { node: i, relation: graph.relations[r], forward });
        if (j === to) return unwind(previous, to);
        next.push(j);
      }
    }
    frontier = next;
  }
  return null;
}

function unwind(previous, to) {
  const chain = [];
  for (let i = to; previous.get(i); i = previous.get(i).node) {
    const step = previous.get(i);
    chain.unshift({ node: i, relation: step.relation, forward: step.forward });
  }
  return chain;
}

// The symbols a question points at (from legacies map) with their nearest callers and callees.
export function querySubgraph(graph, seeds) {
  const nodes = [];
  for (const seed of seeds) {
    const i = graph.nodes.findIndex(([label, file, loc]) => file === seed.file && (loc === seed.loc || label === seed.label));
    if (i >= 0 && !nodes.includes(i)) nodes.push(i);
  }
  if (nodes.length === 0) return 'Sorudaki adlar grafta bir sembole denk gelmedi.';
  const body = [];
  for (const i of nodes) {
    body.push(at(graph, i));
    const near = [
      ...graph.inc[i].filter(([, r]) => DEPENDS.has(graph.relations[r])).map(([j, r, site]) => `  <- ${graph.relations[r]}  ${at(graph, j, site)}`),
      ...graph.out[i].filter(([, r]) => DEPENDS.has(graph.relations[r])).map(([j, r]) => `  -> ${graph.relations[r]}  ${at(graph, j)}`),
    ];
    body.push(...near.slice(0, QUERY_NEIGHBORS));
  }
  return clip(body.join('\n'), ANSWER_LIMIT);
}
