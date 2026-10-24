---
name: elixir-patterns
description: Idiomatic Elixir 1.18-1.20 on OTP 27+ covering GenServer, supervision strategies, Task.Supervisor, Registry, let-it-crash versus tagged errors, pattern matching and with/else, structs, protocols and behaviours, mailbox and single-GenServer bottlenecks, ETS, binaries, the compiler's type warnings, config and releases, ExUnit with Mox, Credo and Dialyzer. Use when writing or reviewing .ex/.exs files, designing a supervision tree, chasing a slow or crashing process, or setting up Elixir tests and CI.
---

# Elixir and OTP Patterns

Targets **Elixir 1.20** (June 2026, needs Erlang/OTP 27+) and stays valid back to 1.17. Read `elixir:` in `mix.exs` and `.tool-versions` before using a version-specific feature. Phoenix, Ecto and LiveView are covered by the `phoenix-liveview` skill.

## What changed recently

| Version | Change that affects the code you write |
|---|---|
| 1.17 | Gradual set-theoretic types start emitting compile-time warnings; `Duration`, `Date.shift/2`, `to_timeout/1`; guard `is_non_struct_map/1` |
| 1.18 | Type checks function calls using inferred patterns and return types, flags clauses that can never match; built-in `JSON` with `@derive {JSON.Encoder, only: [...]}`; ExUnit `parameterize:` and `group:`; `mix format --migrate` rewrites `'abc'` to `~c"abc"` and `unless x` to `if !x` |
| 1.19 | Type checks protocol use (string interpolation, `for` generators) and anonymous functions; `MIX_OS_DEPS_COMPILE_PARTITION_COUNT=4 mix deps.compile` compiles deps in parallel OS processes |
| 1.20 | Infers types across whole function bodies and guards, narrows types in `case`/`cond`/`with`, warns on redundant clauses and dead code; an outer variable used as a bitstring size must be pinned (`<<name::binary-size(^len), rest::binary>>`); Logger backend functions are hard-deprecated in favor of `:logger` handlers |

The checker infers types from code and does not read `@spec`; user-written type signatures are not available yet. It only emits warnings, so CI must compile with `--warnings-as-errors`. When it flags something, fix the code (match the struct, handle the missing case); it is rarely wrong about an impossible branch.

## Processes: when and which

- Start a process only for runtime reasons: state that outlives a call, concurrency, or failure isolation. Grouping functions is a module's job, not a GenServer's.
- Keep GenServer callbacks thin and put the logic in pure functions you can test without a process. `init/1` blocks the supervisor, so return `{:ok, state, {:continue, :load}}` and do slow setup in `handle_continue/2`.
- Never do slow I/O inside `handle_call/3` on a shared server. Hand the work to `Task.Supervisor.async_nolink/2`, return `{:noreply, state}` and answer later with `GenServer.reply/2`.
- `GenServer.call/3` times out after 5 s and *exits* the caller. Raise the timeout only for a known reason; `:infinity` hides deadlocks.
- Supervisor strategies: `:one_for_one` for independent children, `:rest_for_one` when later children depend on earlier ones (children start in list order), `:one_for_all` when they only work together. The default intensity is 3 restarts in 5 s; a crash loop escalates to the parent, so fix the cause rather than raising the limit.
- Child `restart:` is `:permanent` (default) for services, `:transient` for workers that may finish normally, `:temporary` for one-shot work.
- Children created at runtime go under a `DynamicSupervisor`; wrap a hot one in `PartitionSupervisor` to spread the load.
- `Task.async/1` links to the caller, so a crashing task kills it. Use `Task.Supervisor.async_nolink/2` when the caller must survive, `Task.Supervisor.start_child/2` for fire-and-forget work, and `Task.async_stream/3` with `max_concurrency:`, `timeout:` and `on_timeout: :kill_task` for bounded parallel maps. An unsupervised `Task.start/1` loses its errors.
- `Registry` names dynamic processes through `{:via, Registry, {MyApp.Registry, key}}` and, with `keys: :duplicate`, serves as node-local pub/sub. It is per node; use `:pg` for groups across a cluster.

```elixir
# application.ex
children = [
  {Registry, keys: :unique, name: MyApp.RoomRegistry},
  {DynamicSupervisor, name: MyApp.RoomSup},
  {Task.Supervisor, name: MyApp.TaskSup}
]

Supervisor.start_link(children, strategy: :one_for_one, name: MyApp.Supervisor)

defmodule MyApp.Room do
  use GenServer, restart: :transient

  def start_link(id), do: GenServer.start_link(__MODULE__, id, name: via(id))
  def join(id, user), do: GenServer.call(via(id), {:join, user})
  defp via(id), do: {:via, Registry, {MyApp.RoomRegistry, id}}

  @impl true
  def init(id), do: {:ok, %{id: id, members: MapSet.new()}, {:continue, :load}}

  @impl true
  def handle_continue(:load, state),
    do: {:noreply, %{state | members: MyApp.Rooms.members(state.id)}}

  @impl true
  def handle_call({:join, user}, _from, state),
    do: {:reply, :ok, update_in(state.members, &MapSet.put(&1, user))}
end

# started on demand
DynamicSupervisor.start_child(MyApp.RoomSup, {MyApp.Room, room_id})
```

