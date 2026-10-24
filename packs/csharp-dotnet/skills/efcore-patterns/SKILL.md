---
name: efcore-patterns
description: EF Core 10 (LTS) data access, with notes for EF Core 8 and 9, covering DbContext lifetime and pooling, tracking vs AsNoTracking, N+1 and Include vs AsSplitQuery vs projections, compiled queries, ExecuteUpdate and ExecuteDelete, migrations with idempotent scripts and bundles, concurrency tokens, safe raw SQL, JSON columns, SQL logging and testing on a real database. Use when code references Microsoft.EntityFrameworkCore, a DbContext, a Migrations/ folder or dotnet ef, or when a query is slow, a migration fails, or tests need a database.
---

# EF Core Patterns

This skill targets EF Core 10, released November 2025. It is an LTS release, supported until November 10, 2028, and requires .NET 10. EF Core 8 (LTS) and EF Core 9 (STS) both lose support on November 10, 2026. EF Core 11 is at RC and ships in November 2026. Check the package version in the `.csproj` before using an API from a specific version. DI, async and general C# style are covered by the `dotnet-patterns` skill; xUnit, `WebApplicationFactory` and Testcontainers basics are covered by the `csharp-testing` skill.

## What changed per version

| EF | Changes that alter the code you write |
|----|---------------------------------------|
| 7 | `ExecuteUpdate`/`ExecuteDelete`; `FromSql` (replaces `FromSqlInterpolated`); owned types mapped with `ToJson()` |
| 8 | Complex types; primitive collections (`string[]` stored as a JSON column); `SqlQuery<T>` for unmapped types; `Contains` on a local list sent as one JSON parameter; `has-pending-model-changes` |
| 9 | `Migrate()` throws on pending model changes or inside an outer transaction; migration lock; `UseSeeding`/`UseAsyncSeeding`; `ConfigureDbContext`; `EF.Constant` and `EF.Parameter` throw inside compiled queries |
| 10 | Complex types mapped with `ToJson()`; optional complex types; named query filters; `LeftJoin`/`RightJoin`; `ExecuteUpdateAsync` takes a plain lambda; `Contains` sends padded scalar parameters; SQL Server `json` type at compatibility level 170 or with `UseAzureSql`; inlined constants redacted in logs; analyzer for concatenated raw SQL; `--framework` required for multi-targeted projects |

## DbContext lifetime and pooling

- **Unit of work.** Use one context per unit of work. `AddDbContext` registers it as scoped, so each request gets one.
- **No parallel use.** A context isn't thread-safe. `Task.WhenAll` over queries on one context throws "A second operation was started on this context". Await the queries one after another, or give each parallel branch its own context from `IDbContextFactory<T>`.
- **Factories.** Singletons, `BackgroundService`, Blazor Server and code with several units of work per request use `AddDbContextFactory` (or `AddPooledDbContextFactory`) and `await using var db = await factory.CreateDbContextAsync(ct);`. Never capture a scoped context in a singleton.
- **Pooling.** `AddDbContextPool<T>` reuses instances; the default pool size is 1024.
  - The constructor must take only the options.
  - The constructor and `OnConfiguring` run once per instance, not once per request, so per-request values (tenant, user) can't be set there. Set them from a scoped factory each time it hands out a context.
- **Retries and transactions.** With `EnableRetryOnFailure`, an explicit transaction must run inside `db.Database.CreateExecutionStrategy().ExecuteAsync(...)`; otherwise the strategy throws.
- **Failed saves.** When `SaveChanges` fails, the failed entries stay tracked, and the next `SaveChanges` sends them again. Discard the context, or call `ChangeTracker.Clear()`, before doing other work with it.

## Query shape: tracking, loading, projection

```csharp
var page = await db.Orders
    .Where(o => o.CustomerId == customerId && o.Id < beforeId) // keyset paging, not Skip
    .OrderByDescending(o => o.Id)
    .Take(50)
    .Select(o => new OrderSummary(o.Id, o.CreatedAt, o.Lines.Count, o.Lines.Sum(l => l.Quantity * l.UnitPrice)))
    .TagWith("orders: customer page")
    .ToListAsync(ct);
```

