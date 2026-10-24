---
name: flask-patterns
description: Flask 3.1 application patterns covering the app factory and blueprints, config and secrets, app/request context rules, Flask-SQLAlchemy 3.1, Flask-Migrate, Flask-Login and Flask-JWT-Extended, JSON error handlers, async view limits, CSRF/session/debug-mode security, pytest with the test client, and gunicorn behind a proxy with ProxyFix. Use when editing a Flask app (flask in pyproject or requirements, create_app, Blueprint, @bp.route, flask db), adding an extension, writing Flask tests or deploying one.
---

# Flask 3.1 patterns

Targets Flask 3.1.x (3.1.3, Feb 2026; Python ≥3.9, Werkzeug ≥3.1). Flask 3.2 is unreleased: it drops Python <3.11, merges `RequestContext` into `AppContext` and makes `redirect()` default to 303. Don't rely on either until the lockfile has it. For ORM, session and Alembic detail, see the sqlalchemy-patterns skill if it is installed.

## Removed or changed APIs that still get generated

| Don't write | Write |
|---|---|
| `from flask import Markup, escape` | `from markupsafe import Markup, escape` |
| `@app.before_first_request` (removed 2.3) | do setup in `create_app()` or a CLI command |
| `FLASK_ENV`, `app.env` (removed 2.3) | `flask --app pkg run --debug` locally; nothing in prod |
| `JSON_SORT_KEYS`, `JSON_AS_ASCII`, `app.json_encoder` | `app.json.sort_keys = False`, `app.json.ensure_ascii`; subclass `flask.json.provider.DefaultJSONProvider` |
| `_app_ctx_stack`, `_request_ctx_stack` | `current_app`, `g`, `request` |
| `flask.__version__` | `importlib.metadata.version("flask")` |
| `Model.query.get(id)` (Flask-SQLAlchemy) | `db.session.get(Model, id)` or `db.get_or_404(Model, id)` |

Since 2.x: `@bp.get/post/put/delete`, `flask --app`, and returning a `dict` or `list` from a view (both become JSON). `request.get_json()` and `request.json` raise **415** when the Content-Type is not JSON (Werkzeug ≥2.3); pass `silent=True` only when a body is optional.
Added in 3.1: `SECRET_KEY_FALLBACKS`, `TRUSTED_HOSTS`, `MAX_FORM_MEMORY_SIZE` (500 kB default), `MAX_FORM_PARTS` (1000), per-request `request.max_content_length`, `SESSION_COOKIE_PARTITIONED`.

## App factory and blueprints

```python
# app/__init__.py
from flask import Flask
from .extensions import db, migrate

def create_app(overrides: dict | None = None) -> Flask:
    app = Flask(__name__, instance_relative_config=True)
    app.config.from_object("app.config.Defaults")
    app.config.from_prefixed_env()        # FLASK_SECRET_KEY -> SECRET_KEY; values parsed as JSON
    if overrides:
        app.config.update(overrides)
    if not app.config.get("SECRET_KEY"):
        raise RuntimeError("SECRET_KEY is not configured")

    db.init_app(app)
    migrate.init_app(app, db)

    from .api import bp as api_bp         # import inside the factory to avoid import cycles
    app.register_blueprint(api_bp, url_prefix="/api")
    return app
```

- Extensions are created unbound in `extensions.py` and bound with `init_app()`. Modules import `db`, never `app`. Inside code, reach the app through `current_app`.
- Use one blueprint per feature. The blueprint name prefixes endpoints (`url_for("api.get_item", item_id=1)`). Set `url_prefix` at registration. Blueprints can nest with `bp.register_blueprint()`.
- Do no work at import time that needs config or a database. Extensions read config in `init_app`, so load config before binding them.
- `flask --app app routes` lists URL rules. `.env` and `.flaskenv` are loaded only by the `flask` CLI (with python-dotenv), never by gunicorn.

## Config and secrets

