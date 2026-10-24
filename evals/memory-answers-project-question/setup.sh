#!/usr/bin/env bash
# A small API repo whose legacies memory holds one fact the code cannot reveal.
set -euo pipefail
git init -q -b main
git config user.email eval@example.com
git config user.name eval
mkdir -p src/payments .legacies/memory/gotcha .legacies/sessions .legacies/state
cat > src/payments/webhook.ts <<'TS'
import crypto from 'node:crypto';

export function verifySignature(body: unknown, signature: string, secret: string): boolean {
  const payload = JSON.stringify(body);
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
TS
cat > .legacies/PROJECT.md <<'MD'
---
verified: 2026-10-20
---
# shop-api

## Amaç
Ödeme ve sipariş API'si. Önünde bir Cloudflare Worker çalışır.
MD
printf '# Güncel durum\n\n## Odak\nÖdeme webhook hataları.\n' > .legacies/STATE.md
cat > .legacies/memory/gotcha/webhook-imzasi-x-original-body-ile-dogrulanir.md <<'MD'
---
title: Webhook imzası x-original-body başlığındaki ham gövdeyle doğrulanır
type: gotcha
summary: Cloudflare Worker gövdeyi yeniden serialize ediyor; req.body ile imza tutmaz
paths: [src/payments/**]
verified: 2026-10-20
status: active
---
Önümüzdeki Cloudflare Worker JSON gövdeyi yeniden serialize ettiği için imza req.body ya da JSON.stringify(body) ile tutmaz. Worker, sağlayıcının gönderdiği ham gövdeyi base64 olarak x-original-body başlığında iletir; imza onunla doğrulanmalı.
MD
git add -A
git commit -qm init