- **Read paths** project to DTOs. Projections aren't tracked, fetch only the listed columns, and need no `Include`, because navigation access inside `Select` becomes joins or subqueries.
- **Read-only entities.** Use `AsNoTracking()`, or `AsNoTrackingWithIdentityResolution()` when the same row repeats in a graph. Setting `UseQueryTrackingBehavior(QueryTrackingBehavior.NoTracking)` globally is fine if update paths call `AsTracking()`.
- **Write paths.** Load the entities tracked, change them, then call `SaveChangesAsync` once; the changes go out batched in one transaction.
- **N+1 queries** come from lazy-loading proxies or a query inside a loop. Use `Include`, a projection, or one query with `Contains` over the IDs, and keep lazy loading off in web apps.
- **Cartesian explosion.** Two or more collection `Include`s at the same level multiply the rows returned. Use `AsSplitQuery()` on the query, or `UseQuerySplittingBehavior(QuerySplittingBehavior.SplitQuery)` globally.
  - Split queries cost extra round trips.
  - They aren't one consistent snapshot unless they run under snapshot or serializable isolation.
  - Before EF 10, split queries with `Skip`/`Take` needed a unique ordering.
- **Split warning.** EF logs `RelationalEventId.MultipleCollectionIncludeWarning` when a query loads several collections without a chosen splitting mode. Make it throw in tests via `ConfigureWarnings`.
- **Filtered include** looks like `Include(o => o.Lines.Where(l => !l.Cancelled).OrderBy(l => l.Id).Take(20))`.
- **Client evaluation.** Only the final `Select` may run on the client. Anything untranslatable elsewhere throws at runtime, so run queries against the real provider in tests. Calling `ToListAsync` before filtering pulls the whole table.
- **`Contains` over a local list.** EF 10 sends padded scalar parameters, where EF 8 and 9 sent one JSON array. If an upgrade makes a query plan worse, pick per query with `EF.Parameter(ids)` or `EF.Constant(ids)`, or set `UseParameterizedCollectionMode(ParameterTranslationMode.Parameter)` in the provider options.

## Compiled queries and the query cache

```csharp
private static readonly Func<AppDbContext, int, Task<Order?>> OrderById =
    EF.CompileAsyncQuery((AppDbContext db, int id) =>
        db.Orders.AsNoTracking().FirstOrDefault(o => o.Id == id));

var order = await OrderById(db, id);
```

- **When to compile.** Gains are modest, because EF already caches compiled queries by expression shape. Compile hot, stable queries.
  - The delegate is thread-safe.
  - Parameters must be simple scalars.
  - `EF.Constant` and `EF.Parameter` throw inside compiled queries since EF 9.
- **Defeating the cache.** A dynamic expression tree built with `Expression.Constant` compiles a new query for every value and floods the database's plan cache. Capture variables in closures instead.
- **Large models.** If startup is slow because the model is very large, use compiled models (`dotnet ef dbcontext optimize`). They don't support global query filters or lazy-loading proxies, and must be regenerated after every model change.

## Bulk updates and deletes

```csharp
var archived = await db.Orders
    .Where(o => o.Status == OrderStatus.Closed && o.ClosedAt < cutoff)
    .ExecuteUpdateAsync(s =>
    {
        s.SetProperty(o => o.Status, OrderStatus.Archived);
        if (touchTimestamps) s.SetProperty(o => o.UpdatedAt, now); // EF 10: plain lambda
    }, ct);
```

- **Change tracker.** Each call is one SQL statement that runs immediately, outside the change tracker. Tracked copies of the rows go stale, and a later `SaveChanges` can overwrite the update, so don't mix it with tracked edits of the same rows.
- **Transactions.** No implicit transaction spans several calls. Wrap them in `BeginTransactionAsync`, inside the execution strategy when retries are on.
- **What's skipped.** There is no automatic concurrency check, and `SaveChanges` interceptors, events and client-side cascades don't run. For optimistic concurrency, filter on the token and treat 0 affected rows as a conflict.
- **Scope.** Each statement touches one table. Before EF 10 the setters were an expression tree, so conditional setters meant building the expression by hand.

## Migrations

- **Tooling.** Pin `dotnet-ef` in `.config/dotnet-tools.json` to the same major version as the EF packages. The startup project needs `Microsoft.EntityFrameworkCore.Design`. Add an `IDesignTimeDbContextFactory<T>` when the DI setup is unusual.
- **Adding and reviewing.** Run `dotnet ef migrations add AddOrderStatus --project src/Data --startup-project src/Api`, then read the result.
  - A renamed property is scaffolded as a drop plus an add, which loses data; replace it with `RenameColumn`.
  - Move data with `InsertData`/`UpdateData`/`DeleteData` or `migrationBuilder.Sql(...)`, never with the current entity classes, which will change later.
