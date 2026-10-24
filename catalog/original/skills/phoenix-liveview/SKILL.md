---
name: phoenix-liveview
description: Phoenix 1.8 and LiveView 1.1/1.2 patterns covering contexts and scopes, Ecto changesets, Repo.transact and Multi, preloads versus N+1, verified routes, HEEx function components, LiveView lifecycle, streams, async assigns, PubSub, uploads, JS commands, phx.gen.auth, CSRF and session security, telemetry, and ConnCase/LiveViewTest tests. Use when editing a Phoenix app (lib/*_web, router.ex, .heex files), building LiveViews or forms, or writing Phoenix and Ecto tests.
---

# Phoenix and LiveView

Targets **Phoenix 1.8** (1.8.16), **LiveView 1.2** (1.2.13) and **Ecto 3.13+**; most rules also hold for Phoenix 1.7 and LiveView 1.0/1.1. Check `mix.lock` before using a feature tied to a version. Plain Elixir and OTP are covered by the `elixir-patterns` skill.

## Outdated code to stop writing

| Old habit | Current form |
|---|---|
| `Routes.post_path(@conn, :show, post)` | `~p"/posts/#{post}"`, checked at compile time; `url(~p"/...")` for absolute URLs |
| `PostView` and `render(conn, "index.html", ...)` | `PostHTML` with `embed_templates "post_html/*"`; `render(conn, :index, posts: posts)` |
| `<%= @title %>` in a tag body | `{@title}`; `<%= %>` only for `if`/`case`/`for` blocks and inside `<script>`/`<style>` |
| `<.form let={f} for={@changeset}>` | `assign(socket, :form, to_form(changeset))`, `<.form for={@form} id="post-form">`, `<.input field={@form[:title]} />` |
| `phx-feedback-for` | removed in LiveView 1.0; `used_input?/1`, which the generated core components already call |
| `@current_user` | 1.8 `phx.gen.auth` assigns `@current_scope` (`%MyApp.Accounts.Scope{user: user}`) |
| a layout set by `use Phoenix.LiveView, layout: ...` | each LiveView renders `<Layouts.app flash={@flash} current_scope={@current_scope}>` around its markup |
| `Repo.transaction(fn -> ... end)` | `Repo.transact/2` (Ecto 3.13); `transaction/2` is deprecated |
| Floki-only test selectors such as `a:fl-contains("Sign up")` | LiveView 1.1+ tests parse with LazyHTML: `element(view, "a", "Sign up")` |
| hook code in a raw `<script>` or a hand-registered hook | colocated hook `<script :type={Phoenix.LiveView.ColocatedHook} name=".Chart">` (Phoenix 1.8+) |
| HTTPoison or Tesla | Req (new apps include it unless generated with `--no-mailer`) |

Also new in 1.8 and 1.2: `use Phoenix.Controller` expects `formats:` (leaving it out is deprecated); `put_secure_browser_headers` sends a default content-security-policy; Bandit is the default adapter; global attributes follow the MDN list (`attr :rest, :global, include: ~w(width height)` restores others); the `:colocated_js` config became `:colocated_assets`; `mix precommit` compiles with warnings as errors, unlocks unused deps, formats and runs the tests.

## Contexts, scopes and Ecto

- Web modules call context functions (`Blog.list_posts(scope)`); `Repo` stays inside contexts.
- With scopes, every context function takes the scope first and filters by it: `Repo.get_by!(Post, id: id, user_id: scope.user.id)`. Authorization lives in the query, not in a hidden button.
- `cast/3` lists only fields the user may edit. Ownership and privilege fields (`user_id`, `org_id`, `role`) are set from the scope in code, never cast from params.
- `unique_constraint/3`, `foreign_key_constraint/3` and `check_constraint/3` turn database errors into changeset errors; each needs the matching index or constraint in a migration.
- Read changeset values with `get_field/2` or `fetch_change/2` rather than digging into `changeset.changes`.
- `Repo.transact/2` takes a function returning `{:ok, value}` or `{:error, reason}` (an error rolls back), or an `Ecto.Multi` when named steps help with reporting (`{:error, step, value, changes_so_far}`). Send emails, broadcasts and HTTP calls after the commit, never inside the transaction.
- N+1 comes from touching an association per row: `Repo.preload` or `Repo.get` inside `Enum.map`. Preload once in the context: `Repo.preload(posts, [:author, comments: :user])` runs one query per association; a `join` plus `preload: [author: a]` loads in one query (avoid it for large has-many). `%Ecto.Association.NotLoaded{}` in a template means a preload is missing.
- Pin every value in queries (`^id`), pass values to `fragment("lower(?)", ^email)` instead of interpolating strings, build optional filters with `dynamic/2`, and paginate long lists by keyset.
- Generate migrations with `mix ecto.gen.migration name` and index every foreign key. `create index(..., concurrently: true)` needs `@disable_ddl_transaction true` and `@disable_migration_lock true`.

```elixir
def publish_post(%Scope{} = scope, id) do
  result =
    Repo.transact(fn ->
      post = Repo.get_by!(Post, id: id, user_id: scope.user.id)

      with {:ok, post} <- post |> Post.publish_changeset() |> Repo.update(),
           {:ok, _entry} <- Audit.record(scope, :post_published, post) do
        {:ok, post}
      end
    end)

  with {:ok, post} <- result do
    broadcast_post(scope, {:updated, post})
    {:ok, post}
  end
end
```

## Routes, components and HEEx

- Paths come from `~p`; `~p"/posts/#{post}"` uses `Phoenix.Param` (the id by default). Never concatenate path strings.
- Function components declare `attr` and `slot`; `attr :rest, :global` forwards HTML attributes. Reach for a LiveComponent only when a piece of UI needs its own state and event handling.
- `:if`, `:for` and `:key` replace most block code; `:key` (LiveView 1.1+) gives list items stable diffs: `<li :for={item <- @items} :key={item.id}>`. Class lists: `class={["btn", @active && "btn-active"]}`.
- Compute derived values in the LiveView and `assign` them. Local variables inside templates and passing the whole `assigns` map to helpers defeat change tracking.
- Give forms and the elements tests target stable ids. Form recovery after a reconnect needs a form `id`, and LiveView 1.2 tests warn about `phx-change` forms without one.
- `<.link navigate={...}>` mounts another LiveView in the same `live_session`, `patch={...}` stays in the current one and calls `handle_params/3`, and `href={...}` reloads the page.

```elixir
attr :post, MyApp.Blog.Post, required: true
attr :rest, :global
slot :actions

def post_card(assigns) do
  ~H"""
  <article id={"post-#{@post.id}"} {@rest}>
    <h2>{@post.title}</h2>
    <.link :if={@post.published_at} navigate={~p"/posts/#{@post}"}>Read</.link>
    <footer :for={action <- @actions}>{render_slot(action)}</footer>
  </article>
  """
end
```

## LiveView lifecycle and state

- `mount/3` runs twice: once for the static HTTP render and again when the socket connects. Keep it cheap. Subscribe, start timers and cause side effects only `if connected?(socket)`. Load slow data with `assign_async/3` (rendered with `<.async_result>`), `stream_async/4` (1.1.5+) for streams, or `start_async/3` plus `handle_async/3`; all of them start only once connected.
- Don't capture `socket` in an async closure, which copies every assign into the task. Bind the values you need first.
- URL state (filters, sort, page, selected id) is read in `handle_params/3` and changed with `push_patch/2`, so reloads and the back button work.
- `handle_event/3` receives untrusted input: any client can send any event name and payload. Re-check access through the context with `socket.assigns.current_scope` in every event that reads or writes data.
- Each connected user is a process holding its assigns. Long lists go in streams, which the server forgets after rendering; keep blobs and whole query results out of assigns.
- Streams: `stream/4` appends, with `reset: true` to replace (filtering), `at: 0` to prepend and `limit:` to cap; `stream_insert/4` adds or updates by DOM id; `stream_delete/3` removes; `stream_configure/3` sets `dom_id` before the first insert. The container needs an `id` and `phx-update="stream"`, and each child takes the generated id. Streams can't be enumerated on the server, so keep counts and empty-state flags in separate assigns, and re-insert an item when an assign that changes its markup changes.
- PubSub: subscribe when connected to a topic scoped to the owner (`"user:#{id}:posts"`, as the 1.8 generators do), broadcast from the context after the commit, handle the message in `handle_info/2`.
- Uploads: `allow_upload(socket, :avatar, accept: ~w(.jpg .png), max_entries: 1, max_file_size: 5_000_000)` in `mount`; the form needs both `phx-change` and `phx-submit`; render `<.live_file_input upload={@uploads.avatar} />`; in the submit handler, `consume_uploaded_entries/3` copies each temp file and returns `{:ok, value}`. `accept:` checks the extension and the client-reported MIME type, not the bytes, so verify the type server-side, and store files outside `priv/static` or in object storage (`external:` for presigned direct uploads).
- `Phoenix.LiveView.JS` changes the UI on the client without a round trip, and the change survives later patches: `JS.toggle(to: "#menu")`, `JS.show`, `JS.hide`, `JS.add_class`, `JS.dispatch`, piped into `JS.push("event")` when the server must know.
- An element with `phx-hook` needs a unique `id`; when the hook owns that element's DOM, add `phx-update="ignore"`.

```elixir
defmodule MyAppWeb.PostLive.Index do
  use MyAppWeb, :live_view
  alias MyApp.Blog

  @impl true
  def mount(_params, _session, socket) do
    if connected?(socket), do: Blog.subscribe_posts(socket.assigns.current_scope)
    {:ok, assign(socket, :page_title, "Posts")}
  end

  @impl true
  def handle_params(params, _uri, socket) do
    posts = Blog.list_posts(socket.assigns.current_scope, search: params["q"])
    {:noreply, stream(socket, :posts, posts, reset: true)}
  end

  @impl true
  def handle_event("delete", %{"id" => id}, socket) do
    scope = socket.assigns.current_scope
    post = Blog.get_post!(scope, id)
    {:ok, _} = Blog.delete_post(scope, post)
    {:noreply, stream_delete(socket, :posts, post)}
  end

  @impl true
  def handle_info({:deleted, post}, socket), do: {:noreply, stream_delete(socket, :posts, post)}
  def handle_info({_created_or_updated, post}, socket), do: {:noreply, stream_insert(socket, :posts, post)}

  @impl true
  def render(assigns) do
    ~H"""
    <Layouts.app flash={@flash} current_scope={@current_scope}>
      <div id="posts" phx-update="stream">
        <article :for={{dom_id, post} <- @streams.posts} id={dom_id}>
          {post.title}
          <button phx-click={JS.push("delete", value: %{id: post.id})} data-confirm="Delete?">Delete</button>
        </article>
      </div>
    </Layouts.app>
    """
  end
end
```

## Auth, CSRF and sessions

- `mix phx.gen.auth Accounts User users` (1.8) generates magic-link login with optional passwords, a `Scope` struct, and a `require_sudo_mode` plug and `on_mount` hook for sensitive pages. Pass `--live` or `--no-live`, and `--hashing-lib argon2` for Argon2.
- Protect a LiveView in both places: the router pipeline (`:require_authenticated_user`) covers the HTTP render, and `live_session :require_authenticated_user, on_mount: [{MyAppWeb.UserAuth, :require_authenticated}]` covers the socket and live navigation, which skips plugs. Then authorize each event as above.
- Keep `:protect_from_forgery` and `:put_secure_browser_headers` in the browser pipeline. `<.form>` embeds the CSRF token and the LiveView socket sends `_csrf_token` from the `csrf-token` meta tag; keep both. Leave `check_origin` on in production, and never change state on GET.
- The session cookie is signed, not encrypted: the client can read it. Store a token reference only, or add `encryption_salt`. The generated code renews the session on login and broadcasts `"disconnect"` to the `live_socket_id` topic on logout, so open LiveViews end with the session.
- HEEx escapes output; `raw/1` only for HTML you sanitized.
- Secrets (`SECRET_KEY_BASE`, `DATABASE_URL`) are read in `config/runtime.exs`; generate keys with `mix phx.gen.secret`. `mix sobelow` scans for Phoenix-specific security issues.

## Telemetry

The generated `MyAppWeb.Telemetry` supervisor lists `Telemetry.Metrics` definitions that LiveDashboard and reporters consume. Worth adding:

```elixir
summary("phoenix.router_dispatch.stop.duration", tags: [:route], unit: {:native, :millisecond}),
summary("phoenix.live_view.handle_event.stop.duration", tags: [:event], unit: {:native, :millisecond}),
summary("my_app.repo.query.total_time", unit: {:native, :millisecond}),
summary("my_app.repo.query.queue_time", unit: {:native, :millisecond})
```

- A high `queue_time` means the connection pool is exhausted, not that the SQL is slow.
- Emit domain events with `:telemetry.span([:my_app, :checkout], %{plan: plan}, fn -> {Checkout.run(cart), %{}} end)` or `:telemetry.execute/3`. Handlers run synchronously in the emitting process and are detached if they raise, so keep them small.
- For traces, add the OpenTelemetry instrumentation for Phoenix and Ecto (`opentelemetry_phoenix`, `opentelemetry_ecto`).

## Testing

- `DataCase` for contexts, `ConnCase` for controllers and LiveViews. Both check out an Ecto SQL sandbox connection, so `async: true` is safe on Postgres.
- `setup :register_and_log_in_user` (generated by `phx.gen.auth`) puts `conn`, `user` and `scope` in the test context.
- Drive LiveViews through `Phoenix.LiveViewTest` and assert on ids and selectors, not large HTML strings. `form/3` raises if the params name an input the form doesn't render.

```elixir
test "validates and creates a post", %{conn: conn} do
  {:ok, view, _html} = live(conn, ~p"/posts/new")

  assert view |> form("#post-form", post: %{title: ""}) |> render_change() =~ "can&#39;t be blank"

  {:ok, index, _html} =
    view
    |> form("#post-form", post: %{title: "Hello"})
    |> render_submit()
    |> follow_redirect(conn, ~p"/posts")

  assert has_element?(index, "#posts article", "Hello")
end
```

Other helpers: `element/3 |> render_click()`, `assert_patch/2`, `render_async/2` for `assign_async`, `file_input/4` with `render_upload/2`, `open_browser/1` to inspect the page while debugging. Test PubSub-driven updates by calling the context function and then `render(view)`.

```bash
mix test test/my_app_web/live/post_live_test.exs
mix test --failed
mix precommit            # Phoenix 1.8 alias: compile --warnings-as-errors, deps.unlock --unused, format, test
```

## Review checklist

- [ ] Context functions take the scope and filter by it; no `Repo` calls in web modules.
- [ ] `cast/3` excludes ownership fields; every unique or foreign key constraint has a database index behind it.
- [ ] Associations used in templates are preloaded; no queries inside loops.
- [ ] Side effects run after `Repo.transact/2` commits.
- [ ] LiveViews: cheap `mount`, URL state in `handle_params/3`, authorization in every `handle_event/3`, long lists in streams.
- [ ] Routes use `~p`, templates use `{}` interpolation and `@form[:field]`, and forms have ids.
- [ ] Authenticated routes sit in the right `live_session`; CSRF protection and secure headers are intact.
- [ ] `mix precommit` (or format, compile with warnings as errors, and tests) passes.

<!-- Written for legacies (MIT). Checked against: https://www.phoenixframework.org/blog/phoenix-1-8-released, https://phoenix.hexdocs.pm/changelog.html, https://phoenix.hexdocs.pm/Mix.Tasks.Phx.Gen.Auth.html, https://phoenix.hexdocs.pm/telemetry.html, https://phoenix-live-view.hexdocs.pm/changelog.html, https://www.phoenixframework.org/blog/phoenix-liveview-1-1-released, https://www.phoenixframework.org/blog/phoenix-liveview-1.0-released, https://phoenix-live-view.hexdocs.pm/Phoenix.LiveView.html, https://phoenix-live-view.hexdocs.pm/Phoenix.Component.html, https://phoenix-live-view.hexdocs.pm/Phoenix.LiveViewTest.html, https://phoenix-live-view.hexdocs.pm/security-model.html, https://phoenix-live-view.hexdocs.pm/telemetry.html, https://ecto.hexdocs.pm/Ecto.Repo.html, https://github.com/phoenixframework/phoenix/tree/v1.8.16/priv/templates, 2026-10 -->
