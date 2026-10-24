---
name: rust-web-services
description: Production HTTP APIs in Rust with axum 0.8 on Tokio, covering routing, extractors and state, tower and tower-http middleware, IntoResponse error types, sqlx 0.9 queries and migrations, tracing, graceful shutdown, Tokio blocking and cancellation pitfalls, oneshot tests, and how Actix Web 4 compares. Use when Cargo.toml has axum, tower-http, sqlx, actix-web or tokio, when writing handlers, extractors or middleware, or when debugging hung requests, shutdown, !Send futures or sqlx compile errors.
---

# Rust Web Services

This skill covers what is specific to HTTP services. The `rust-patterns` skill covers ownership, error crates and async basics, and the `rust-testing` skill covers unit, property and doc tests.

Versions checked in October 2026 (read `Cargo.lock` before applying version-specific advice):

| Crate | Version | MSRV |
|-------|---------|------|
| axum | 0.8.9 | 1.80 |
| tower | 0.5 | |
| tower-http | 0.7 (0.6 still works) | |
| tokio | 1.x | |
| sqlx | 0.9.0 | 1.94 |
| actix-web | 4.17 | |

## Version traps

- **Path syntax.** axum 0.8 uses `/users/{id}` and `/files/{*path}`. The 0.7 forms `/:id` and `/*path` panic at startup. Write literal braces as `{{` and `}}`.
- **Custom extractors.** `FromRequestParts` and `FromRequest` impls no longer take `#[async_trait]`, because 0.8 uses native async trait methods.
- **Optional extractors.** `Option<T>` as an extractor needs `OptionalFromRequestParts` and now passes rejections through. `Option<Query<T>>` no longer compiles; make the query fields optional instead.
- **Other 0.8 changes.** Handlers and services must be `Sync`. `Host` moved to axum-extra. WebSocket messages carry `Utf8Bytes` and `Bytes`.
- **Old examples.** Code using `axum::Server` or hyper 0.14 predates 0.7. Bind a `tokio::net::TcpListener` and call `axum::serve` instead.
- **tower-http.** `TimeoutLayer::new` is deprecated since 0.6.7; use `TimeoutLayer::with_status_code(status, duration)`. 0.7 adds `CsrfLayer` and body-deadline layers. Compression now honours `identity;q=0`, so it can answer 406.
- **sqlx 0.9:**
  - `query`, `query_as` and `raw_sql` take `impl SqlSafeStr`, which only `&'static str` and `AssertSqlSafe(...)` implement, so SQL built with `format!` no longer compiles.
  - The combined runtime-and-TLS features are gone; enable `runtime-tokio` and `tls-rustls` separately.
  - Postgres macros now use generic plans, which can change what `query!` infers.
  - Keep sqlx-cli on the same minor version as the crate.

## Layout

```text
src/main.rs      config, tracing, pool, migrations, serve with graceful shutdown
src/app.rs       pub fn app(state: AppState) -> Router, shared by main and tests
src/routes/      handlers per resource, request and response DTOs beside them
src/error.rs     AppError and its IntoResponse impl
src/db/          sqlx queries; no axum types
migrations/      sqlx migrations; commit .sqlx/ (offline query data) as well
```

## Router, state and extractors

```rust
#[derive(Clone)]
pub struct AppState { pub db: PgPool, pub cfg: Arc<Config> }

pub fn app(state: AppState) -> Router {
    Router::new()
        .route("/orders", get(list_orders).post(create_order))
        .route("/orders/{id}", get(get_order))
        .route_layer(middleware::from_fn_with_state(state.clone(), require_user))
        .route("/healthz", get(|| async { "ok" })) // added after route_layer, so no auth
        .layer(
            ServiceBuilder::new()
                .layer(TraceLayer::new_for_http())
                .layer(TimeoutLayer::with_status_code(StatusCode::REQUEST_TIMEOUT, Duration::from_secs(10)))
                .layer(RequestBodyLimitLayer::new(1024 * 1024)),
        )
        .with_state(state)
}

async fn get_order(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Path(id): Path<i64>,
) -> Result<Json<Order>, AppError> {
    let order = db::orders::find(&state.db, user.id, id).await?.ok_or(AppError::NotFound)?;
    Ok(Json(order))
}
```