## Errors: return or crash

- Expected outcomes (invalid input, not found, a remote 4xx, a retryable timeout) return `{:ok, value}` or `{:error, reason}` and the caller decides. Add a raising `fetch!/1` variant only when callers want the exception.
- Broken invariants crash. Assert with a match (`{:ok, _} = Cache.put(key, value)`) when any other result means a bug; the supervisor restarts the process from a known state.
- Let it crash assumes a supervisor above the code and state you can rebuild. Keep state you can't lose in the database or in ETS, and reload it in `handle_continue/2`.
- `rescue` only at a boundary that can act on the error: convert a library exception to `{:error, reason}`, retry, or add context and `reraise e, __STACKTRACE__`. Never `rescue _ -> nil`.
- Exits are not exceptions. A call timeout or a dead callee is caught with `catch :exit, reason`, and only where you can recover.
- Domain errors are `defexception` structs with a `message/1`, so callers rescue by type, not by matching message strings.

## Pattern matching and `with`

- Branch in function heads with guards instead of `if`/`case` in one body; order clauses from specific to general (1.20 warns when a later clause can never match).
- `%{}` matches every map, structs included. Match the struct (`%User{}`) or guard with `is_non_struct_map/1`.
- `^` pins an existing value in any pattern: map keys, function heads, and outer variables in bitstring sizes (required since 1.20).
- In `with`, give every step a distinguishable `{:error, reason}` and drop the `else`: a value that doesn't match falls through unchanged. An `else` that guesses which step returned a bare `:error` or `nil` hides bugs, and one that misses a value raises `WithClauseError`.

```elixir
def checkout(user_id, cart) do
  with {:ok, user} <- Accounts.fetch_user(user_id),
       :ok <- ensure_active(user),
       {:ok, order} <- Orders.place(user, cart) do
    {:ok, order}
  end
end

defp ensure_active(%User{active: true}), do: :ok
defp ensure_active(%User{}), do: {:error, :inactive}
```

## Structs, protocols, behaviours

- `@enforce_keys` for fields without a sensible default, a `@type t :: %__MODULE__{...}`, and construction rules in `new/1` returning `{:ok, t}` or `{:error, reason}`.
- Structs don't implement `Access`: `user[:email]` raises. Use `user.email`, a pattern, or `Map.get/3`.
- Keep secrets out of logs and crash reports with `@derive {Inspect, except: [:password_hash, :token]}`.
- A protocol dispatches on the data type, including types you don't own. A behaviour is a contract for interchangeable modules (adapters, test doubles). Mark every callback implementation `@impl true`.
- Derive the JSON encoder the app actually uses: `JSON.Encoder` (1.18+) or `Jason.Encoder` (Phoenix still configures Jason). Always pass `only:` so new fields aren't serialized by accident.
- `@fallback_to_any true` turns a missing implementation into silent default behavior; write explicit implementations.

## Mailboxes, bottlenecks, ETS and binaries

| Symptom | Cause | Fix |
|---|---|---|
| Timeouts under load, one process at 100% CPU | every request goes through one GenServer, a global lock | serve reads from ETS; partition state by key (`PartitionSupervisor`, `Registry`); do the work in the caller |
| Memory and latency climb together | mailbox fills faster than it drains (`Process.info(pid, :message_queue_len)`) | backpressure: `call` instead of `cast`, bounded work, GenStage or Broadway for pipelines |
| A server slows as its queue grows | selective `receive` inside a callback scans every queued message | handle replies as messages in `handle_info/2`; never block in callbacks |
| ETS table disappears | tables die with their owner process | own tables in a dedicated long-lived process, or set `heir` |
| Memory held by a few small strings | a sub-binary keeps its large parent alive | `:binary.copy/1` before storing slices long-term |
| Atom table exhausted | `String.to_atom/1` on input; atoms are never collected | `String.to_existing_atom/1` or an explicit string-to-atom map |
| Slow sends, memory spikes | terms are copied to the receiver (only binaries over 64 bytes are shared) | send ids or small maps; bind fields before capturing them in a `Task` closure |

