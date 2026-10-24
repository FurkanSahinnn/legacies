---
name: go-web-services
description: Production HTTP services in Go with net/http (Go 1.22 to 1.27), covering method and wildcard ServeMux routing, middleware, context cancellation, request body limits, http.Server timeouts, graceful shutdown, encoding/json pitfalls (v2 engine since 1.27), log/slog, database/sql vs pgx and sqlc, and httptest. Use when writing or reviewing Go handlers, routers, middleware or server wiring (net/http, chi, gin, echo, pgx, sqlc), or when chasing goroutine leaks, hung requests, timeouts or shutdown bugs.
---

# Go Web Services

This skill covers what is specific to HTTP services. The `golang-patterns` skill covers idioms, errgroup and leak basics, and the `golang-testing` skill covers table tests and fuzzing. The current release is Go 1.27 (August 2026). Before using an API, check that the `go` line in `go.mod` is at least the version that added it.

## Version map and stale habits

| Go | What changes the code you write |
|----|---------------------------------|
| 1.21 | `log/slog`; `context.WithoutCancel`, `context.AfterFunc` |
| 1.22 | `ServeMux` patterns with methods and wildcards, `r.PathValue`; per-iteration loop variables |
| 1.23 | `r.Pattern` (the pattern that matched); `httptest.NewRequestWithContext` |
| 1.24 | json `omitzero`; `t.Context()`; `os.Root`; `tool` directives in `go.mod` |
| 1.25 | `http.CrossOriginProtection`; `testing/synctest` GA; `sync.WaitGroup.Go`; cgroup-aware `GOMAXPROCS` |
| 1.26 | Trailing-slash redirects are 307; `errors.AsType`; `slog.NewMultiHandler`; `ReverseProxy.Director` deprecated in favor of `Rewrite` |
| 1.27 | `encoding/json` runs on the v2 engine (error text changed) and `encoding/json/v2` ships; `httptest.NewTestServer` for synctest; `goroutineleak` pprof profile |

Habits to drop on modern Go:

- gorilla/mux or httprouter pulled in only for path parameters and methods
- `tt := tt` loop-variable copies
- `ioutil`
- bare `http.ListenAndServe(addr, h)`
- `log.Printf` in services
- `http.DefaultClient` for outbound calls
- `automaxprocs`: since 1.25 the runtime reads the container CPU limit, and setting `GOMAXPROCS` yourself turns that off

## Layout

```text
cmd/api/main.go     wiring only: config, logger, DB pool, server, signal handling
internal/httpapi/   routes.go lists every route; handlers, middleware, JSON helpers
internal/orders/    domain logic and store interfaces; never imports net/http
internal/store/     sqlc output or pgx queries
```

Handlers decode the request, call the domain and encode the response. Code below `httpapi` never sees `http.Request`.

## Routing (1.22+)

```go
func (app *App) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", app.health)
	mux.HandleFunc("GET /v1/orders/{id}", app.getOrder)
	mux.HandleFunc("POST /v1/orders", app.createOrder)
	mux.HandleFunc("GET /files/{path...}", app.serveFile)
	mux.HandleFunc("GET /{$}", app.home) // exactly "/", not a catch-all
	csrf := http.NewCrossOriginProtection() // 1.25+: rejects cross-origin non-safe browser requests
	return chain(mux, app.requestID, app.accessLog, app.recoverPanic, csrf.Handler)
}

func (app *App) getOrder(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		app.errorJSON(w, r, http.StatusBadRequest, "invalid id")
		return
	}
	// ...
}
```

