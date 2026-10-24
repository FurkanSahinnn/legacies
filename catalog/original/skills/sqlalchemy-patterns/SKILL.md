---
name: sqlalchemy-patterns
description: SQLAlchemy 2.0/2.1 ORM and Core patterns covering select() queries, typed Mapped[]/mapped_column models, Session and transaction scopes, eager loading against N+1, asyncio engines and sessions, connection pooling, Alembic autogenerate limits, and the 1.x idioms to stop writing (Query API, autocommit, engine.execute, implicit commits). Use when code imports sqlalchemy or alembic, defines models, writes queries or migrations, tunes engines or pools, or hits MissingGreenlet, DetachedInstanceError or N+1 queries.
---

# SQLAlchemy 2.x patterns

Targets SQLAlchemy 2.1 (current; Python ≥3.11) and 2.0 (still maintained). Everything below works on both unless marked. Alembic 1.20 is current. Framework wiring lives in the flask-patterns or fastapi-patterns skills; operational migration practice (expand/contract, backfills) lives in the database-migrations skill.

## Version facts

- **Removed in 2.0**
  - `Session(autocommit=True)` and library-level autocommit on `Connection`.
  - `engine.execute()`, "connectionless" execution and bound `MetaData`.
  - Passing plain strings to `execute()`; wrap SQL in `text()`.
  - `select([...])` with a list; columns are positional now.
  - `Query` stays as a legacy API that is not developed further; `Query.get()` becomes `Session.get()`.
- **New in 2.1**
  - Asyncio needs `pip install "sqlalchemy[asyncio]"`, because greenlet is no longer installed by default.
  - A bare `postgresql://` URL now means psycopg 3; write `postgresql+psycopg2://` to keep psycopg2.
  - Autoflush runs before every execution, including `text()`.
  - `Row` is typed `Row[int, str]` instead of `Row[tuple[int, str]]`.
  - Mapped-dataclass defaults are no longer written into `__dict__`.
  - On PostgreSQL, `Computed()` no longer implies STORED; pass `persisted=True` to keep STORED.

## Models

```python
from datetime import datetime
from sqlalchemy import ForeignKey, MetaData, String, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

class Base(DeclarativeBase):
    metadata = MetaData(naming_convention={
        "ix": "ix_%(column_0_label)s",
        "uq": "uq_%(table_name)s_%(column_0_name)s",
        "ck": "ck_%(table_name)s_%(constraint_name)s",
        "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
        "pk": "pk_%(table_name)s",
    })

class User(Base):
    __tablename__ = "user_account"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(320), unique=True)
    nickname: Mapped[str | None]                                  # Optional -> nullable
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    posts: Mapped[list["Post"]] = relationship(back_populates="author", lazy="raise")

class Post(Base):
    __tablename__ = "post"
    id: Mapped[int] = mapped_column(primary_key=True)
    author_id: Mapped[int] = mapped_column(ForeignKey("user_account.id"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    author: Mapped[User] = relationship(back_populates="posts")
```

- Nullability follows the annotation: `Mapped[str]` is NOT NULL and `Mapped[str | None]` allows NULL. Don't contradict it with `nullable=`.
- `default=` is applied by Python on ORM inserts only. `server_default=` lives in the DDL, so Core bulk inserts and other clients see it too.
- Put a naming convention on `MetaData` from day one. Alembic cannot reliably alter or drop unnamed constraints.
- Index foreign-key columns yourself. PostgreSQL and SQLite do not do it for you.
- Declare `back_populates` on both sides (`backref` is legacy). Use `lazy="raise"` (or `"raise_on_sql"`) on new relationships so a hidden lazy load fails in tests instead of becoming an N+1 in production.
- For collections too large to load, use `WriteOnlyMapped["Post"]`, then `user.posts.select()` and `user.posts.add(...)`. It replaces legacy `lazy="dynamic"`.

## Querying