- ETS for read-heavy shared data: `:ets.new(:prices, [:set, :public, :named_table, read_concurrency: true, write_concurrency: :auto])` (`:auto` needs OTP 25+). Every read and write copies the term; use `:ets.update_counter/4` for atomic counters.
- `:persistent_term` is for rarely changing global data such as parsed config: reads are free, but each update triggers a scan of every process.
- Build output as iodata (nested lists of binaries) rather than `<>` in a loop.

## Config, Mix and releases

- `config/config.exs` and the env files are evaluated at build time. `config/runtime.exs` runs at boot in dev, test and releases; read secrets there with `System.fetch_env!/1` so a missing one stops startup.
- `Application.compile_env/3` in module bodies (a release refuses to boot if the value changed); `Application.fetch_env!/2` at runtime. `@key System.get_env("KEY")` bakes the build machine's value into the release.
- `mix release` builds `_build/prod/rel/my_app`; run `bin/my_app start`, `remote` or `eval "MyApp.Release.migrate()"`. Mix is absent in a release, so migrations run through a release module.
- Logger is configured through `:default_handler` and `:default_formatter`; `:console` backends are hard-deprecated in 1.20.
- Commit `mix.lock`. CI runs `mix deps.unlock --check-unused` and `mix hex.audit` (retired packages); `mix deps.audit` from mix_audit checks advisories.

## Testing with ExUnit and Mox

- `use ExUnit.Case, async: true` unless the test touches global state (application env, named singletons, `set_mox_global`). `group: :name` (1.18) serializes only that group; `parameterize: [%{...}, ...]` (1.18) runs the module once per map.
- Start processes with `start_supervised!/1` so each test gets a fresh one and cleanup is automatic.
- No `Process.sleep/1`. Wait with `assert_receive pattern, 500`, with `Process.monitor/1` plus `assert_receive {:DOWN, ^ref, :process, _, _}`, or with `:sys.get_state/1`, which returns once the server has handled earlier messages.
- Mock only behaviours you own, and inject the implementation through config read at runtime. Mox private mode works with async tests, tasks started by the test find their owner through `$callers`, and other processes need `allow/3`.

```elixir
defmodule MyApp.Weather do
  @callback current(city :: String.t()) :: {:ok, float()} | {:error, term()}
  def current(city), do: impl().current(city)
  defp impl, do: Application.get_env(:my_app, :weather, MyApp.Weather.Http)
end

# test/test_helper.exs
Mox.defmock(MyApp.WeatherMock, for: MyApp.Weather)
Application.put_env(:my_app, :weather, MyApp.WeatherMock)

defmodule MyApp.ReportTest do
  use ExUnit.Case, async: true
  import Mox
  setup :verify_on_exit!

  test "reports the temperature" do
    expect(MyApp.WeatherMock, :current, fn "Oslo" -> {:ok, 3.5} end)
    assert MyApp.Report.for_city("Oslo") =~ "3.5"
  end
end
```

`expect/4` fails the test if the call never happens; `stub/3` allows any number of calls and is never verified.

```bash
mix test test/my_app/room_test.exs:42       # one test
mix test --failed                           # rerun the last failures
mix test --repeat-until-failure 200 test/my_app/flaky_test.exs
mix format --check-formatted && mix compile --warnings-as-errors
mix credo --strict
mix dialyzer                                # dialyxir; cache the PLT in CI
```

Dialyzer still checks `@spec` contracts, which the compiler's type checker ignores; keep it if the project already runs it.

## Review checklist

- [ ] No process used just to organize code; every long-lived process is supervised with a deliberate `restart:` value.
- [ ] No hot-path request funnels through a single GenServer; reads come from ETS or `:persistent_term` where they should.
- [ ] Expected failures are tagged tuples, crashes are reserved for bugs, and nothing rescues everything.
- [ ] No `String.to_atom/1` on external input, no unbounded `Task.async` fan-out, no slow I/O in `handle_call/3`.
- [ ] Secrets are read in `config/runtime.exs` with `System.fetch_env!/1`.
- [ ] Compiles with `--warnings-as-errors` (type warnings included), formatted, Credo clean.
- [ ] Tests are async where possible, use `start_supervised!/1` and never sleep.

<!-- Written for legacies (MIT). Checked against: https://elixir.hexdocs.pm/1.20.4/changelog.md, https://elixir-lang.org/blog/2025/10/16/elixir-v1-19-0-released/, https://elixir-lang.org/blog/2024/12/19/elixir-v1-18-0-released/, https://elixir-lang.org/blog/2024/06/12/elixir-v1-17-0-released/, https://elixir.hexdocs.pm/gradual-set-theoretic-types.html, https://elixir.hexdocs.pm/1.20.4/Kernel.SpecialForms.html, https://mox.hexdocs.pm/Mox.html, https://www.erlang.org/doc/apps/stdlib/ets.html, 2026-10 -->