- **CI gate.** Fail the build on `dotnet ef migrations has-pending-model-changes`, or on `context.Database.HasPendingModelChanges()` in a unit test.
- **Production:**
  - **SQL script**, when a person reviews it or a DBA applies it: `dotnet ef migrations script --idempotent --output artifacts/migrate.sql`. Scripts aren't covered by the migration lock.
  - **Bundle**, for automated deploys: `dotnet ef migrations bundle --self-contained --target-runtime linux-x64 --output artifacts/efbundle`.
    - Run it as a one-shot job, with `--connection` taken from the secret store and an identity allowed to change the schema.
    - Set `ASPNETCORE_ENVIRONMENT` explicitly, because the tools default to Development.
  - **`MigrateAsync()` at startup** fits only simple deployments. EF 9+ locks against concurrent instances, but the app then needs DDL rights. Never call `EnsureCreated` on a database managed by migrations.
- **`PendingModelChangesWarning`.** On EF 9+, `Migrate` throws this when the model differs from the last snapshot. Fix the cause instead of suppressing it. Usual causes:
  - a forgotten migration
  - non-deterministic `HasData` values, such as `DateTime.Now` or `Guid.NewGuid()`
  - migrations generated for another provider
- **Transactions.** Don't wrap `MigrateAsync` in your own transaction; EF 9+ throws `MigrationsUserTransactionWarning`.
- **Seeding.** Use `HasData` only for static reference rows with fixed keys. Put anything computed in `UseSeeding`/`UseAsyncSeeding` (EF 9+), which run under the migration lock.
- **Zero downtime.** Change columns with expand and contract (see the `database-migrations` skill).

## Concurrency tokens

```csharp
public class Order
{
    public int Id { get; set; }
    [Timestamp] public byte[] RowVersion { get; set; } = [];   // SQL Server rowversion
    // Npgsql: [Timestamp] public uint Version { get; set; }   // maps to the xmin system column
}
```

- **Disconnected updates** (an API call, a form post): return the token to the client as an ETag or a field. Before saving, set `db.Entry(order).Property(o => o.RowVersion).OriginalValue = clientToken;`. Without that, EF compares against the value it just read and never sees the conflict.
- **Conflicts.** Catch `DbUpdateConcurrencyException` and answer 409 or 412. Alternatively, reload with `entry.GetDatabaseValuesAsync()` (null means the row was deleted) and merge deliberately.
- **App-managed tokens.** `[ConcurrencyCheck]` turns any property into a token you manage yourself, such as a GUID regenerated on every save.

## Raw SQL without injection

```csharp
var open = await db.Orders
    .FromSql($"SELECT id, customer_id, status, total, row_version FROM orders WHERE customer_id = {customerId}")
    .Where(o => o.Status == OrderStatus.Open) // composed as a subquery
    .AsNoTracking()
    .ToListAsync(ct);
```

- **Safe APIs.** `FromSql`, `SqlQuery<T>` and `ExecuteSql` take a `FormattableString`, so interpolated values become `DbParameter`s.
- **`*Raw` APIs.** These take a plain string, so pass values as `{0}` placeholders or `DbParameter`s. An interpolated string handed to a `*Raw` method is SQL injection; EF 10's analyzer flags concatenation there.
- **Lost parameterization.** Assigning `$"..."` to a `string` variable first turns it into a plain string. Keep it inline, or type the variable as `FormattableString`.
- **Identifiers.** Column, table and sort names can't be parameters. Map them from an allowlist (a `switch` that returns constants), then use `FromSqlRaw`.
- **Result shape.** The SQL must return every mapped column under its mapped name.
- **Composition.** Only composable SQL (a `SELECT` with no trailing `;`) can be followed by LINQ operators. After a stored procedure call, put `AsAsyncEnumerable()` before any operator.
- **Unmapped types.** `SqlQuery<T>` maps unmapped DTOs since EF 8. For a scalar result, name the column `Value` if you compose LINQ over it.

## JSON columns

- **EF 10 complex types.** Map value objects with `ComplexProperty(c => c.Address, b => b.ToJson())`. Complex types have value semantics, can hold collections, and support `ExecuteUpdate` into JSON properties.
- **Owned types.** Prefer complex types over owned `OwnsOne(...ToJson())` in new code. Owned types carry a hidden identity, so one instance can't be assigned to two properties, and comparisons use that identity.
- **Primitive collections.** A `string[] Tags` property maps to a JSON column since EF 8, and `Contains`/`Any` on it translate to SQL.
- **SQL Server `json` type.** With `UseAzureSql` or compatibility level 170, EF 10 uses the native `json` type, and the next migration converts existing `nvarchar(max)` JSON columns. Review that migration, or pin `UseCompatibilityLevel(160)`.
- **Limits.** JSON can't carry foreign keys or unique constraints, and its indexing is provider-specific. Keep anything you join on, filter heavily or constrain in real columns.