```python
from sqlalchemy import func, insert, select, text, update

user = session.get(User, 42)                                       # checks the identity map; None if missing
user = session.scalars(select(User).where(User.email == email)).one_or_none()
emails = session.scalars(select(User.email).order_by(User.id).limit(50)).all()
pairs = session.execute(
    select(User.id, func.count(Post.id)).join(User.posts).group_by(User.id)
).all()                                                            # Row tuples, not entities
total = session.scalar(select(func.count()).select_from(User))
session.execute(update(User).where(User.id == 42).values(nickname="z"))  # ORM-enabled UPDATE
session.execute(insert(User), [{"email": "a@x.io"}, {"email": "b@x.io"}])  # bulk INSERT
rows = session.execute(text("SELECT id FROM post WHERE title LIKE :p"), {"p": prefix + "%"})
```

- `session.execute(select(User))` yields `Row` 1-tuples; `scalars()` yields `User` objects.
- `Result.first()` adds no LIMIT. Write `.limit(1)` yourself. `one()` raises unless exactly one row comes back.
- `where()` and `filter()` are the same on `Select`. In 2.1, `filter_by()` searches every FROM entity and raises `AmbiguousColumnError` when a name matches more than one.
- Bind values in raw SQL with `text("... :name")`, never with f-strings.
- For upserts, import `insert` from `sqlalchemy.dialects.postgresql` (or `.sqlite`) and use `.on_conflict_do_update(index_elements=[User.email], set_={...})`. With MySQL, use `on_duplicate_key_update()`.

## Sessions and transactions

```python
SessionLocal = sessionmaker(engine)          # configure once at startup

with SessionLocal.begin() as session:        # commits on success, rolls back on error, then closes
    session.add(User(email="a@x.io"))

with SessionLocal() as session:              # "commit as you go"
    session.add(User(email="b@x.io"))
    session.commit()

with engine.begin() as conn:                 # Core: commits at block end
    conn.execute(text("DELETE FROM post WHERE author_id = :id"), {"id": 7})
```

- A `Session` is one unit of work: one per request, job or task. Never share it across threads or asyncio tasks, and never keep it as a module-level global.
- `with engine.connect() as conn:` needs an explicit `conn.commit()`. Without it, the work is silently rolled back on close; 2.0 has no autocommit. The same goes for a session that you never commit.
- Commit at the use-case boundary (handler or service), not inside repositories or helpers. Inside `with session.begin():`, don't call `commit()`; the block commits.
- After a failed flush, call `session.rollback()` before reusing the session. Otherwise you get `PendingRollbackError`.
- `expire_on_commit=True` (the default) reloads attributes after commit. To read objects after commit (API responses, async code), set `expire_on_commit=False` or serialize before committing. Touching unloaded attributes after the session closes raises `DetachedInstanceError`.
- Use `session.begin_nested()` for a SAVEPOINT. Use `with session.no_autoflush:` while assembling objects whose intermediate state violates constraints.

## N+1 and loading strategy

```python
stmt = (
    select(User)
    .where(User.email.endswith("@example.com"))
    .options(selectinload(User.posts), raiseload("*"))
)
users = session.scalars(stmt).all()                 # 2 queries total, any other lazy load raises

stmt = select(Post).options(joinedload(Post.author)).order_by(Post.id.desc()).limit(20)
posts = session.scalars(stmt).all()
```

- **`selectinload`** is the default choice for collections. It issues one extra `SELECT ... WHERE pk IN (...)` per relationship, 500 keys per batch.
- **`joinedload`** suits many-to-one and one-to-one. On a collection it multiplies rows, so call `.unique()` on the result (`session.scalars(stmt).unique().all()`); the ORM raises if you forget.
- **`contains_eager`** fills a relationship from a JOIN you already wrote for filtering. Add `populate_existing` when the collection may already be loaded.
- **`subqueryload`** is legacy; use `selectinload`.
- **Seeing the statements:** turn on `echo=True`, or log `sqlalchemy.engine` at INFO, to count them. Hot paths deserve a test that asserts the query count.