- **Body extractor last.** Only one extractor per handler may consume the body (`Json`, `Form`, `Bytes`, `String`, `Request`, `Multipart`), and it must be the last argument.
- **"Handler is not implemented".** This error usually means one of three things: the body extractor isn't last, the future is `!Send`, or the return type doesn't implement `IntoResponse`. `#[axum::debug_handler]` (feature `macros`) names the real cause.
- **State.** Use one `Clone` struct whose fields are cheap to clone. `PgPool` is already reference-counted; put large config behind `Arc`. Derive `FromRef` to extract parts of it, such as `State<PgPool>`. Nested routers are `Router<AppState>`; call `with_state` once, at the top.
- **Extension.** `Extension` is for request-scoped values that middleware inserts, such as the authenticated user. A missing `Extension` is a 500 at runtime; a missing `State` is a compile error.
- **Rejections.** The built-in rejections answer in plain text. To keep one error shape, derive a wrapper with `#[derive(FromRequest)] #[from_request(via(axum::Json), rejection(AppError))] struct AppJson<T>(T);` and implement `From<JsonRejection> for AppError`.

## Errors as responses

```rust
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("not found")]
    NotFound,
    #[error("{0}")]
    BadRequest(String),
    #[error(transparent)]
    Db(#[from] sqlx::Error),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let status = match &self {
            AppError::NotFound => StatusCode::NOT_FOUND,
            AppError::BadRequest(_) => StatusCode::BAD_REQUEST,
            AppError::Db(err) => {
                tracing::error!(error = %err, "database error");
                let body = Json(json!({ "error": "internal error" }));
                return (StatusCode::INTERNAL_SERVER_ERROR, body).into_response();
            }
        };
        (status, Json(json!({ "error": self.to_string() }))).into_response()
    }
}
```

- Use `fetch_optional` and return `NotFound`, rather than mapping every `RowNotFound` to 404.
- Answer 409 when `err.as_database_error().is_some_and(|e| e.is_unique_violation())` is true.
- If you use anyhow internally, wrap it in an `Internal` variant. Log the whole chain with `{err:#}` and return a generic body.

## Middleware with tower and tower-http

- **Order.** `ServiceBuilder` layers run top to bottom. Chained `Router::layer` calls run bottom to top, so the last one added is the outermost. `Router::layer` only wraps routes added before it.
- **Auth.** `route_layer` runs only when a route matched. Put auth there so unknown paths still return 404 instead of 401.
- **Fallible layers.** axum services must be infallible. tower's own `timeout`, `load_shed` and `concurrency_limit` produce errors and need `HandleErrorLayer`. tower-http's `TimeoutLayer` answers with a status code itself.
- **Body limits.** `DefaultBodyLimit` (2 MB) only guards extractors built on `Bytes`, such as `Json`, `Form` and `String`. Reading `Body` as a stream bypasses it. Add `RequestBodyLimitLayer` as a global cap, and raise `DefaultBodyLimit::max(n)` only on upload routes.
- **App middleware.** Write it as `async fn require_user(State(s): State<AppState>, mut req: Request, next: Next) -> Result<Response, AppError>`. Insert the principal with `req.extensions_mut().insert(user)`, then return `Ok(next.run(req).await)`.
- **Request IDs.** Put `SetRequestIdLayer::x_request_id(MakeRequestUuid)` before `TraceLayer` and `PropagateRequestIdLayer::x_request_id()` after it.
- **CORS and CSRF.** Never ship `CorsLayer::permissive()`; list the allowed origins. Cookie sessions also need `CsrfLayer::new().add_trusted_origin(...)` (tower-http 0.7).

## Tokio pitfalls

- **Blocking work.** Calls such as `std::fs`, `std::thread::sleep`, password hashing, image processing or large serde jobs stall a worker thread and every task queued on it.
  - Move them to `tokio::task::spawn_blocking`.
  - Send long CPU-bound jobs to rayon or a dedicated pool.
  - Work in `spawn_blocking` can't be aborted once it starts.
