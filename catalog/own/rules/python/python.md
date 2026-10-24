---
paths:
  - "**/*.py"
---
<!-- Adapted from ECC (MIT, Copyright (c) 2026 Affaan Mustafa): rules/python/coding-style.md, rules/python/patterns.md, rules/python/security.md, rules/python/testing.md, rules/python/hooks.md, rules/python/fastapi.md -->
# Python

## Style
- PEP 8, enforced by the repo's formatter and linter (ruff, or black plus isort); type-check with mypy or pyright.
- Annotate every function signature, parameters and return type, with `X | None` for optionals on 3.10+.
- Value objects are immutable (`@dataclass(frozen=True)` or `NamedTuple`); a plain `@dataclass` suits request and response DTOs.
- Prefer `typing.Protocol` (structural typing) for interfaces.
- Manage files, locks, connections and sessions with `with`; use generators for large or lazy sequences.

## Security and tests
- Read required secrets with `os.environ["API_KEY"]`, which raises `KeyError` when missing, not `os.getenv`, which silently returns `None`.
- Run bandit (or ruff's `S` rules) for static security checks.
- pytest, with markers for categories (`@pytest.mark.unit`, `@pytest.mark.integration`) and coverage via `pytest --cov=src --cov-report=term-missing`.

## FastAPI
- Build the app in `create_app()`. Routers stay thin; business logic and persistence live in services. Request, update and response schemas are separate models.
- `async def` endpoints use only async database and HTTP clients; `requests`, sync SQLAlchemy sessions or other blocking I/O there stall the event loop.
- Sessions, auth and clients come from `Depends(...)`; never create `SessionLocal()` or long-lived clients inside a handler.
- Endpoints returning data set `response_model`, and response models never contain passwords, hashes, tokens or internal auth state. Express rules as Pydantic field constraints, not hand-written checks.
- CORS origins are set per environment, never `*` together with credentials. JWT validation checks expiry, issuer, audience and algorithm.
- Tests override the exact dependency passed to `Depends`, clear `app.dependency_overrides` afterwards, and use an async client for async apps.
