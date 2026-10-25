#!/usr/bin/env bash
# A small package whose README has a typo; the code is fine.
set -euo pipefail
git init -q -b main
git config user.email eval@example.com
git config user.name eval
mkdir -p src test
printf '# billing\n\nKurulm:\n\n    npm install\n' > README.md
printf 'export const add = (a, b) => a + b;\n' > src/math.js
printf "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add } from '../src/math.js';\n\ntest('add sums', () => assert.equal(add(1, 2), 3));\n" > test/math.test.js
git add -A
git commit -qm init