- The most specific pattern wins, whatever the registration order. If two patterns overlap and neither is more specific (`/posts/{id}` and `/{kind}/latest`), registration panics. Build the router once in a test so this fails in CI.
- `GET` also serves `HEAD`. A request whose path matches but whose method doesn't gets a 405 with an `Allow` header automatically.
- `/admin/` matches the whole subtree, while `/admin/{$}` matches only `/admin/` itself. Since 1.26 the automatic `/admin` to `/admin/` redirect is a 307, not a 301.
- Label metrics and spans with `r.Pattern`, never `r.URL.Path`, which creates one series per ID.
- Only the mux fills in `PathValue`. A unit test that calls the handler directly must call `req.SetPathValue("id", "42")`. Routing the test through `routes()` is better.
- Braces that older patterns used literally now mean wildcards. `GODEBUG=httpmuxgo121=1` restores 1.21 matching while you migrate.
- A third-party router still makes sense in two cases:
  - You need middleware scoped to a group of routes, or sub-routers. Chi v5 does this and keeps plain `net/http` handlers.
  - The project already uses Gin or Echo. Both have their own context type and handler signature, so handlers don't move between frameworks. Echo v5 is current and v4 is still maintained, so check the import path.

  Never mix routers in one service.

## Middleware

```go
type middleware func(http.Handler) http.Handler

// chain wraps h so that mws[0] is the outermost layer.
func chain(h http.Handler, mws ...middleware) http.Handler {
	for i := len(mws) - 1; i >= 0; i-- {
		h = mws[i](h)
	}
	return h
}
```

- Order them as request ID, access log, panic recovery, CSRF/CORS, auth, then the handler. Recovery sits inside the logger so the log line records the 500.
- net/http already recovers a handler panic per request, logs a stack trace and drops the connection. Your recovery middleware exists to send a JSON 500 and log through slog. It must re-panic `http.ErrAbortHandler`.
- A `ResponseWriter` wrapper that captures the status must implement `Unwrap() http.ResponseWriter`. Without it, `http.NewResponseController(w)` returns `http.ErrNotSupported` for `Flush` and deadlines, and SSE breaks behind the wrapper.
- Put request-scoped values, such as the request ID and the authenticated principal, in the context under an unexported key type. Dependencies and optional parameters don't belong there.
- Cookie-authenticated APIs need CSRF protection. Use `CrossOriginProtection` as above, with `AddTrustedOrigin` for a frontend on another origin, or use tokens.

## Context, goroutines and outbound calls

- `r.Context()` is canceled when the client disconnects, when an HTTP/2 stream is reset, or when `ServeHTTP` returns. Pass it to every query and outbound request (`QueryContext`, `http.NewRequestWithContext`).
- For work that must outlive the response, use `context.WithoutCancel(r.Context())`. It keeps the values and drops the cancellation. Give that context its own timeout and run the work on a tracked worker that shutdown waits for. A bare `go f(r.Context())` is canceled as soon as the handler returns, and `go f(context.Background())` is unbounded and untracked.
- A goroutine that sends its result on an unbuffered channel leaks when the handler stops waiting on `ctx.Done()`. Give the channel a buffer of 1, or `select` on the context in the sender. Go 1.27 serves a `goroutineleak` profile next to the other pprof handlers.
- For outbound HTTP, share one `*http.Client` with `Timeout` set. Give each call a context deadline, `defer resp.Body.Close()`, and check the status before decoding.

## Request bodies and JSON

```go
const maxBodyBytes = 1 << 20

func decodeJSON[T any](w http.ResponseWriter, r *http.Request) (T, error) {
	var dst T
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBodyBytes))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&dst); err != nil {
		return dst, err // *http.MaxBytesError → 413, anything else → 400
	}
	if err := dec.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return dst, errors.New("body must hold a single JSON value")
	}
	return dst, nil
}
```

- Classify errors with `errors.As`, or `errors.AsType[*http.MaxBytesError](err)` on 1.26+. Never match the `err.Error()` text: 1.27 changed it.
- The 1.27 engine keeps the v1 semantics:
  - Object keys match struct fields case-insensitively.
  - Duplicate keys keep the last value.
  - Invalid UTF-8 becomes U+FFFD.

  Decode into request DTOs that hold only fields the client may set. Never decode into DB or domain structs, which allows mass assignment.