## asyncio

```python
from sqlalchemy.ext.asyncio import AsyncAttrs, async_sessionmaker, create_async_engine

engine = create_async_engine("postgresql+asyncpg://app@db/app", pool_pre_ping=True)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)

async def authors_with_posts() -> list[User]:
    async with SessionLocal() as session:
        result = await session.scalars(select(User).options(selectinload(User.posts)))
        return list(result.all())
```

- **Async drivers.** Use `postgresql+asyncpg` or `postgresql+psycopg` (psycopg 3), `sqlite+aiosqlite`, and `mysql+asyncmy` or `mysql+aiomysql`.
- **No implicit I/O.** A lazy load or an expired attribute raises `MissingGreenlet`. To avoid it:
  - eager-load everything you will touch;
  - keep `expire_on_commit=False`;
  - use `await session.refresh(obj, ["posts"])`;
  - or mix in `AsyncAttrs` (`class Base(AsyncAttrs, DeclarativeBase)`) and use `await user.awaitable_attrs.posts`.
- **Concurrency.** Use one `AsyncSession` per task. Never share a session across `asyncio.gather()` branches.
- **Shutdown.** Call `await engine.dispose()` at shutdown, for example in the app lifespan. Otherwise connections are garbage-collected without a loop ("Event loop is closed").
- **Escape hatches.** `await session.run_sync(fn)` reuses sync ORM code. Use `session.stream()` or `stream_scalars()` for server-side cursors over large results.

## Connection pooling

- **Defaults and budget.** The default is `QueuePool` with `pool_size=5`, `max_overflow=10` and `pool_timeout=30`, per process. Peak connections ≈ processes × (5 + 10). With 8 gunicorn workers that is 120 against PostgreSQL's default `max_connections` of 100.
- **Liveness.** `pool_pre_ping=True` survives database restarts and idle-killing load balancers. Set `pool_recycle` below the server or proxy idle timeout (MySQL `wait_timeout`).
- **Forking.** Under gunicorn `--preload`, multiprocessing or Celery prefork, never let a child process use the parent's pooled connections. Create the engine after the fork, or call `engine.dispose(close=False)` in the child initializer.
- **External poolers.** Behind PgBouncer in transaction mode, or in serverless functions, use `poolclass=NullPool` and let the external pooler pool. asyncpg there also needs its prepared-statement caching turned off, as described in the dialect docs.
- **SQLite.** File databases use `QueuePool` (2.0+). `:memory:` uses `SingletonThreadPool` with pysqlite and `StaticPool` with aiosqlite. Each connection sees its own in-memory database. Tests that touch a `:memory:` DB from another thread need `poolclass=StaticPool, connect_args={"check_same_thread": False}`.

## Alembic

- Set `target_metadata = Base.metadata` in `env.py`, and import every model module before that line. Otherwise autogenerate proposes dropping the missing tables.
- **Workflow.** Run `alembic revision --autogenerate -m "add post.title"`, read and edit the file, then `alembic upgrade head`. `alembic check` (1.9+) fails CI when the models and migrations differ. Use `alembic stamp head` only to adopt an existing schema.
- **Autogenerate detects:** tables, columns, nullability, named indexes, uniques and foreign keys, and type changes (`compare_type` defaults on since 1.12).
- **Autogenerate misses:**
  - Table and column renames, which come out as drop+add and lose data. Rewrite them as `op.rename_table()` or `op.alter_column(..., new_column_name=...)`.
  - Anonymous constraints, and CHECK constraints (opt-in by name only).
  - Server defaults, unless `compare_server_default=True`.
  - Sequences, and new PostgreSQL enum values. Write `ALTER TYPE ... ADD VALUE` by hand.
