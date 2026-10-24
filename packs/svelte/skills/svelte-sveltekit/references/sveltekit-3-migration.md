# Upgrading SvelteKit 2 to 3

Read this only when moving a project from `@sveltejs/kit` 2.x to 3.x, or when 3.x code still uses 2.x APIs. SvelteKit 3.0 was released on 2026-10-01.

## Order of work

1. Upgrade to the latest 2.x and clear its deprecation warnings. From 2.62 the `sveltekit()` plugin in `vite.config` already accepts the config, and `src/env.ts` exists as an experimental option.
2. Meet the new minimums: Node 22.17, TypeScript 6, Svelte 5.57.1, Vite 8 (Rolldown) and `@sveltejs/vite-plugin-svelte` 7.
3. Run `npx sv migrate sveltekit-3 --tasks all --confirm`. It rewrites what it can and leaves a TODO list for the rest.
4. Work through the sections below, then run `npm run check`, the unit tests and Playwright.

## Config and TypeScript

- `svelte.config.js` is no longer read. The former `kit.*` options become top-level options of `sveltekit({ ... })` in `vite.config.ts`, next to `compilerOptions`. Options that vite-plugin-svelte owns (`inspector`, for example) go in the same object, and the `vitePlugin` key is gone.
- Removed options: `files.lib`, `preloadStrategy` (modulepreload is always used), `prerender.origin` (use `paths.origin`), `csrf.checkOrigin` (use `csrf.trustedOrigins`), `experimental.handleRenderingErrors`, `experimental.instrumentation`, and `experimental.tracing` (now top-level `tracing`).
- New options: `paths.origin`, `csrf.trustedOrigins`, `output.linkHeaderPreload` and `tracing.server`. `version.pollInterval` now defaults to one hour.
- `tsconfig.json` extends `$app/tsconfig` instead of `./.svelte-kit/tsconfig.json`, and lists its own `include` and `exclude`. The generated config turns on `isolatedModules` and `verbatimModuleSyntax`.

## Aliases and server-only code

- `$lib` is not generated any more. Map `#lib` in `package.json` and change the imports:

```json
{
  "imports": {
    "#lib": "./src/lib/index.js",
    "#lib/*": "./src/lib/*"
  }
}
```

- `#lib/...` imports need the file extension (`#lib/format.js` or `.ts`).
- Server-only now covers every file with a `server` segment (`db.server.ts`, `server.ts`) and every `server` directory except inside `src/routes` and `static`. Before 3.0 that applied only to `.server.` files and `src/lib/server`.

## `$app` modules

| 2.x | 3.x |
|---|---|
| `$app/stores` (`$page`, `$navigating`, `$updated`) | `$app/state` (`page`, `navigating`, `updated`), no `$` prefix |
| `$app/environment` | `$app/env`, which service workers can also import |
| `base`, `assets`, `resolveRoute` from `$app/paths` | `resolve()` and `asset()`; plain paths have no leading `/` (`asset('logo.png')`), route ids do (`resolve('/blog/[slug]', { slug })`) |
| `pushState` / `replaceState` | `goto(url, { shallow: true, state })`; `replace: true` for replace semantics |
| `invalidateAll()`, `goto(url, { invalidateAll })` | `refreshAll()`, `goto(url, { refreshAll })`; `refreshAll` keeps `page.state` |
| `goto` options `keepFocus` + `noScroll`, `replaceState` | `reset: false`, `replace` |
| `$service-worker` | `version` from `$app/env`; `assets`, `immutable`, `prerendered` from `$app/manifest`; paths from `$app/paths` |

- `goto()` now rejects URLs that aren't routes of the app; send users elsewhere with `window.location.href`.
- `page.url` is read-only: copy it with `new URL(page.url)` before changing it.
- `preloadData()` can resolve `{ type: 'error', status, error }`, and its redirect result carries `status`. Handle the new branch.
- Shallow navigations now fire `beforeNavigate`, `onNavigate` and `afterNavigate`; check the `shallow` property to skip them. `delta` is set only for `popstate` navigations.
- `use:enhance` on a form whose `action` points at another page now navigates there after submitting; `update({ navigate: false })` restores the old behavior.

## Environment variables

