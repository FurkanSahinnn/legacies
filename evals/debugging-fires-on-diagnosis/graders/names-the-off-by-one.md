---
type: llm
---

PASS if the reply says the slice end `start + size - 1` drops the last row of every page (slice's end index is exclusive, so a page of 20 returns 19) and fixes it to `start + size`.

FAIL if the reply misses the off-by-one, blames the query or the test, or proposes a fix that still returns 19 rows.
