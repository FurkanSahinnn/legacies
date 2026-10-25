#!/usr/bin/env bash
# A small JS package with a test suite and a rounding bug in src/money.js.
set -euo pipefail
git init -q -b main
git config user.email eval@example.com
git config user.name eval
mkdir -p src test
cat > package.json <<'JSON'
{ "name": "billing", "type": "module", "scripts": { "test": "node --test" } }
JSON
cat > src/money.js <<'JS'
export function splitCents(totalCents, n) {
  const share = Math.floor(totalCents / n);
  return Array.from({ length: n }, () => share);
}

export function formatCents(cents) {
  return `${(cents / 100).toFixed(2)} TL`;
}
JS
cat > test/money.test.js <<'JS'
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatCents, splitCents } from '../src/money.js';

test('formatCents shows two decimals', () => {
  assert.equal(formatCents(1050), '10.50 TL');
});

test('splitCents splits evenly when the total divides', () => {
  assert.deepEqual(splitCents(99, 3), [33, 33, 33]);
});
JS
git add -A
git commit -qm init
