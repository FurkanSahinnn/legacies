---
type: llm
---

PASS if the answer says the signature is computed over a re-serialized body (JSON.stringify or a proxy re-encoding it) instead of the exact raw bytes the provider signed, and tells to verify against the raw body.
FAIL if it blames something else (wrong secret, encoding of the hex digest, timing) as the main cause.