## Seeing the SQL

- **Logging statements.** In development config, set the `Microsoft.EntityFrameworkCore.Database.Command` logging category to `Information`; every statement is logged with its duration. `query.ToQueryString()` shows the SQL for one query, and `TagWith` labels it for database monitoring.
- **Sensitive data.** Use `EnableSensitiveDataLogging()` and `EnableDetailedErrors()` only in Development, because they log parameter values. EF 10 also redacts inlined constants unless sensitive logging is on.
- **Console apps and tests** can use `LogTo(Console.WriteLine, LogLevel.Information)`.

## Testing

- **Real engine.** Test against the production database engine. Start a Testcontainers container per test class or collection: `new PostgreSqlBuilder("postgres:17-alpine").Build()`, or `MsSqlBuilder`.
  - Create the schema with `MigrateAsync` so the migrations themselves get tested.
  - Isolate tests with a transaction rolled back per test, or a data reset (Respawn).
- **Avoid the in-memory provider.** It is officially discouraged: transactions are ignored, raw SQL fails, it has no relational constraints, and string comparison behaves differently. SQLite in-memory is closer, but still a different engine.
- **Swapping the provider in `WebApplicationFactory` on EF 9+.** `AddDbContext` stores its configuration as `IDbContextOptionsConfiguration<T>`. Removing `DbContextOptions<T>` alone leaves the app's provider in place, and resolving the context throws "Services for database providers … have been registered". Remove both:

```csharp
builder.ConfigureTestServices(services =>
{
    services.RemoveAll<IDbContextOptionsConfiguration<AppDbContext>>();
    services.RemoveAll<DbContextOptions<AppDbContext>>();
    services.AddDbContext<AppDbContext>(o => o.UseNpgsql(_postgres.GetConnectionString()));
});
```

  If the app reads its connection string inside `AddDbContext((sp, o) => ...)`, it's simpler to override that configuration key in the factory instead.

## Pitfalls

- Npgsql writes a `DateTime` to `timestamptz` only when `Kind == Utc`. Use `DateTime.UtcNow` or `DateTimeOffset`.
- A query that doesn't receive the request's `CancellationToken` keeps running after the client leaves.
- Tenant query filters must read a per-context value set on each request. With EF 10 named filters, `IgnoreQueryFilters(["SoftDelete"])` lifts one filter while keeping tenant isolation.
- `FirstOrDefault` without `OrderBy` returns an arbitrary row. `Count() > 0` does more work than `Any()`.
- Returning `IQueryable` from a repository leaks both the query shape and the context lifetime to callers.

## Review checklist

- [ ] Contexts are scoped or come from a factory; nothing runs in parallel on one context
- [ ] Reads project or use `AsNoTracking`; there's no N+1; multiple collection includes are split or projected
- [ ] Lists are paged (keyset for deep pages), and every call passes the `CancellationToken`
- [ ] Raw SQL uses `FromSql`/`ExecuteSql` interpolation or parameters; identifiers come from an allowlist
- [ ] `ExecuteUpdate`/`ExecuteDelete` aren't mixed with tracked edits of the same rows
- [ ] Every migration was read; renames use `RenameColumn`; CI checks for pending model changes
- [ ] Production applies an idempotent script or a bundle, not app startup, unless the deployment is trivial
- [ ] Updated entities carry a concurrency token, and APIs send it to the client and back
- [ ] Sensitive data logging is off outside Development
- [ ] Tests run on the real engine with migrations, not on the in-memory provider

<!-- Written for legacies (MIT). Checked against: https://learn.microsoft.com/en-us/ef/core/what-is-new/, https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-10.0/whatsnew, https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-10.0/breaking-changes, https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-9.0/breaking-changes, https://learn.microsoft.com/en-us/ef/core/dbcontext-configuration/, https://learn.microsoft.com/en-us/ef/core/performance/advanced-performance-topics, https://learn.microsoft.com/en-us/ef/core/querying/single-split-queries, https://learn.microsoft.com/en-us/ef/core/querying/sql-queries, https://learn.microsoft.com/en-us/ef/core/saving/execute-insert-update-delete, https://learn.microsoft.com/en-us/ef/core/managing-schemas/migrations/applying, https://learn.microsoft.com/en-us/ef/core/managing-schemas/migrations/managing, https://learn.microsoft.com/en-us/ef/core/testing/choosing-a-testing-strategy, https://www.npgsql.org/efcore/modeling/concurrency.html, https://dotnet.testcontainers.org/modules/postgres/, 2026-10 -->
