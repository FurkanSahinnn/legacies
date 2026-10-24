---
name: sqlite-patterns
description: SQLite as an application database covering WAL and busy_timeout, the single-writer model and BEGIN IMMEDIATE, STRICT tables and type-affinity traps, foreign keys being off by default, schema changes ALTER TABLE cannot do, online backups (VACUUM INTO, backup API, Litestream), FTS5, JSON functions, and driver choice in Node, Python, Go, Rust and .NET, plus when to use something else (libSQL/Turso, LiteFS). Use when a project opens a .db/.sqlite file, depends on better-sqlite3, aiosqlite, rusqlite, modernc.org/sqlite or Microsoft.Data.Sqlite, or hits "database is locked".
---

# SQLite in applications

Current releases are 3.53/3.54 (2026). Drivers and OSes bundle their own copy, so check `SELECT sqlite_version();` before using newer features.

| Feature | Since |
|---|---|
| Upsert | 3.24 |
| `RENAME COLUMN` | 3.25 |
| `VACUUM INTO` | 3.27 |
| Generated columns | 3.31 |
| `RETURNING`, `DROP COLUMN` | 3.35 |
| `STRICT` | 3.37 |
| JSON built in, `->`/`->>` | 3.38 |
| JSONB | 3.45 |
| `ALTER TABLE t ALTER col SET/DROP NOT NULL`, CHECK changes | 3.53 |

If several connections write to one WAL database, run ≥3.51.3 (or the 3.50.7 or 3.44.6 backports). Earlier versions back to 3.7.0 have a rare WAL-reset race that can corrupt the file.

## Per-connection setup

```sql
PRAGMA journal_mode = WAL;     -- stored in the file; returns 'wal' on success
PRAGMA synchronous = NORMAL;   -- safe with WAL: a power loss may drop the last commits, never corrupts
PRAGMA busy_timeout = 5000;    -- the C default is 0: fail instantly with SQLITE_BUSY
PRAGMA foreign_keys = ON;      -- off by default, per connection, ignored inside a transaction
PRAGMA optimize = 0x10002;     -- long-lived connections: on open, then PRAGMA optimize hourly or daily
```

- Except `journal_mode`, these settings are per connection. With a pool, apply them in the driver's on-connect hook or in the DSN, not once at startup.
- Defaults differ by driver, so always set the pragmas explicitly:

| Driver | Foreign keys | Busy handling |
|---|---|---|
| better-sqlite3 | on (compiled in) | 5 s timeout |
| `node:sqlite` | on | 0; pass `timeout` |
| sqlx | on | 5 s |
| Microsoft.Data.Sqlite (bundled `e_sqlite3`) | on (compiled in) | retries until the 30 s command timeout |
| Python `sqlite3` | off | 5 s (`timeout=`) |
| mattn/go-sqlite3 | off | 5 s |
| modernc.org/sqlite, `sqlite3` CLI | off | set it yourself |

## Concurrency: one writer at a time

- **WAL basics.** Readers and the writer don't block each other, but there is exactly one write transaction at a time per database file. WAL relies on shared memory, so every process must be on the same host. Never put the database on NFS or SMB.
- **What `busy_timeout` can't fix.** It makes writers wait instead of failing. It cannot rescue a deferred transaction that read first and then tries to write after another connection committed: SQLite returns `SQLITE_BUSY` at once rather than deadlock. Start every transaction that may write with `BEGIN IMMEDIATE`, and retry the whole transaction on `SQLITE_BUSY`.
- **Short write transactions.** No network calls, user input or slow loops while one is open. Batch bulk inserts into a single transaction, which is orders of magnitude faster than one autocommit per row.
- **Single writer path.** Inside one process, use one writer connection (or a queue or mutex) plus a pool of readers. With Go `database/sql`, open a separate writer `*sql.DB` with `SetMaxOpenConns(1)`.
- **Checkpoint starvation.** A reader that never finishes blocks checkpoints, and the `-wal` file grows without bound. Bound read transactions, watch the `-wal` size, and run `PRAGMA wal_checkpoint(TRUNCATE)` in quiet periods.

