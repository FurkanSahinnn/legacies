#!/usr/bin/env node
// Test double for graphify: logs every call and writes a one-node graph for extract and update.
// FAKE_GRAPHIFY_LOG: file that receives one JSON line per call. FAKE_GRAPHIFY_NO_GRAPH=1: build writes nothing.
// FAKE_GRAPHIFY_VERSION: what --version reports.
import fs from 'node:fs';
import path from 'node:path';

const [cmd, ...args] = process.argv.slice(2);
const out = process.env.GRAPHIFY_OUT;
if (process.env.FAKE_GRAPHIFY_LOG) {
  fs.appendFileSync(process.env.FAKE_GRAPHIFY_LOG, `${JSON.stringify({ cmd, args, out, backend: process.env.GRAPHIFY_BACKEND })}\n`);
}
if (cmd === '--version') {
  process.stdout.write(`graphify ${process.env.FAKE_GRAPHIFY_VERSION || '0.0.0'}\n`);
} else if (cmd === 'extract' || cmd === 'update') {
  if (process.env.FAKE_GRAPHIFY_NO_GRAPH !== '1') {
    fs.mkdirSync(out, { recursive: true });
    const node = { id: 'a', label: 'buildFakeGraph()', file_type: 'code', source_file: 'src/fake.ts', source_location: 'L1' };
    fs.writeFileSync(path.join(out, 'graph.json'), JSON.stringify({ nodes: [node], links: [] }));
  }
  // What graphify 0.9.93 prints: progress, then a next step that points at a command legacies never runs.
  process.stdout.write(`[graphify ${cmd}] wrote ${out}/graph.json: 1 nodes, 0 edges\n`);
  process.stdout.write(`[graphify ${cmd}] next: run \`graphify cluster-only .\` to generate GRAPH_REPORT.md and name communities\n`);
} else {
  process.exitCode = 2;
}
