#!/usr/bin/env bash
set -euo pipefail

git init -q -b main
git config user.email eval@example.com
git config user.name eval
mkdir -p src/http src/config

cat > src/http/session-route.ts <<'TS'
import { sessionTtl } from '../config/session-policy';

export function sessionRoute() {
  return { expiresInSeconds: sessionTtl(process.env) };
}
TS

cat > src/config/session-policy.ts <<'TS'
export function sessionTtl(env: Record<string, string | undefined>) {
  if (env.NODE_ENV !== 'production') return 30;
  const override = Number(env.SESSION_TTL_SECONDS);
  return Number.isInteger(override) && override > 0 ? override : 30;
}
TS

git add src
git commit -qm 'Initial session TTL policy'

mkdir -p .legacies/memory/decision
cat > .legacies/memory/decision/session-ttl.md <<MD
---
title: Oturum süresi üretimde varsayılan olarak 30 saniye
type: decision
summary: Üretimde geçerli bir SESSION_TTL_SECONDS ayarı yoksa oturum süresi 30 saniyedir.
paths: [src/config/session-policy.ts]
verified: 2026-01-01@$(git rev-parse --short=8 HEAD)
status: active
---
Bu bilgi ilk oturum politikası uygulandığında doğrulandı.
MD

cat > src/config/session-policy.ts <<'TS'
export function sessionTtl(env: Record<string, string | undefined>) {
  if (env.NODE_ENV !== 'production') return 30;
  const override = Number(env.SESSION_TTL_SECONDS);
  return Number.isInteger(override) && override > 0 ? override : 60;
}
TS

git add src/config/session-policy.ts
git commit -qm 'Increase the production default to 60 seconds'