- Nil slices encode as `null`, so return `[]T{}` when clients expect an array. `omitempty` doesn't drop zero structs or `time.Time`; use `omitzero` (1.24). `time.Duration` encodes as integer nanoseconds.
- Decoding into `any` turns numbers into `float64`, which corrupts int64 IDs above 2^53. Decode into typed fields or call `dec.UseNumber()`, and add `,string` to int64 IDs that JavaScript reads.
- `encoding/json/v2` (1.27) differs from v1:
  - Field names match case-sensitively.
  - Duplicate names and invalid UTF-8 are rejected.
  - Nil slices encode as `[]`.

  A service can adopt it, but don't mix v1 and v2 semantics for the same types.
- Marshal into a buffer before `WriteHeader`. Once the first write happens the status is fixed, and an encode error can no longer become a 500.
- `r.ParseMultipartForm(n)` caps memory use, not upload size, so wrap the body in `MaxBytesReader` first. Write uploads through an `os.Root` (1.24) so a file name can't escape the upload directory.

## Server timeouts and graceful shutdown

```go
func serve(ctx context.Context, logger *slog.Logger, h http.Handler) error {
	ctx, stop := signal.NotifyContext(ctx, os.Interrupt, syscall.SIGTERM)
	defer stop()
	srv := &http.Server{
		Addr:              ":8080",
		Handler:           h,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       2 * time.Minute,
		ErrorLog:          slog.NewLogLogger(logger.Handler(), slog.LevelError),
	}
	errCh := make(chan error, 1)
	go func() { errCh <- srv.ListenAndServe() }()
	select {
	case err := <-errCh:
		return err // failed to start, e.g. address in use
	case <-ctx.Done():
	}
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	return srv.Shutdown(shutdownCtx) // then drain workers, then close the DB pool
}
```

- `ReadHeaderTimeout` is the minimum, because it stops Slowloris attacks (gosec rule G112 flags its absence).
- `WriteTimeout` covers handler time plus writing, so it kills SSE and large downloads. On streaming servers, leave it at 0 and set per-request deadlines with `http.NewResponseController(w).SetWriteDeadline`.
- `http.TimeoutHandler` buffers the whole response and can't flush. It answers 503 on timeout and leaves your handler running unless the handler watches its context.
- `Shutdown` closes the listeners, then waits for active connections to go idle. It has two gaps:
  - It doesn't cancel request contexts. Set `BaseContext` to a context you cancel when the grace period runs out.
  - It doesn't wait for hijacked connections such as WebSockets. Track those yourself and use `RegisterOnShutdown`.
- On Kubernetes:
  - Fail readiness first.
  - Keep serving for a few seconds while the endpoints update.
  - Then call `Shutdown`.

  `terminationGracePeriodSeconds` must be longer than your shutdown timeout.

## Logging with slog

- Build one logger in `main` with `slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: levelVar, ReplaceAttr: redact}))`. Inject it, and call `slog.SetDefault` so stray `log` output goes to the same handler.
- The built-in handlers ignore context values. Wrap the handler so that `Handle` copies the request ID and trace ID out of the context, and log with `InfoContext(ctx, ...)`.
- Keys and values must alternate; `go vet` flags an odd count. Use `slog.LogAttrs` on hot paths, and a `*slog.LevelVar` to change the level at runtime.
- Never log tokens, cookies, the `Authorization` header or request bodies. Redact them in `ReplaceAttr`.

## Data access

- `database/sql` is driver-neutral:
  - Set `SetMaxOpenConns`, `SetMaxIdleConns` (the default keeps only 2 idle connections), `SetConnMaxLifetime` and `SetConnMaxIdleTime`.
  - Every `Query` needs `defer rows.Close()` and a `rows.Err()` check.
  - `QueryRowContext(...).Scan` reports `sql.ErrNoRows`.
  - For transactions, call `BeginTx`, then `defer tx.Rollback()`, which is a no-op after `Commit`.
