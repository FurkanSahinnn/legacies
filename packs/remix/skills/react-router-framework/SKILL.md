---
name: react-router-framework
description: React Router v8 framework mode, the successor of Remix, covering routes.ts config, route modules, generated Route types, loaders and actions, middleware and context, forms and fetchers, revalidation, error boundaries, sessions, and SSR, SPA and prerender modes. Use when a project has react-router.config.ts, app/routes.ts or @react-router/* packages, when migrating from Remix v2 or React Router v7, or when @remix-run/* or react-router-dom imports appear next to react-router.
---

# React Router framework mode

Targets **React Router 8** (8.0 shipped on 2026-06-17; 8.5 is current) in framework mode, the successor of Remix v2. Baseline: Node 22.22+, React 19.2.7+, Vite 7+, ESM-only packages. React Router 7 still gets security fixes; Remix v2 and React Router 6 are end of life. Check `react-router` in `package.json`: on 7.x, the v8 behavior described here sits behind `future.v8_*` flags. Component, hook and state rules come from the react pack (`react-patterns`); this skill covers the router layer.

## Imports

| Need | Import from |
|---|---|
| `Link`, `Form`, `useFetcher`, `useNavigation`, `redirect`, `data`, `href`, `createContext`, `createCookieSessionStorage`, `isRouteErrorResponse`, `ServerRouter`, `createRoutesStub` | `react-router` |
| `HydratedRouter`, `RouterProvider` | `react-router/dom` |
| `route`, `index`, `layout`, `prefix`, `RouteConfig` | `@react-router/dev/routes` |
| `Config` (for `react-router.config.ts`) | `@react-router/dev/config` |
| `reactRouter()` Vite plugin | `@react-router/dev/vite` |
| `flatRoutes()` file-system routes | `@react-router/fs-routes` |
| Runtime adapters (`createFileSessionStorage`, request handlers) | `@react-router/node`, `@react-router/express`, `@react-router/serve`, `@react-router/cloudflare` |

Never import from `@remix-run/*` (Remix v2) or `react-router-dom` (removed in v8). `json()` and `defer()` were removed in v7: return plain objects, use `data(value, { status, headers })` for status and headers, and return promises to stream.

## Project structure

```
app/root.tsx           document shell: Layout export, default App, root ErrorBoundary
app/routes.ts          route config
app/routes/*.tsx       route modules (never name them *.server.tsx or *.client.tsx)
app/*.server.ts        server-only modules (also anything under app/.server/)
app/entry.server.tsx   optional; create with `npx react-router reveal entry.server`
react-router.config.ts ssr, prerender, basename, splitRouteModules
vite.config.ts         plugins: [reactRouter()]
.react-router/         generated types (gitignored)
```

`root.tsx` renders `<Outlet />`, `<Scripts />` and `<ScrollRestoration />`; add `<Meta />` and `<Links />` unless routes use React 19's `<title>`, `<meta>` and `<link>` elements. The `Layout` export wraps the app, `HydrateFallback` and `ErrorBoundary`, so it must not call `useLoaderData`; read `useRouteLoaderData('root')`, which can be `undefined`.

```ts
// app/routes.ts
import { type RouteConfig, index, layout, prefix, route } from '@react-router/dev/routes';

export default [
  index('routes/home.tsx'),
  route('login', 'routes/login.tsx'),
  layout('routes/app-shell.tsx', [
    route('projects/:projectId', 'routes/project.tsx', [
      index('routes/project-overview.tsx'),
      route('settings', 'routes/project-settings.tsx'),
    ]),
    ...prefix('admin', [route('users', 'routes/admin-users.tsx')]),
  ]),
] satisfies RouteConfig;
```

Paths support `:param`, optional `:lang?` and a trailing `*` splat (`params['*']`). `...(await flatRoutes())` mixes in file-system routes.

## Route modules and generated types

```tsx
// app/routes/project.tsx
import { data, Form, href, redirect, useNavigation } from 'react-router';
import type { Route } from './+types/project';
import { userContext } from '../context';
import { db } from '../db.server';

export async function loader({ params, context }: Route.LoaderArgs) {
  const user = context.get(userContext);
  const project = await db.project.findForUser(params.projectId, user.id);
  if (!project) throw data('Project not found', { status: 404 });
  return { project };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const user = context.get(userContext);
  const name = String((await request.formData()).get('name') ?? '').trim();
  if (!name) return data({ error: 'Name is required' }, { status: 400 });
  await db.project.rename(params.projectId, user.id, name);
  return redirect(href('/projects/:projectId', { projectId: params.projectId }));
}

export default function Project({ loaderData, actionData }: Route.ComponentProps) {
  const saving = useNavigation().state === 'submitting';
  return (
    <Form method="post">
      <input name="name" defaultValue={loaderData.project.name} />
      {actionData?.error && <p role="alert">{actionData.error}</p>}
      <button disabled={saving}>Save</button>
    </Form>
  );
}
```

- Types come from `./+types/<file>`, generated into `.react-router/types`. The dev server keeps them current; CI runs `react-router typegen && tsc`. `tsconfig.json` needs `"rootDirs": [".", "./.react-router/types"]` and `.react-router/types/**/*` in `include`.
- Route components receive `loaderData`, `actionData`, `params` and `matches` as props. Prefer them to `useLoaderData()` inside route modules; hooks remain for deeper components.
- Other exports: `clientLoader`, `clientAction`, `middleware`, `clientMiddleware`, `ErrorBoundary`, `HydrateFallback`, `headers`, `links`, `meta`, `handle`, `shouldRevalidate`. In v8, `meta` reads `loaderData`; the old `data` field is gone.
- `href('/projects/:projectId', { projectId })` builds type-checked paths; prefer it to string templates.
- `loader` and `action` are stripped from the client bundle along with imports only they use, but module-scope code and side-effect imports stay. Keep secrets and DB clients in `.server` modules so the build fails if client code reaches them.

## Loading, streaming and revalidation

- `loader` runs on the server for the document request and for the `.data` fetches of client navigations. `clientLoader` runs in the browser; add `clientLoader.hydrate = true as const` plus a `HydrateFallback` to run it on first load, and call `serverLoader()` to combine both.
- Loaders return plain values. Serialization covers what React passes from server to client components, including `Date`, `Map`, `Set` and promises. Return an un-awaited promise to stream it, then render with `<Suspense>` and `<Await>` or React's `use()`.
- Loaders of all matched routes run in parallel. Don't make a child wait on parent data; load what each route needs, or share it through middleware context.
- v8 passes `request` through untouched, so its URL can end in `.data`. Read the normalized URL from the `url` argument: `loader({ request, url })`.
- After any action, every loader on the page revalidates. Export `shouldRevalidate` to skip expensive ones, and call `useRevalidator().revalidate()` for manual refreshes.

## Forms and fetchers

- `<Form method="post">` and `useSubmit()` navigate and add a history entry. `useFetcher()` (`fetcher.Form`, `fetcher.submit`) mutates without navigating, which suits likes, inline edits and rows.
- Pending UI reads `useNavigation().state` or `fetcher.state`. Optimistic UI reads the submitted `fetcher.formData` or `navigation.formData`.
- For several mutations on one route, give the buttons `name="intent" value="delete"` and branch on it in the action.
- Return validation errors with `data({ errors }, { status: 400 })`. Throwing renders the error boundary instead of the form.
- Mutate only in actions, never in loaders: loaders run on prefetch and revalidation, and a GET has no CSRF protection.

## Middleware and context (always on in v8)

```ts
// app/context.ts: get() throws if nothing set the value and there is no default
import { createContext } from 'react-router';
export const userContext = createContext<User>();

