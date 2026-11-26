---
type: llm
---

PASS if the first answer traces the route in `src/http/session-route.ts` to `src/config/session-policy.ts`. It must say that local development uses 30 seconds, production defaults to 60 seconds, and a positive whole number in `SESSION_TTL_SECONDS` overrides the production default. It must explain that an invalid override falls back to 60 seconds.

FAIL if it presents the historical 30-second production default as current, or omits a condition that changes the answer.