- Load defaults first, then `from_prefixed_env()`, then test overrides. Keep deploy-specific files in `instance/`, out of version control (`from_pyfile("config.py", silent=True)`).
- `SECRET_KEY` is required and comes from the environment or a secret manager. Generate it with `python -c 'import secrets; print(secrets.token_hex())'`. Rotate it by moving the old key into `SECRET_KEY_FALLBACKS`. Flask's session supports fallbacks; extensions that sign with the key may not.
- Never set `DEBUG` in config files. Debug mode belongs to `flask run --debug` on a developer machine.
- In `from_prefixed_env`, only lowercase `true`/`false` become booleans, and `__` builds nested keys (`FLASK_API__TIMEOUT=5`).

## Contexts: the main source of runtime errors

- `current_app` and `g` need an app context. `request` and `session` need a request context. Flask pushes both for each request, and pushes an app context for `flask` CLI commands.
- Scripts, threads, Celery or RQ tasks and startup code run outside a request. Wrap them in `with app.app_context():`. "Working outside of application context" means the code runs outside one.
- `g` lasts for one app context, which is roughly one request. It is not a cross-request cache.
- Don't hand `request` or other proxies to threads. Copy the values you need, or pass IDs to a task queue. To pass the real app object, use `current_app._get_current_object()`.
- A generator that reads `request` after the view returns must be wrapped in `stream_with_context()`.
- Release per-request resources in `teardown_appcontext`, which runs on errors too.

## Extensions

```python
# app/extensions.py
from flask_login import LoginManager
from flask_migrate import Migrate
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy.orm import DeclarativeBase

class Base(DeclarativeBase):
    pass

db = SQLAlchemy(model_class=Base)   # Flask-SQLAlchemy 3.1: typed Mapped[] models
migrate = Migrate()                 # Flask-Migrate 4: batch mode + type comparison on by default
login = LoginManager()
```

```python
item = db.get_or_404(Item, item_id)
page = db.paginate(db.select(Item).order_by(Item.id), per_page=20)  # max_per_page defaults to 100
rows = db.session.scalars(db.select(Item).where(Item.owner_id == uid)).all()
```

- **Flask-SQLAlchemy 3.1**
  - `Model.query` and `db.session.query()` are the legacy Query API. Use `db.select()` with `db.session.execute()`, `scalars()` or `get()` instead.
  - The session is scoped to the app context and removed at teardown, so uncommitted work is discarded. Commit at the end of the use case and roll back on error.
  - `SQLALCHEMY_DATABASE_URI` has no default; a missing value is an error. Put pool options in `SQLALCHEMY_ENGINE_OPTIONS`, for example `{"pool_pre_ping": True}`.
  - The extension is synchronous only; it has no `AsyncSession`.
- **Flask-Migrate.** Run `flask db init` once. For each change, run `flask db migrate -m "msg"`, read and fix the generated file, then `flask db upgrade`. `flask db check` fails when models and migrations drift. Autogenerate does not detect renames.
- **Flask-Login**
  - The `@login.user_loader` returns `None` for an unknown id; it never raises.
  - Validate `next` before redirecting: same host, relative path only.
  - Set `REMEMBER_COOKIE_SECURE=True`.
  - Use `@login_required` on views and `current_user` in code.
- **Flask-JWT-Extended 4.7**
  - The decorator form is `@jwt_required()` with parentheses (`refresh=True`, `optional=True`, `fresh=True`).
  - The identity must be a string, as in `create_access_token(identity=str(user.id))`. `JWT_VERIFY_SUB` defaults to on and rejects a non-string `sub`.
  - Give it its own `JWT_SECRET_KEY`; otherwise it falls back to `SECRET_KEY`. Access tokens default to 15 minutes.
  - Revoke tokens through `@jwt.token_in_blocklist_loader`.
  - With `JWT_TOKEN_LOCATION=["cookies"]`, set `JWT_COOKIE_SECURE=True` (default `False`) and keep `JWT_COOKIE_CSRF_PROTECT` on.

## Errors and JSON APIs

