---
name: svelte-sveltekit
description: Svelte 5 runes and SvelteKit 2/3 patterns covering $state, $derived, $effect, $props, snippets, event attributes, load functions, form actions, server vs universal modules, hooks, environment modules, adapters and the SvelteKit 3 changes. Use when editing .svelte, .svelte.ts or +page/+layout/+server files, when package.json lists svelte or @sveltejs/kit, when replacing Svelte 4 syntax (export let, $:, on:, slots, stores), or when upgrading to SvelteKit 3.
---

# Svelte 5 and SvelteKit

Targets **Svelte 5** (5.57) with **SvelteKit 2.x or 3.x**. SvelteKit 3.0 shipped on 2026-10-01 and moved the config, the lib alias, environment variables and several `$app` modules, so read the `@sveltejs/kit` version in `package.json` before writing imports. Items marked (2.x) or (3.x) apply to that major only. For an upgrade from 2 to 3, read `references/sveltekit-3-migration.md`.

## Svelte 4 syntax to stop writing

A component that uses runes rejects `export let` and `$:`, and treats `on:`, `<slot>` and `createEventDispatcher` as deprecated. Projects created by `sv create` force runes mode through `compilerOptions.runes`. `npx sv migrate svelte-5` converts most legacy files.

| Svelte 4 | Svelte 5 |
|---|---|
| `export let title; export let size = 'md'` | `let { title, size = 'md' } = $props()` |
| `$$props`, `$$restProps` | `let { title, ...rest } = $props()` |
| top-level `let count = 0` as state | `let count = $state(0)` |
| `$: double = count * 2` | `const double = $derived(count * 2)` |
| `$: if (open) track()` | `$effect` for real side effects, `$derived` for values |
| `on:click={fn}`, `on:submit\|preventDefault` | `onclick={fn}`; call `event.preventDefault()` in the handler |
| `createEventDispatcher()` | callback props: `let { onsave } = $props(); onsave?.(item)` |
| `<slot />`, `<slot name="footer" />`, `let:item` | `{@render children?.()}`, snippet props, snippet parameters |
| `<svelte:component this={C} />` | `<C />` (updates when `C` changes) |
| `new App({ target })`, `$set`, `$on` | `mount(App, { target, props })`, `unmount(app)` |
| `beforeUpdate` / `afterUpdate` | `$effect.pre` / `$effect` |
| binding to any child prop | the child opts in: `let { value = $bindable() } = $props()` |
| `writable()` store to share app state | a `$state` object or class in a `.svelte.ts` module |
| `$page` from `$app/stores` | `page` from `$app/state` (2.12+; `$app/stores` is removed in 3.x) |

`svelte/store` still exists for stream-like sources; don't add stores just to share state.

## Runes

- Runes only work in `.svelte`, `.svelte.js` and `.svelte.ts` files, so shared reactive logic goes in `*.svelte.ts`.
- `$state` deep-proxies plain objects and arrays, not class instances: declare `$state` fields on classes. Use `$state.raw` for large values you replace rather than mutate. Call `$state.snapshot(value)` before handing state to `structuredClone`, logs or non-Svelte libraries.
- Passing `count` to a function, or destructuring a state object, copies the current value. To stay reactive, pass the object, a getter (`() => count`) or a class instance.
- A module can't export a `$state` variable that is reassigned. Export an object and mutate its properties, or export getter and setter functions.
- `$derived(expr)` and `$derived.by(() => ...)` must be pure. Since 5.25 a derived can be reassigned (optimistic UI) and recomputes when a dependency changes.
- `$effect` is an escape hatch for DOM work, timers, subscriptions and analytics. It never runs during SSR, tracks only values read synchronously (nothing after an `await`), and can return a cleanup function. An effect that sets state to mirror other state is a bug: derive the value instead.
- Events are attributes, so a later attribute or spread replaces a handler: put local handlers after `{...rest}`.
- Snippets replace slots. Content between a component's tags becomes the `children` snippet. Named snippets are props typed `Snippet<[Item]>` from `svelte` and rendered with `{@render row(item)}`.
- `{@attach fn}` (5.29+) runs reactive element setup with a cleanup and can pass through components. Prefer it to `use:` in new code; `fromAction` wraps existing actions.
- Context: `const [getUser, setUser] = createContext<User>()` (5.40+) gives typed accessors without keys; older 5.x uses `setContext` and `getContext`. Put a `$state` object in context and mutate its fields, because reassigning the variable breaks the link.
- `class={{ active, muted: !enabled }}` and class arrays work since 5.16. Key lists that can change order: `{#each items as item (item.id)}`.
- `await` in markup or in `$derived`, and pending UI in `<svelte:boundary>`, need `compilerOptions.experimental.async`. Use them only when the project enables that flag.

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';
  type Props = { items: Item[]; onpick?: (item: Item) => void; empty?: Snippet };
  let { items, onpick, empty }: Props = $props();
  let query = $state('');
  const shown = $derived(items.filter((i) => i.name.toLowerCase().includes(query.toLowerCase())));