- **`block_in_place`.** It panics on the current-thread runtime, which is what `#[tokio::test]` uses by default.
- **`std::sync::Mutex`.** It is the right lock for short critical sections. Holding its guard across `.await` makes the handler future `!Send`, so the handler stops compiling, and it invites deadlocks. Scope the guard in a block. Use `tokio::sync::Mutex` only when the lock really must span an await.
- **Cancellation.** When a timeout fires, or an HTTP/2 client resets the stream, the handler future is dropped at its current `.await`.
  - Put multi-statement writes in one transaction. A dropped sqlx transaction rolls back.
  - Hand work that must finish to `tokio::spawn`, and track it with `tokio_util::task::TaskTracker`.
- **`tokio::select!` loops.** Use cancel-safe futures such as `mpsc::Receiver::recv` and `TcpListener::accept`, or pin the in-flight future outside the loop. Futures like `read_exact` lose data when another branch wins.
- **Spawned tasks and runtimes.** A panic in a spawned task surfaces as a `JoinError`, so await the handle or log it. Libraries never build their own runtime.

## sqlx 0.9

```rust
let pool = PgPoolOptions::new()
    .max_connections(10)
    .acquire_timeout(Duration::from_secs(3))
    .connect(&std::env::var("DATABASE_URL")?)
    .await?;
sqlx::migrate!().run(&pool).await?; // ./migrations embedded at compile time

let order = sqlx::query_as!(
    Order,
    r#"SELECT id, status AS "status: OrderStatus", total_cents FROM orders WHERE id = \$1"#,
    id
)
.fetch_optional(&pool)
.await?;
```

- **Compile-time checks.** `query!` and `query_as!` check SQL at compile time against `DATABASE_URL` or against committed offline data:
  - `cargo sqlx prepare` (add `--workspace` in a workspace) writes `.sqlx/`.
  - CI builds with `SQLX_OFFLINE=true` and runs `cargo sqlx prepare --check`.
- **Inferred types.** Fix nullability and types with column aliases: `"total!"` forces not-null, `"note?"` allows null, and `"status: OrderStatus"` overrides the type.
- **Dynamic SQL.**
  - Build dynamic filters, IN lists and bulk inserts with `QueryBuilder` and `push_bind`.
  - On Postgres, bind a slice to `WHERE id = ANY(\$1)`.
  - Take sort columns from a `match` on an enum.
  - Use `AssertSqlSafe` only around strings built from constants.
- **Transactions.** Start with `let mut tx = pool.begin().await?`, run queries with `.execute(&mut *tx)`, then call `tx.commit().await?`. Dropping the transaction without committing rolls it back.
- **Migrations.**
  - `sqlx migrate add -r <name>` creates a reversible up/down pair.
  - Never edit a migration that has been applied; the checksum mismatch fails at startup.
  - The migrator takes a Postgres advisory lock, so concurrent instances run one at a time. Long migrations still belong in a deploy step.
- **Pool size.** Keep `max_connections` × instance count below the server's connection limit. Set `acquire_timeout` so overload fails fast instead of hanging.

## Tracing and graceful shutdown

- Initialize once with `tracing_subscriber::fmt().with_env_filter(EnvFilter::from_default_env()).json().init()`. This needs the `env-filter` and `json` features.
- Annotate with `#[tracing::instrument(skip_all, fields(order_id = %id))]`. `skip_all` keeps pools, state and secrets out of span fields.
- Never hold a `span.enter()` guard across `.await`. Use `#[instrument]` or `.instrument(span)` instead.

```rust
let listener = tokio::net::TcpListener::bind("0.0.0.0:8080").await?;
axum::serve(listener, app(state)).with_graceful_shutdown(shutdown_signal()).await?;

async fn shutdown_signal() {
    let ctrl_c = async { tokio::signal::ctrl_c().await.expect("Ctrl+C handler") };
    #[cfg(unix)]
    let term = async {
        use tokio::signal::unix::{signal, SignalKind};
        signal(SignalKind::terminate()).expect("SIGTERM handler").recv().await;
    };
    #[cfg(not(unix))]
    let term = std::future::pending::<()>();
    tokio::select! { _ = ctrl_c => {}, _ = term => {} }
}
```