```python
import json
from werkzeug.exceptions import HTTPException

def register_error_handlers(app):
    @app.errorhandler(HTTPException)
    def http_error(e: HTTPException):
        resp = e.get_response()            # keeps status and headers such as Allow, WWW-Authenticate
        resp.set_data(json.dumps({"error": e.name, "detail": e.description}))
        resp.mimetype = "application/json"
        return resp

    @app.errorhandler(Exception)           # HTTPException still goes to the handler above
    def unhandled(e: Exception):
        app.logger.exception("unhandled error")
        return {"error": "Internal Server Error"}, 500   # never echo str(e)
```

- Registering both handlers is deliberate, because the more specific class wins. With only an `Exception` handler, check `isinstance(e, HTTPException)` and return `e`, or every 404 and 405 becomes a 500.
- Blueprint `errorhandler`s never see routing 404/405 errors, which happen before a blueprint is selected. Register those on the app (or with `bp.app_errorhandler`) and branch on `request.path` if HTML and JSON differ.
- Map domain exceptions with `register_error_handler(DomainError, fn)` rather than try/except in every view. Use `abort(404, description=...)` for one-off HTTP errors.
- Flask has no input validation. Validate JSON at the boundary with Pydantic or marshmallow and return 400/422 with field errors. Serialize ORM objects explicitly; never return them raw.

## Async views (`pip install "flask[async]"`)

- An `async def` view runs on a new event loop in the worker thread. The worker stays busy for the whole request, so request concurrency does not rise. Use async views only to fan out I/O inside one request, such as `asyncio.gather` over several HTTP calls.
- Tasks still pending when the view returns are cancelled, so `asyncio.create_task` fire-and-forget does not work. Use a task queue.
- Each request gets its own loop, so loop-bound objects (an `httpx.AsyncClient`, an asyncpg pool) cannot be shared across requests.
- Older extension decorators do not await coroutine views. Flask-SQLAlchemy calls block inside `async def`.
- For a mostly-async codebase, use Quart (the Flask API on ASGI) or FastAPI. Gevent workers can serve many long-lived connections.

## Security

- **Debug mode is remote code execution.** The Werkzeug debugger runs arbitrary Python from the browser, and the `flask run` server is for development only. Never commit `app.run(debug=True)` as an entry point.
- **The session cookie is signed, not encrypted.** Clients can read it, so store IDs and never secrets.
  - Set `SESSION_COOKIE_SECURE=True` and `SESSION_COOKIE_SAMESITE="Lax"` (default `None`). `HTTPONLY` is already on.
  - Shorten `PERMANENT_SESSION_LIFETIME` (default 31 days) for sensitive apps.
  - Use server-side sessions when revocation is needed.
- **Flask has no built-in CSRF protection.** For cookie-authenticated forms, use Flask-WTF `CSRFProtect` (`{{ csrf_token() }}` in templates, an `X-CSRFToken` header from fetch). Exempt only blueprints authenticated with bearer tokens (`csrf.exempt(api_bp)`).
- **Request limits.** `MAX_CONTENT_LENGTH` defaults to `None` (no limit), so set it, and use per-view `request.max_content_length` for upload endpoints.
- **Host header.** Set `TRUSTED_HOSTS` (3.1) or enforce the host at the proxy. External URLs and password-reset links are built from the Host header.
- **Templates.** Autoescape is on for `.html`. The holes are `|safe`, `Markup(user_data)` and `render_template_string(user_input)`, which allows template injection.
- **Files.** Serve user-named files with `send_from_directory()` (safe join), never `send_file(user_path)`, and run uploads through `secure_filename()`.
- **Headers.** Flask sets no security headers. Add HSTS, CSP and `X-Content-Type-Options` at the proxy or in an `after_request` hook.

## Testing

