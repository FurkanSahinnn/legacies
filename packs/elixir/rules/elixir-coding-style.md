---
paths:
  - "**/*.ex"
  - "**/*.exs"
  - "**/*.heex"
---
# Elixir and Phoenix

In depth: the `elixir-patterns` and `phoenix-liveview` skills.

## Conventions
- `mix format` owns layout (`.formatter.exs`, with `Phoenix.LiveView.HTMLFormatter` for HEEx); never hand-format. One module per file, with the path mirroring the name (`lib/my_app/accounts/user.ex` is `MyApp.Accounts.User`).
- `snake_case` functions and variables, `CamelCase` modules. Boolean functions end in `?` (the `is_` prefix is for guards); functions that raise end in `!`.
- Branch with multi-clause functions, guards and pattern matching instead of nested `if`/`case`. In `with`, every step returns a distinguishable `{:error, reason}`, so no `else` has to guess.
- Expected failures return `{:ok, value}` or `{:error, reason}`; broken invariants crash under a supervisor; `rescue` only where the error can be handled.
- `@impl true` on every callback, `@spec` and `@doc` on public functions, `@moduledoc` on public modules.
- Processes exist for state, concurrency or isolation, never to organize code; each long-lived one is supervised. No slow I/O inside `handle_call/3` on a shared server.
- Never `String.to_atom/1` on external input. No `IO.inspect` or `dbg` left in committed code.
- Secrets come from `config/runtime.exs` via `System.fetch_env!/1`, never from compile-time config or module attributes.
- Phoenix: `~p` routes, `{...}` interpolation in HEEx, forms through `to_form/2` with stable ids, `Repo` only inside contexts, queries filtered by the current scope, authorization in every `handle_event/3`.

## Tools and tests
- `mix format --check-formatted`, `mix compile --warnings-as-errors` (includes the type checker's warnings), `mix credo --strict`; `mix dialyzer` and `mix sobelow` where the project has them.
- `mix test` with `async: true` by default, processes started through `start_supervised!/1`, Mox mocks for behaviours, no `Process.sleep/1`. Rerun failures with `mix test --failed`.
- Phoenix 1.8 apps: run `mix precommit` before finishing.