- axum installs no signal handling. Without `with_graceful_shutdown`, SIGTERM kills requests that are still running.
- With it, shutdown waits for every open connection. SSE and WebSocket handlers must watch a `CancellationToken` that the signal handler cancels.
- After `serve` returns, close the `TaskTracker`, wait on it, then call `pool.close().await`.

## Actix Web 4, compared

- **Workers.** `HttpServer::new` runs its factory once per worker, and the default worker count is the number of physical cores. State built inside the factory is per worker. Build `web::Data::new(...)` outside it and pass `.app_data(data.clone())`; `web::Data` is already an `Arc`.
- **Blocking.** Handlers need not be `Send`, but a blocking handler stalls every connection on its worker. Use `web::block`.
- **Errors and limits.** Errors implement `ResponseError`. Set the JSON size limit with `web::JsonConfig::default().limit(n)`; the default is 2 MB.
- **Shutdown.** SIGTERM triggers a graceful shutdown, with a 30 s `shutdown_timeout`.
- **Testing.** Use `actix_web::test::{init_service, call_service, TestRequest}`.
- **Choosing.** Keep Actix in Actix codebases. Choose axum for new services that want the tower ecosystem, such as tower-http and tonic. Never mix the two in one binary.

## Testing with oneshot

```rust
use axum::{body::Body, http::{Request, StatusCode}};
use http_body_util::BodyExt; // collect()
use tower::ServiceExt; // oneshot(); tower feature "util"

#[sqlx::test] // fresh database per test, ./migrations applied
async fn missing_order_is_404(pool: PgPool) {
    let res = app(AppState::for_tests(pool))
        .oneshot(Request::get("/orders/999").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);
    let body = res.into_body().collect().await.unwrap().to_bytes();
    assert!(body.starts_with(b"{\"error\""));
}
```

- **Reusing the router.** `oneshot` consumes the router. Call `app.clone().oneshot(..)` for each request, or use `ServiceExt::<Request<Body>>::ready(&mut app).await?.call(req)`. Without the turbofish the request type can't be inferred, and `call` comes from `tower::Service`.
- **Database tests.** `#[sqlx::test]` needs a `DATABASE_URL` whose user can create databases. `fixtures("orders")` loads `./fixtures/orders.sql`.
- **Auth in tests.** Send test requests through the same auth middleware with a test key; don't add a bypass.
- **Timing.** Test timeouts and rate limits with `#[tokio::test(start_paused = true)]` and `tokio::time::advance`. This needs the tokio `test-util` feature.
- **CI.** Run `cargo fmt --check`, `cargo clippy -- -D warnings`, `SQLX_OFFLINE=true cargo test` and `cargo sqlx prepare --check`.

## Review checklist

- [ ] Paths use `{param}`; no `#[async_trait]` on extractor impls
- [ ] The body extractor is last; errors go through one `IntoResponse` type that hides internals
- [ ] Timeout, body-limit and trace layers are set; auth runs on `route_layer`
- [ ] No blocking calls, and no std mutex guard held across `.await`; CPU work runs in `spawn_blocking`
- [ ] Multi-step writes share one transaction; work that must finish is spawned and tracked
- [ ] No SQL built with `format!`; `.sqlx/` is committed and `prepare --check` runs in CI
- [ ] `#[instrument(skip_all)]` is used; no span guard is held across an await
- [ ] SIGTERM is handled; streams cancel on shutdown; the pool closes last
- [ ] The router is tested through `oneshot` with the real middleware stack

<!-- Written for legacies (MIT). Checked against: https://github.com/tokio-rs/axum/blob/main/axum/CHANGELOG.md, https://tokio.rs/blog/2025-01-01-announcing-axum-0-8-0, https://docs.rs/axum/0.8.9/axum/middleware/index.html, https://docs.rs/axum/0.8.9/axum/extract/struct.DefaultBodyLimit.html, https://github.com/tower-rs/tower-http/blob/main/tower-http/CHANGELOG.md, https://docs.rs/tower-http/0.7.1/tower_http/, https://github.com/launchbadge/sqlx/blob/main/CHANGELOG.md, https://docs.rs/sqlx/0.9.0/sqlx/, https://actix.rs/docs/application, https://actix.rs/docs/server, 2026-10 -->