```python
# tests/conftest.py
import pytest
from app import create_app
from app.extensions import db

@pytest.fixture
def app(tmp_path):
    app = create_app({
        "TESTING": True,                   # exceptions propagate instead of becoming 500 pages
        "SECRET_KEY": "test",
        "SQLALCHEMY_DATABASE_URI": f"sqlite:///{tmp_path / 'test.db'}",
        "WTF_CSRF_ENABLED": False,
    })
    with app.app_context():
        db.create_all()
    yield app

@pytest.fixture
def client(app):
    return app.test_client()

def test_create_item(client):
    resp = client.post("/api/items", json={"name": "lamp"})
    assert resp.status_code == 201
    assert resp.get_json()["name"] == "lamp"
```

- `with client:` keeps the last request's context alive so you can assert on `session` or `g`. To pre-seed a session, use `client.session_transaction()`.
- Test CLI commands with `app.test_cli_runner().invoke(args=["seed-db"])`. Test request-dependent helpers inside `app.test_request_context("/path")`.
- Run SQL-sensitive tests against the production engine (Postgres in CI or Testcontainers). SQLite hides type, constraint and locking differences.
- Commands: `pytest -q`, `pytest --cov=app --cov-report=term-missing`.

## Deployment

```bash
gunicorn -w 4 -b 127.0.0.1:8000 'app:create_app()'   # quote the factory call; bind locally behind nginx
```

```python
from werkzeug.middleware.proxy_fix import ProxyFix
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=1)
```

- **ProxyFix.** Apply it only behind a proxy. Set each count to the number of proxies that actually set that header. A count that is too high lets clients spoof `X-Forwarded-For` (rate limits, audit logs) and `X-Forwarded-Host`. Without ProxyFix, `request.remote_addr` is the proxy and external URLs come out as `http://`.
- **Connection budget.** Workers × (`pool_size` + `max_overflow`) must stay under the database connection limit. With `--preload`, don't touch the database in the master process: dispose engines after fork, or create them lazily.
- **Server choice.** Gunicorn is POSIX-only; use waitress on Windows. uWSGI is in maintenance mode, so prefer gunicorn for new deployments.
- **Migrations.** Run `flask db upgrade` as a release step, never at import or in every worker's startup.

## Review checklist

- [ ] The app is built in `create_app()`, extensions bind via `init_app`, and no module imports a global `app`.
- [ ] `SECRET_KEY` comes from the environment, debug is off, and the dev server is not the production server.
- [ ] Session, remember-me and JWT cookies are Secure and SameSite, and cookie-authenticated forms have CSRF protection.
- [ ] `MAX_CONTENT_LENGTH` is set, uploads use `secure_filename`, and user-named files go through `send_from_directory`.
- [ ] API errors are JSON, a 404/405 is not turned into a 500, and no traceback or `str(e)` reaches clients.
- [ ] New queries use `db.select()` or `db.session.get()` (no `Model.query`), with explicit commit and rollback.
- [ ] Migrations were generated, reviewed and committed, and the deploy runs `flask db upgrade` once.
- [ ] Async views are only used for in-request fan-out, with no fire-and-forget tasks.
- [ ] ProxyFix counts match the real proxy chain.
- [ ] Tests use the factory with test config, and `pytest` passes.

<!-- Written for legacies (MIT). Checked against: https://flask.palletsprojects.com/en/stable/changes/ https://flask.palletsprojects.com/en/latest/changes/ https://flask.palletsprojects.com/en/stable/config/ https://flask.palletsprojects.com/en/stable/errorhandling/ https://flask.palletsprojects.com/en/stable/async-await/ https://flask.palletsprojects.com/en/stable/deploying/gunicorn/ https://flask.palletsprojects.com/en/stable/deploying/proxy_fix/ https://werkzeug.palletsprojects.com/en/stable/wrappers/ https://flask-sqlalchemy.readthedocs.io/en/stable/changes/ https://flask-sqlalchemy.readthedocs.io/en/stable/queries/ https://github.com/miguelgrinberg/Flask-Migrate/blob/main/CHANGES.md https://flask-jwt-extended.readthedocs.io/en/stable/options.html https://uwsgi-docs.readthedocs.io/en/latest/, 2026-10 -->