- `$env/static/*` and `$env/dynamic/*` are deprecated, and SvelteKit 4 removes them. Declare each variable in `src/env.ts` with `defineEnvVars` from `@sveltejs/kit/env`, then import from `$app/env/private` or `$app/env/public`.
- Each entry can set `schema` (a Standard Schema such as Zod or Valibot, or a function), `public`, `static` and `description`. Variables are private and dynamic unless marked otherwise.
- To make a value optional only during the build, pair the `building` flag from `$app/env` with a schema that accepts `undefined`.

## Errors

- `error(status, message)` takes a string message; extra `App.Error` fields go in a third argument. `App.Error` always has `status`.
- `handleError` now receives every error, including expected `error()` calls and validation errors (`kind: 'validation'`; `handleValidationError` is gone). It can return `status` to set the response code.
- Rendering errors go through `handleError` and the nearest `+error.svelte`. An async `handleError` in `hooks.client` needs `compilerOptions.experimental.async`.
- Use `isHttpError()` and `isRedirect()`, not `instanceof` checks.
- Enhanced form submissions respond with the status passed to `fail()` instead of always 200.

## Requests, cookies and security

- The CSRF origin check is always on in production builds. Allow extra origins with `csrf.trustedOrigins`; `'*'` is accepted but defeats the check. Cross-origin mutating requests without a `Content-Type` header are rejected.
- Cookies follow cookie v2: names must be ASCII, and the type names change (`SerializeOptions`, `ParseOptions`). `cookies.set` defaults `path` to `/`.
- `redirect()` to another origin needs `{ external: true }` or an allowlist of origins.
- `json()` and `text()` from `@sveltejs/kit` are superseded by `Response.json()` and `new Response()`.
- Type moves: hook types to `@sveltejs/kit/hooks`, env types to `@sveltejs/kit/env`, `defineParams` to `@sveltejs/kit/params`, remote function types to `$app/server`.
- An empty 2xx response from `+server.ts` has no body. `data-sveltekit-*` attributes take `false` instead of `'off'`.

## Routing details

- Param matchers move from `src/params/*.ts` into one `src/params.ts` built with `defineParams`. A matcher may return a value, return `undefined`, or be a Standard Schema.
- Clicking a link to the current page calls `refreshAll()`.
- A route `config` exported from a universal `+page.ts` or `+layout.ts` overrides the one from the server file.

## Adapters

- Every first-party adapter has a new major that requires SvelteKit 3.
- adapter-node: the `ORIGIN` env var is replaced by `paths.origin`. Static assets come from a list built at build time (files added later are not served), ETags are content hashes, and only `GET` and `HEAD` serve assets.
- adapter-cloudflare: import `env` and `ctx` from `cloudflare:workers` instead of reading `platform`; `cf` is on the `Request` and `caches` is global. Run `wrangler types` (wrangler 4.67+).
- adapter-vercel: the `edge` runtime is gone.
- adapter-netlify: follows the Netlify Frameworks API, sets the publish directory as an adapter option, and needs netlify-cli 17.31+ for previews.
- `@sveltejs/kit/node`: `getRequest` and `setResponse` are synchronous, and `@sveltejs/kit/node/polyfills` is gone.

## Service workers and observability

- Service workers register as `type: 'module'`. Typed context comes from `$app/service-worker` in `src/service-worker/index.ts`, with its own `tsconfig.json` extending `$app/tsconfig/service-worker`, and the root tsconfig excludes `src/service-worker`.
- `src/instrumentation.server.ts` runs automatically when present. OpenTelemetry spans need `tracing: { server: true }`, which adds overhead.

## Remote functions (still experimental)

- They need both `experimental.remoteFunctions` and `compilerOptions.experimental.async`. Without the flag, files with a `remote` segment are an error.
- Inside `query`, reading `event.url`, `event.params` or `event.route` throws; pass those values as arguments.
- Form fields are spread with `{...myForm.fields.title.as('text')}`. A hand-written `name` attribute is rejected.

<!-- Written for legacies (MIT). Checked against: https://svelte.dev/docs/kit/migrating-to-sveltekit-3, https://svelte.dev/blog/sveltekit-3-is-here, https://svelte.dev/docs/kit/configuration, https://svelte.dev/docs/kit/environment-variables, https://svelte.dev/docs/kit/$app-paths, 2026-10 -->