- pgx v5 on Postgres:
  - Use `pgxpool.New(ctx, url)` directly rather than through `database/sql`. That gives you COPY, batches, LISTEN/NOTIFY and richer types.
  - `pgx.CollectRows(rows, pgx.RowToStructByName[T])` replaces hand-written scan loops.
  - Behind PgBouncer in transaction mode, run PgBouncer 1.21+ with `max_prepared_statements`, or set `default_query_exec_mode=exec` in the connection string.
- sqlc generates typed Go from SQL that carries `-- name: GetOrder :one` annotations. Set `sql_package: "pgx/v5"` in `sqlc.yaml`. Commit the generated code, and run `sqlc diff` in CI so it can't drift from the queries.
- Placeholders are `$1` on Postgres and `?` on MySQL. Sort columns and other identifiers can't be parameters, so map them from an allowlist.

## Testing

```go
func TestGetOrderNotFound(t *testing.T) {
	app := newTestApp(t)
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/v1/orders/999", nil)
	rec := httptest.NewRecorder()
	app.routes().ServeHTTP(rec, req) // through the mux: patterns, 405s and middleware all run
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body)
	}
}
```

- Use `httptest.NewServer` or `NewTLSServer` when the client side matters: timeouts, redirects, streaming, TLS. Make requests with `srv.Client()`.
- Test timeouts, retries and shutdown inside `synctest.Test` (1.25+) with `httptest.NewTestServer` (1.27). The fake clock then replaces sleeps.
- Always run `go test -race ./...`. Catch leaked goroutines with `go.uber.org/goleak` in `TestMain`.
- Run store tests against real Postgres, through testcontainers-go or a CI service, not against mocks of `*sql.DB`.

## Pitfalls

- Header changes after `WriteHeader` or the first `Write` are silently dropped, and the log shows "superfluous response.WriteHeader call". Set headers, then the status, then the body.
- Without a `return` after writing an error, the handler goes on to write a second response.
- If some dependency imports `net/http/pprof`, its handlers register on `http.DefaultServeMux`, so serving that mux publicly exposes profiling. Use your own mux, and put pprof on an admin listener bound to localhost.
- Rate limiting by `X-Forwarded-For` without a list of trusted proxies lets clients choose their own IP.
- An outbound `resp.Body` left unclosed leaks the connection and its goroutine.

## Review checklist

- [ ] `http.Server` sets `ReadHeaderTimeout`, and read, write and idle timeouts chosen on purpose; no bare `ListenAndServe`
- [ ] SIGTERM triggers `Shutdown` with a deadline, then workers drain and the pool closes
- [ ] Every body goes through `MaxBytesReader`; JSON is decoded into DTOs; unknown fields and trailing data are rejected
- [ ] `r.Context()` reaches every query and outbound call; no `context.Background()` inside handlers
- [ ] Outbound clients have timeouts and close response bodies
- [ ] Every error response is followed by `return`; headers are set before the status
- [ ] slog records the request ID; secrets are redacted; `go vet` is clean
- [ ] Routes are tested through the mux; `go test -race` passes
- [ ] Cookie-authenticated state changes sit behind `CrossOriginProtection` or CSRF tokens
- [ ] SQL is parameterized; rows are closed and `rows.Err()` is checked

<!-- Written for legacies (MIT). Checked against: https://go.dev/doc/go1.27, https://go.dev/doc/go1.26, https://go.dev/doc/go1.25, https://go.dev/doc/go1.24, https://go.dev/doc/go1.23, https://go.dev/blog/routing-enhancements, https://pkg.go.dev/net/http, https://pkg.go.dev/encoding/json, https://pkg.go.dev/github.com/jackc/pgx/v5, 2026-10 -->