## Driver choice

| Runtime | Use | Notes |
|---|---|---|
| Node | `better-sqlite3` (sync, fast, bundles a current SQLite), or built-in `node:sqlite` (22.5+; release candidate since 25.7) | `node:sqlite` exports `DatabaseSync`, renamed `Database` in 26.11. `db.transaction(fn).immediate(...)` in better-sqlite3; transaction functions must not be async. The `sqlite3` npm package (node-sqlite3) is deprecated and archived. Bun has `bun:sqlite`. |
| Python | stdlib `sqlite3`; `aiosqlite` for asyncio (one thread per connection); `apsw` for the full C API | 3.12+: pass `autocommit=False` (PEP 249) or `True` and issue `BEGIN IMMEDIATE`/`COMMIT` yourself. The legacy default opens transactions implicitly only before DML. `with con:` commits but does not close. |
| Go | `modernc.org/sqlite` (pure Go, driver `sqlite`), `github.com/mattn/go-sqlite3` (cgo, driver `sqlite3`), `github.com/ncruces/go-sqlite3` (Wasm, no cgo) | Put pragmas in the DSN: modernc `?_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)&_txlock=immediate`; mattn `?_busy_timeout=5000&_foreign_keys=on&_journal_mode=WAL&_txlock=immediate`. |
| Rust | `rusqlite` (sync; the `bundled` feature pins the SQLite version), `sqlx` (async) | Call rusqlite from async code via `spawn_blocking`. sqlx leaves the journal mode alone, so enable WAL yourself. |
| .NET | `Microsoft.Data.Sqlite` (EF Core's SQLite provider builds on it) | Async methods run synchronously; prefer the sync API. `BeginTransaction()` takes the write lock immediately; `deferred: true` opts out. Use `Foreign Keys=True` in the connection string with other native builds. |

## Schema: STRICT and type affinity

```sql
CREATE TABLE invoice (
  id          INTEGER PRIMARY KEY,               -- rowid alias; "INT PRIMARY KEY" is not
  customer_id INTEGER NOT NULL REFERENCES customer(id) ON DELETE RESTRICT,
  total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
  status      TEXT    NOT NULL CHECK (status IN ('draft', 'sent', 'paid')),
  issued_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  meta        TEXT    CHECK (meta IS NULL OR json_valid(meta))
) STRICT;
CREATE INDEX invoice_customer_idx ON invoice(customer_id);   -- FK columns are never indexed for you
```

- **Without STRICT, declared types are hints.**
  - `VARCHAR(20)` does not limit length, and `'abc'` fits in an `INTEGER` column.
  - `STRING` gets NUMERIC affinity, so `'0012'` is stored as 12. `FLOATING POINT` gets INTEGER affinity.
  - `STRICT` (3.37+) accepts only `INT`, `INTEGER`, `REAL`, `TEXT`, `BLOB` and `ANY`, and rejects values that don't convert losslessly. SQLite older than 3.37 cannot open a schema that contains STRICT tables.
- **No BOOLEAN or DATETIME storage class.** Store booleans as 0/1 with `CHECK (x IN (0, 1))`. Store time as ISO-8601 UTC `TEXT` or unix-epoch `INTEGER`, and keep one format per column. `datetime('now')` returns UTC.
- **Primary keys**
  - `INTEGER PRIMARY KEY` is the rowid. Without `AUTOINCREMENT`, the id of a deleted maximum row can be reused. Add `AUTOINCREMENT` only when ids must never repeat.
  - Outside STRICT, `WITHOUT ROWID` and `INTEGER PRIMARY KEY` tables, a PRIMARY KEY column accepts NULL unless you declare it `NOT NULL`.
- **Single-statement writes.** Prefer `INSERT ... ON CONFLICT (...) DO UPDATE` and `RETURNING` over read-then-write.

## Schema changes ALTER TABLE cannot do

- **What `ALTER TABLE` covers**
  - `RENAME TO` and `RENAME COLUMN`.
  - `ADD COLUMN`: no PK or UNIQUE, NOT NULL needs a non-NULL default, no `CURRENT_TIMESTAMP` or expression default, no STORED generated column.
  - `DROP COLUMN`: fails if the column is a PK, UNIQUE, indexed, an FK, or used by a CHECK, view, trigger or generated column.
  - 3.53+: `ALTER TABLE t ALTER col SET NOT NULL` / `DROP NOT NULL`, plus adding and removing CHECK constraints.
- Anything else (type changes, new FKs or UNIQUE, column order) needs a rebuild:

```sql
PRAGMA foreign_keys = OFF;            -- outside the transaction; it is a no-op inside one
BEGIN IMMEDIATE;
CREATE TABLE invoice_new ( /* new definition */ ) STRICT;
INSERT INTO invoice_new (id, customer_id, total_cents, status, issued_at, meta)
  SELECT id, customer_id, total_cents, status, issued_at, meta FROM invoice;
DROP TABLE invoice;
ALTER TABLE invoice_new RENAME TO invoice;
-- recreate indexes, triggers and views that referenced the old table
PRAGMA foreign_key_check;             -- must return no rows before COMMIT
COMMIT;
PRAGMA foreign_keys = ON;
```

- Create the new table under a temporary name and rename it into place. Never rename the old table away first: triggers, views and foreign keys follow the rename and end up pointing at the wrong table.
- Alembic (`render_as_batch=True`), Django and EF Core generate this rebuild for you. Read their SQL for silently dropped columns. Embedded apps can version the schema with `PRAGMA user_version`.

## Backups and maintenance

- Never copy a live database file, and never copy the main file without its `-wal`.
  - CLI: `sqlite3 app.db ".backup 'backup.db'"`.
  - SQL: `VACUUM INTO '/backups/app-2026-10-22.db'`, a consistent and compacted copy.
  - Drivers' backup APIs: Python `Connection.backup()`, better-sqlite3 `db.backup()`, `node:sqlite` `backup()`.
- For continuous off-site copies, Litestream streams the WAL to S3-compatible storage with point-in-time restore. `sqlite3_rsync` copies a live database to another host.
- Test restores: open the copy and run `PRAGMA integrity_check` (or the faster `quick_check`) and `PRAGMA foreign_key_check`.
- `VACUUM` rewrites the whole file, blocks writers while it runs, and can need up to twice the database size in free disk space. Set `auto_vacuum = INCREMENTAL` before creating tables if you need space reclaimed online.

## FTS5 and JSON

```sql
CREATE VIRTUAL TABLE doc_fts USING fts5(title, body, content='doc', content_rowid='id',
                                        tokenize='unicode61 remove_diacritics 2');
-- External content: AFTER INSERT/UPDATE/DELETE triggers on doc keep the index in sync.
-- Delete form: INSERT INTO doc_fts(doc_fts, rowid, title, body) VALUES ('delete', old.id, old.title, old.body);
SELECT d.id, snippet(doc_fts, 1, '<b>', '</b>', '…', 12)
FROM doc_fts JOIN doc d ON d.id = doc_fts.rowid
WHERE doc_fts MATCH :query ORDER BY rank LIMIT 20;
```

- **External-content FTS** goes stale silently without its three triggers (an update is a 'delete' of the old row plus an insert). Repair drift with `INSERT INTO doc_fts(doc_fts) VALUES ('rebuild')`.
- **MATCH input is a query language.** Quote each user term as an FTS5 string (`"term"`, doubling any embedded `"`) and join the terms with spaces for an implicit AND. Raw input causes syntax errors and lets users inject `AND`, `OR`, `NOT`, `NEAR`, `*` or column filters.
- **Ranking and tokenizers.** `ORDER BY rank` sorts by bm25, lower is better. The `trigram` tokenizer gives substring and indexed `LIKE` search. `remove_diacritics 2` folds accents in Latin script.
- **JSON operators.** `data->>'$.email'` returns an SQL value and `data->'$.tags'` returns JSON text. `json_each()` unnests, and `json_group_array()`/`json_group_object()` aggregate. `jsonb_*` (3.45+) stores a binary BLOB that is internal to SQLite and is not PostgreSQL's JSONB.
- **Indexing JSON fields.** Expose the field as a generated column and index that; queries must use the same column or exact expression:

```sql
ALTER TABLE event ADD COLUMN user_id INTEGER GENERATED ALWAYS AS (payload ->> '$.user.id') VIRTUAL;
CREATE INDEX event_user_idx ON event(user_id);
```

## When SQLite is the wrong choice

- **Use PostgreSQL or MySQL** when:
  - several app servers must write to the same data;
  - the database file would sit on network storage;
  - write concurrency stays high and contended;
  - data heads toward terabytes;
  - you need server-side roles or built-in HA failover.
- **SQLite fits** a single host serving moderate traffic (the SQLite project calls 100K hits/day conservative), desktop, mobile and embedded apps, caches and edge read replicas.
- **libSQL and Turso.** libSQL is Turso's open-source fork. It adds a server mode, remote access and embedded replicas: a local file synced from a primary, with writes sent to the primary. Clients are `@libsql/client` and the `libsql` crate. Turso's Rust rewrite with MVCC concurrent writes is still beta.
- **LiteFS** (Fly.io) gives FUSE-based single-primary replication and is still beta. Its managed backup service shut down in Oct 2024; Fly points to Litestream for backups.
- **Litestream** is backup and restore, not multi-writer replication. Cloudflare D1 and rqlite/dqlite (Raft) cover managed or HA needs, each with its own API and limits.

## Testing

- **In-memory databases.** `:memory:` is private to one connection, so pooled or multi-threaded tests see an empty database. Use a temp file, or share one connection.
- **Same version as prod.** Run tests on the SQLite version production uses, since driver-bundled versions differ. Assert in a test that `PRAGMA foreign_keys` returns 1 on a pooled connection.
- **Concurrency test.** Two connections write concurrently with `busy_timeout` and `BEGIN IMMEDIATE`, and neither ever sees `SQLITE_BUSY`.

## Review checklist

- [ ] Every connection sets `busy_timeout` and `foreign_keys`. WAL is on for any app with concurrent readers.
- [ ] Transactions that may write start with `BEGIN IMMEDIATE`, stay short and hold no network I/O. There is one writer path per process.
- [ ] Tables are STRICT (or guarded by CHECK constraints), FK columns are indexed, and timestamps use one consistent format.
- [ ] Rebuild migrations disable FKs outside the transaction, run `foreign_key_check`, and recreate indexes and triggers.
- [ ] Backups use the backup API, `VACUUM INTO` or Litestream, never a file copy, and a restore has been tested.
- [ ] The DB file and its `-wal`/`-shm` files sit on a local disk with write access to the directory.
- [ ] FTS MATCH input is quoted, and external-content triggers exist.
- [ ] The SQLite version supports every feature used (≥3.51.3 for multi-connection WAL writes).

<!-- Written for legacies (MIT). Checked against: https://www.sqlite.org/changes.html https://www.sqlite.org/wal.html https://www.sqlite.org/lang_transaction.html https://www.sqlite.org/c3ref/busy_handler.html https://www.sqlite.org/pragma.html https://www.sqlite.org/stricttables.html https://www.sqlite.org/datatype3.html https://www.sqlite.org/lang_altertable.html https://www.sqlite.org/fts5.html https://www.sqlite.org/json1.html https://www.sqlite.org/whentouse.html https://nodejs.org/api/sqlite.html https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md https://docs.python.org/3/library/sqlite3.html https://pkg.go.dev/modernc.org/sqlite https://github.com/mattn/go-sqlite3 https://docs.rs/sqlx/latest/sqlx/sqlite/struct.SqliteConnectOptions.html https://learn.microsoft.com/en-us/dotnet/standard/data/sqlite/ https://community.fly.io/t/sunsetting-litefs-cloud/20829, 2026-10 -->
