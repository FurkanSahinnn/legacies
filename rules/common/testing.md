---
paths:
  - "**/*.test.*"
  - "**/*.spec.*"
  - "**/__tests__/**"
  - "**/test_*.py"
  - "**/*_test.py"
  - "**/conftest.py"
  - "**/*Tests.cs"
---
<!-- Adapted from ECC (MIT, Copyright (c) 2026 Affaan Mustafa): rules/common/testing.md, rules/web/testing.md, rules/react/testing.md, skills/coding-standards/SKILL.md -->
# Tests

- Arrange-Act-Assert, one behavior per test, named for that behavior: `returns empty array when no markets match query`, never `works`.
- Assert observable behavior, not internals: no assertions on private state, render counts or which helpers ran.
- Tests are independent and deterministic: no shared mutable state, no order dependence, no sleeps or fixed timeouts (wait for a condition instead).
- Mock at the boundaries (network, clock, randomness, third-party services), not the unit under test.
- Snapshots only for stable serialized data, never for rendered UI.