</script>

<input bind:value={query} aria-label="Filter" />
{#each shown as item (item.id)}
  <button type="button" onclick={() => onpick?.(item)}>{item.name}</button>
{:else}
  {@render empty?.()}
{/each}
```

## SvelteKit structure

```
src/routes/blog/[slug]/  +page.svelte  +page.ts  +page.server.ts  +layout.*  +server.ts  +error.svelte
src/routes/(app)/        route group: shares a layout, adds no URL segment
src/lib/                 $lib (2.x) or #lib (3.x, mapped in package.json "imports")
src/hooks.server.ts      handle, handleFetch, handleError, init
src/hooks.client.ts      handleError, init
src/hooks.ts             reroute, transport (run on both sides)
src/params/ (2.x)        param matchers; one src/params.ts with defineParams (3.x)
src/env.ts (3.x)         declared environment variables
src/app.d.ts             App.Locals, App.Error, App.PageData, App.PageState
svelte.config.js (2.x)   or sveltekit({ adapter, ... }) in vite.config.ts (3.x)
```

Segments: `[id]`, optional `[[lang]]`, rest `[...path]`, matcher `[id=int]`.

| File | Runs | Use for |
|---|---|---|
| `+page.svelte` | server render, then browser | UI: `let { data, form }: PageProps = $props()` (`PageProps` since 2.16) |
| `+page.ts`, `+layout.ts` | server on the first request, then browser | universal `load`: public APIs, non-serializable returns (classes, components) |
| `+page.server.ts`, `+layout.server.ts` | server only | DB, secrets, cookies, `locals`; `actions` (pages only) |
| `+server.ts` | server only | `GET`/`POST`/... handlers that return a `Response` |

Page options exported from `+page` or `+layout` modules: `prerender` (`true`, `false`, `'auto'`), `ssr = false` (render this subtree in the browser only), `csr = false` (ship no JS), `trailingSlash`.

## Load functions

- A server `load` returns devalue-serializable data: JSON plus `Date`, `Map`, `Set`, `BigInt` and `RegExp`. Custom classes need a `transport` hook. When a route has both loads, the server result reaches the universal `load` as `data`.
- Use the `fetch` passed to `load`. It forwards cookies, accepts relative URLs, calls your `+server` handlers without HTTP, and inlines responses so hydration doesn't fetch again.
- All loads of a page run in parallel; start independent requests before `await parent()`.
- To stream slow, non-critical data, return an un-awaited promise from a server `load`, attach a `.catch`, and render it with `{#await}`.
- Re-running: `depends('app:cart')` with `invalidate('app:cart')`. `invalidateAll()` (2.x) is `refreshAll()` in 3.x. A load reruns when the params, URL parts or parent data it read change; `untrack` opts a read out.
- `error(404, 'Not found')` and `redirect(303, '/login')` throw by themselves. In a `catch`, re-throw anything for which `isHttpError(e) || isRedirect(e)` is true.

## Form actions

```ts
// src/routes/todos/+page.server.ts
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) redirect(303, '/login');
  return { todos: await db.todos.list(locals.user.id) };
};

export const actions = {
  create: async ({ request, locals }) => {
    if (!locals.user) return fail(401, { message: 'Sign in first' });
    const text = String((await request.formData()).get('text') ?? '').trim();
    if (!text) return fail(400, { text, message: 'Text is required' });
    await db.todos.create(locals.user.id, text);
    return { created: true };
  }
} satisfies Actions;
```

```svelte
<script lang="ts">
  import { enhance } from '$app/forms';
  import type { PageProps } from './$types';
  let { data, form }: PageProps = $props();
</script>

<ul>{#each data.todos as todo (todo.id)}<li>{todo.text}</li>{/each}</ul>
<form method="POST" action="?/create" use:enhance>
  <input name="text" value={form?.text ?? ''} />
  {#if form?.message}<p role="alert">{form.message}</p>{/if}
  <button>Add</button>
</form>
```

- A page has either a `default` action or named ones (`?/create`), never both.
- Every action is a public POST endpoint, so authenticate, authorize and validate inside it. Return `fail(status, data)` with the submitted values (never secrets), and `redirect(303, ...)` when success should navigate.
- `use:enhance` keeps the form working without JS. A custom callback must call `update()` or `applyAction(result)`.
- Remote functions (`*.remote.ts` files using `query`, `form`, `command` and `prerender` from `$app/server`) are experimental. Use them only if the config enables `experimental.remoteFunctions`.

## Hooks and auth

```ts
// src/hooks.server.ts
import type { Handle } from '@sveltejs/kit/hooks'; // 2.x: import type { Handle } from '@sveltejs/kit'

export const handle: Handle = async ({ event, resolve }) => {
  event.locals.user = await sessions.verify(event.cookies.get('session'));
  return resolve(event);
};
```

- `handle` resolves the user into `event.locals` (typed in `app.d.ts`). Combine several handles with `sequence` from `@sveltejs/kit/hooks`.
- Authorize in every server `load`, action and `+server` handler. A guard in `+layout.server.ts` doesn't run for actions or `+server` requests and may not rerun on client navigation.
- `handleError` must never throw, and it returns a safe `App.Error` without stack traces. In 3.x it also receives expected `error()` calls and can return a `status`.
- `handleFetch` rewrites server-side `fetch` calls (internal hosts, auth headers). `reroute` maps URLs to routes (i18n) and must stay pure and fast. `transport` serializes custom classes across the server/client boundary.

## Environment variables

- 2.x: `$env/static/private` (inlined at build) and `$env/dynamic/private` (read at runtime) are server-only. `$env/static/public` and `$env/dynamic/public` expose `PUBLIC_`-prefixed values. Dynamic modules are unavailable while prerendering.
- 3.x: declare variables in `src/env.ts` and import them from `$app/env/private` (server only) or `$app/env/public`. `$env/*` and `$app/environment` still work but are deprecated, and SvelteKit 4 removes them.

```ts
// src/env.ts (3.x)
import { defineEnvVars } from '@sveltejs/kit/env';
import * as v from 'valibot';

export const variables = defineEnvVars({
  DATABASE_URL: { schema: v.pipe(v.string(), v.url()) },
  ANALYTICS_ID: { public: true, schema: v.string() },
  DEBUG_PANEL: { static: true, schema: v.optional(v.string()), description: 'Bundle the debug panel' }
});
```

Variables are private and resolved at runtime by default. `public: true` exposes a variable to the browser, and `static: true` inlines it at build so dead code can be dropped. An invalid value stops the build or the server start.

## Adapters

- `adapter-auto` detects only supported hosts. Once the target is known, switch to an explicit adapter: `adapter-node`, `adapter-static`, `adapter-vercel`, `adapter-netlify` or `adapter-cloudflare`.
- `adapter-static` needs every route to be prerenderable, or a `fallback` page for SPA mode.
- Behind a proxy, form actions fail the CSRF origin check until the public origin is set: on 2.x with adapter-node, the `ORIGIN` env var; on 3.x, the `paths.origin` option.
- 3.x: adapter-node serves only assets that existed at build time, adapter-vercel no longer has an edge runtime, and adapter-cloudflare reads `env` and `ctx` from `cloudflare:workers` instead of `platform`.

## Production rules

1. Keep secrets, DB clients and server SDKs in server modules: `+page.server.ts`, `+server.ts`, hooks, `*.server.ts` files and `$lib/server/` (on 3.x, any `server` directory outside `src/routes`). The build fails when client code imports them; move the code instead of bypassing the check.
2. Never keep per-user data in module-level variables or module `$state` on the server: all requests share them. Use `event.locals`, load data or context.
3. Keep the CSRF origin check: `csrf.checkOrigin` on 2.x; on 3.x it is always on, and `csrf.trustedOrigins` adds exceptions.
4. Set cookies with `cookies.set`, which defaults to httpOnly, secure and `sameSite: 'lax'`. On 2.x `path` is required; on 3.x it defaults to `/`.
5. Use `{@html}` only with sanitized content.
6. Validate redirect targets that come from user input. On 3.x, `redirect()` to another origin needs `{ external: true }` or an allowlist, and `goto()` rejects URLs outside the app (use `window.location.href`).
7. Prerender pages that don't vary per request, and set `csr = false` where a page needs no JS.
8. With a base path, build links with `resolve('/blog/[slug]', { slug })` and assets with `asset()` from `$app/paths` (2.26+). On 3.x, `base` and `assets` are removed.

## Testing and commands

- `npm run dev`, `build` and `preview` run `vite dev|build|preview`. `npm run check` runs `svelte-kit sync && svelte-check --tsconfig ./tsconfig.json`. Add tooling with `npx sv add vitest playwright eslint`.
- Unit tests run in Vitest. Tests that use runes need `.svelte` in the file name (`cart.svelte.test.ts`). Wrap effect-driven code in `$effect.root` and call `flushSync()`.
- Component tests use Vitest with jsdom, `resolve.conditions: ['browser']` and `@testing-library/svelte`, or Vitest browser mode.
- E2E tests run in Playwright against `npm run build && npm run preview` (port 4173). Submit forms with JavaScript enabled and disabled.

## Pitfalls

- Slot content passed to a component that renders with `{@render}` never shows. Convert the parent to snippets too.
- `let { count } = counter` freezes the value. Read `counter.count`.
- An `$effect` that writes state it also reads loops forever. Derive the value, or `untrack` the read.
- A server load that returns a class instance or a function fails to serialize. Return plain data, move it to a universal load, or add a `transport` hook.
- A global `fetch` in `load` drops cookies and fetches twice. Use the `fetch` argument.
- A `redirect()` inside `try/catch` gets swallowed. Move it out of the `try`, or re-throw when `isRedirect(e)`.
- On 3.x, `$lib`, `$app/stores`, `$app/environment`, `base` from `$app/paths` and `svelte.config.js` no longer resolve. Follow the migration reference.

## Review checklist

- [ ] No Svelte 4 syntax in runes components, and no new stores for plain shared state.
- [ ] Every `$effect` is a real side effect with cleanup; computed values use `$derived`.
- [ ] Imports match the installed SvelteKit major (`$lib` or `#lib`, env modules, `$app/state`).
- [ ] Server-only code and private env stay in server modules; no request data in module state.
- [ ] Every action and `+server` handler authenticates, authorizes and validates its input.
- [ ] Loads use the provided `fetch`, avoid waterfalls and stream non-critical data.
- [ ] `npm run check`, unit tests and Playwright pass.

<!-- Written for legacies (MIT). Checked against: https://svelte.dev/docs/svelte/v5-migration-guide, https://svelte.dev/docs/svelte/$state, https://svelte.dev/docs/svelte/$derived, https://svelte.dev/docs/svelte/$effect, https://svelte.dev/docs/svelte/@attach, https://svelte.dev/docs/svelte/context, https://svelte.dev/docs/svelte/testing, https://svelte.dev/docs/kit/load, https://svelte.dev/docs/kit/form-actions, https://svelte.dev/docs/kit/hooks, https://svelte.dev/docs/kit/configuration, https://svelte.dev/docs/kit/environment-variables, https://svelte.dev/docs/kit/remote-functions, https://svelte.dev/docs/kit/migrating-to-sveltekit-3, https://svelte.dev/blog/sveltekit-3-is-here, 2026-10 -->