- **Data migrations** use `op.execute()` or ad-hoc `sa.table()`/`sa.column()` constructs. Never import application models, which change after the migration is written.
- **SQLite** has a limited ALTER, so set `render_as_batch=True` in `context.configure()` and use `op.batch_alter_table()` (copy-and-move).
- **PostgreSQL concurrent indexes:** wrap the call in `with op.get_context().autocommit_block():` and use `op.create_index(..., postgresql_concurrently=True)`.
- **Templates.** Use `alembic init -t async migrations` for async engines. `-t pyproject` (1.16+) moves configuration into `pyproject.toml`.

## 1.x idioms to replace

| 1.x (don't write) | 2.x |
|---|---|
| `session.query(User).filter_by(email=e).first()` | `session.scalars(select(User).filter_by(email=e).limit(1)).first()` |
| `session.query(User).get(5)`, `User.query.get(5)` | `session.get(User, 5)` |
| `engine.execute(sql)`, `conn.execute("SELECT 1")` | `with engine.begin() as conn: conn.execute(text(sql))` |
| `select([User.id, User.email])` | `select(User.id, User.email)` |
| `sessionmaker(autocommit=True)` | removed; use `with SessionLocal.begin() as session:` |
| `from sqlalchemy.ext.declarative import declarative_base` | `class Base(DeclarativeBase): ...` |
| `id = Column(Integer, primary_key=True)` | `id: Mapped[int] = mapped_column(primary_key=True)` |
| `relationship("Post", backref="author")` | `back_populates` declared on both sides |
| `relationship(..., lazy="dynamic")` | `WriteOnlyMapped[...]` |
| `session.bulk_save_objects(objs)` | `session.execute(insert(Model), list_of_dicts)` |
| `query.count()` on a joined query | `select(func.count()).select_from(subquery)` |
| `create_engine(url, future=True)` | drop the flag; 2.x is always "future" |

## Testing

- Run integration tests against the production dialect (a CI service or Testcontainers). SQLite passes queries that PostgreSQL rejects, and the reverse.
- Use a rollback-per-test fixture, which still works when the code under test calls `commit()`:

```python
@pytest.fixture
def session(engine):
    with engine.connect() as conn:
        outer = conn.begin()
        with Session(bind=conn, join_transaction_mode="create_savepoint") as s:
            yield s
        outer.rollback()
```

- Count statements with an `event.listen(engine, "before_cursor_execute", ...)` counter to pin N+1 fixes. Add `raiseload("*")` in tests for read paths that must not lazy load.

## Review checklist

- [ ] No `Query`/`Model.query`, `engine.execute`, list-form `select`, string SQL without `text()` or autocommit flags in new code.
- [ ] Every write path commits exactly once at the boundary, and errors roll back.
- [ ] Sessions are per request or task, never shared across threads or tasks, and always closed.
- [ ] Relationship access in loops or serializers is eager-loaded. `joinedload` on a collection is followed by `.unique()`.
- [ ] Async code: `expire_on_commit=False`, no lazy loads, `engine.dispose()` at shutdown, `sqlalchemy[asyncio]` installed.
- [ ] Pool size × processes stays within the database limit, `pool_pre_ping` is on, and engines are not shared across forks.
- [ ] Models have a naming convention, nullability matches the annotations, and FK columns are indexed.
- [ ] The Alembic revision was reviewed (renames, enums, server defaults, data loss), and `alembic check` is clean.

<!-- Written for legacies (MIT). Checked against: https://docs.sqlalchemy.org/en/21/changelog/migration_21.html https://docs.sqlalchemy.org/en/20/changelog/migration_20.html https://docs.sqlalchemy.org/en/21/orm/queryguide/relationships.html https://docs.sqlalchemy.org/en/21/orm/extensions/asyncio.html https://docs.sqlalchemy.org/en/21/core/pooling.html https://docs.sqlalchemy.org/en/21/dialects/sqlite.html https://docs.sqlalchemy.org/en/21/errors.html https://alembic.sqlalchemy.org/en/latest/autogenerate.html https://alembic.sqlalchemy.org/en/latest/tutorial.html https://www.sqlalchemy.org/blog/, 2026-10 -->
