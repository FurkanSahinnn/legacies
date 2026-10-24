#!/bin/sh
# Removes everything legacies installed. Project memories are kept unless you choose otherwise.
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
if ! command -v node >/dev/null 2>&1; then
  echo "legacies: kaldırma programı Node.js ister; node bulunamadı."
  exit 1
fi
exec node "$DIR/scripts/setup.mjs" uninstall "$@"
