#!/bin/sh
# legacies installer for macOS and Linux. It only needs Node 18+; the installer checks everything else.
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
if ! command -v node >/dev/null 2>&1; then
  echo "legacies: Node.js 18+ gerekli ama bulunamadı."
  if [ "$(uname)" = "Darwin" ]; then
    echo "  brew install node   (ya da https://nodejs.org)"
  else
    echo "  nvm ile kur: https://github.com/nvm-sh/nvm   (dağıtımın node paketi eski olabilir)"
  fi
  exit 1
fi
MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$MAJOR" -lt 18 ]; then
  echo "legacies: Node $MAJOR bulundu, en az 18 gerekli."
  exit 1
fi
chmod +x "$DIR/bin/legacies" "$DIR/install.sh" "$DIR/uninstall.sh" 2>/dev/null || true
exec node "$DIR/scripts/setup.mjs" install "$@"