// app/routes/app-shell.tsx
import { redirect } from 'react-router';
import type { Route } from './+types/app-shell';

export const middleware: Route.MiddlewareFunction[] = [
  async ({ request, context }) => {
    const session = await getSession(request.headers.get('Cookie'));
    const user = await findUser(session.get('userId'));
    if (!user) throw redirect('/login');
    context.set(userContext, user);
  },
];
```

- Server `middleware` runs parent to child before the loaders and actions of the matched routes, and in reverse afterwards. Call `next()` at most once and return its `Response` when you need post-processing; it runs automatically if you don't call it.
- `clientMiddleware` runs in the browser for client navigations and fetcher calls, and doesn't return a `Response`.
- `context` is a `RouterContextProvider`, not a plain object: use `createContext` keys with `context.set` and `context.get`. A custom server's `getLoadContext` must return a `RouterContextProvider`; module augmentation of `AppLoadContext` is obsolete.

## Sessions

- Create storage once in `app/sessions.server.ts` with `createCookieSessionStorage` from `react-router`: `httpOnly`, `secure`, `sameSite: 'lax'`, `path: '/'`, and `secrets` from the environment. Rotate secrets by putting the new one first.
- Read with `getSession(request.headers.get('Cookie'))`. Any change, including reading a `flash` value, must be followed by `commitSession` in a `Set-Cookie` header on the `data()` or `redirect()` response. Log out in an action with `destroySession`.
- Let one loader own each flash key, because parallel loaders race. Other storages: `createMemorySessionStorage` (tests), `createFileSessionStorage` (`@react-router/node`), `createWorkersKVSessionStorage` (`@react-router/cloudflare`).

## Rendering modes

- `ssr: true` (default) renders on the server and hydrates. Deploy both `build/server` and `build/client`.
- `prerender: true | string[] | async ({ getStaticPaths }) => paths` writes `.html` and `.data` files at build by running the normal loaders. Paths not listed are still server-rendered when `ssr` is true.
- SPA mode (`ssr: false`) prerenders the root into `build/client/index.html`. Only the root may have a `loader` unless a route is prerendered; `action` and `headers` exports are build errors. Fetch data with `clientLoader`, keep the first render SSR-safe (it runs at build), and rewrite unknown paths to the HTML fallback on the host.
- `splitRouteModules` (on by default in v8) puts `clientLoader`, `clientAction`, `clientMiddleware` and `HydrateFallback` into their own chunks. Set `'enforce'` to fail builds whose routes can't be split.

## Errors

- Every app needs a root `ErrorBoundary`. Its `error` prop (`Route.ErrorBoundaryProps`) is a thrown `data()` response (`isRouteErrorResponse(error)`), an `Error`, or anything else. Errors bubble to the closest route that exports a boundary.
- `throw data('Not found', { status: 404 })` for expected failures. In production, unexpected server errors reach the browser with a generic message and no stack; payloads thrown with `data()` are not sanitized, so never put internals in them.
- Report errors through `handleError` in `entry.server.tsx` (skip requests where `request.signal.aborted`) and the `onError` prop of `<HydratedRouter>` in `entry.client.tsx`.

## Migrating from Remix v2

1. On Remix 2, turn on and fix each future flag: `v3_fetcherPersist`, `v3_relativeSplatPath`, `v3_throwAbortReason`, `v3_lazyRouteDiscovery`, `v3_singleFetch` and `v3_routeConfig`.
2. Run `npx codemod remix/2/react-router/upgrade`, then check what it missed:

| Remix v2 | React Router |
|---|---|
| `@remix-run/react`, `@remix-run/server-runtime`, `@remix-run/testing` | `react-router` |
| `@remix-run/node`, `cloudflare`, `express`, `architect`, `serve`, `fs-routes` | `@react-router/<same name>` |
| `@remix-run/dev`, `@remix-run/route-config` | `@react-router/dev` |
| `vitePlugin as remix` from `@remix-run/dev` | `reactRouter()` from `@react-router/dev/vite`; its options move to `react-router.config.ts` |
| `<RemixServer>`, `<RemixBrowser>` | `<ServerRouter>` from `react-router`, `<HydratedRouter>` from `react-router/dom` |
| `remix vite:dev`, `remix vite:build`, `remix-serve` | `react-router dev`, `react-router build`, `react-router-serve` |
| `json(value)`, `json(value, { status })`, `defer({...})` | `value`, `data(value, { status })`, return the promises |
| `LoaderFunctionArgs`, `useLoaderData<typeof loader>()` | `Route.LoaderArgs`, the `loaderData` prop |
| `createRemixStub` | `createRoutesStub` |

3. Add `app/routes.ts`; keep the old file convention with `flatRoutes()` or `@react-router/remix-routes-option-adapter`. Add `.react-router/` to `.gitignore` and update `tsconfig.json` (`rootDirs`, `types: ["@react-router/node", "vite/client"]`).
4. Then go from 7 to 8: on the latest 7.x enable `v8_middleware`, `v8_splitRouteModules`, `v8_viteEnvironmentApi`, `v8_passThroughRequests` and `v8_trailingSlashAwareDataRequests`, uninstall `react-router-dom`, switch `meta` to `loaderData`, replace the Cloudflare dev proxy with `@cloudflare/vite-plugin`, and install `react-router@latest`. Replace `context.x` properties with `createContext` keys.

Remix 3 is a separate, non-React-Router framework. A Remix v2 app migrates to React Router, not to Remix 3.

## Testing and commands

- `react-router dev`, `react-router build`, `react-router-serve ./build/server/index.js`, `react-router typegen && tsc`.
- Unit-test loaders and actions as functions: pass a real `Request`, its `url`, `params` and a `RouterContextProvider` filled with `context.set`.
- Test reusable components that use router hooks inside `createRoutesStub([...])`, rendered with `initialEntries`. A route component typed with `Route.ComponentProps` doesn't fit a stub without `@ts-expect-error`, so cover whole routes with Playwright against the production build.

## Pitfalls

- An `@remix-run/*` or `react-router-dom` import in a v8 app: switch to `react-router` or `react-router/dom`.
- `json()` or `defer()` copied from old examples: return values, use `data()`, return promises.
- `new URL(request.url).pathname` ends in `.data` on client navigations: use the `url` argument.
- `context.db` on a plain object: v8 context is a provider; use `context.get(dbContext)`.
- A `.server` import used inside the component tree: the build fails. Move the use into `loader` or `action`.
- An auth check in a parent `loader` doesn't guard child loaders, because they run in parallel. Put it in `middleware` or in every loader and action.
- Throwing on validation errors renders the boundary and loses the form. Return `data(..., { status: 400 })`.

## Review checklist

- [ ] Imports come only from `react-router`, `react-router/dom` and `@react-router/*`.
- [ ] Route modules use `Route.*` types and props; `react-router typegen && tsc` passes.
- [ ] Auth runs in middleware or in every loader and action; mutations happen only in actions.
- [ ] Secrets live in `.server` modules; nothing sensitive goes into `data()` payloads or loader data.
- [ ] Sessions commit after every change, and cookies are httpOnly, secure and signed.
- [ ] Every route that can fail has a boundary above it, and the root has one.
- [ ] The rendering mode (`ssr`, `prerender`, SPA) matches the host.

<!-- Written for legacies (MIT). Checked against: https://remix.run/blog/react-router-v8, https://reactrouter.com/upgrading/v7, https://reactrouter.com/upgrading/remix, https://reactrouter.com/8.0.1/changelog.md, https://reactrouter.com/start/framework/routing, https://reactrouter.com/start/framework/route-module, https://reactrouter.com/start/framework/data-loading, https://reactrouter.com/start/framework/actions, https://reactrouter.com/explanation/type-safety, https://reactrouter.com/how-to/middleware, https://reactrouter.com/explanation/sessions-and-cookies, https://reactrouter.com/how-to/spa, https://reactrouter.com/how-to/pre-rendering, https://reactrouter.com/how-to/error-boundary, https://reactrouter.com/how-to/error-reporting, https://reactrouter.com/api/framework-conventions/root.tsx, https://reactrouter.com/api/framework-conventions/server-modules, https://reactrouter.com/start/framework/testing, https://v2.remix.run/docs/start/future-flags, 2026-10 -->
