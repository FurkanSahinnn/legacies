---
name: astro-patterns
description: Astro 7 patterns covering islands and client directives, server islands, content collections and live collections, on-demand rendering with adapters, actions, middleware, sessions, route caching, astro:assets images, view transitions, astro:env and React, Vue or Svelte islands. Use when editing .astro files, astro.config.*, src/content.config.ts or src/actions, adding an integration or adapter, fixing hydration or env bugs, cutting shipped JavaScript, or upgrading from Astro 5 or 6.
---

# Astro 7

Targets **Astro 7** (7.0 shipped on 2026-06-22; 7.4 is current), with Vite 8, a Rust `.astro` compiler, Node 22 (22.12+ since 6.0; the `engines` field of 7.4 asks for 22.23.4+) and Zod 4 through `astro/zod`. Check `astro` in `package.json`: projects on 5.x or 6.x still use some APIs listed under "Upgrading". Components inside islands follow their own framework's rules (the react and vue packs); this skill covers the Astro layer.

## Mental model

- `.astro` components render on the server or at build time and ship no JavaScript. Frontmatter (between the `---` fences) never reaches the browser.
- Interactivity comes from framework components with a `client:*` directive (islands), or from `<script>` tags, which Astro bundles and deduplicates (`is:inline` opts out).
- Output is static by default: every route prerenders at build. A route renders per request only with an adapter plus `export const prerender = false`, or under `output: 'server'`, where `prerender = true` opts pages back into static.

## Project structure

```
src/pages/              routes: .astro, .md/.mdx, .ts endpoints exporting GET, POST, ...
src/layouts/ src/components/
src/content.config.ts   build-time collections
src/live.config.ts      request-time (live) collections
src/actions/index.ts    export const server = { ... }
src/middleware.ts       export const onRequest
src/fetch.ts            reserved in 7.x for advanced routing (rename unrelated files, or set fetchFile)
src/env.d.ts            App.Locals and App.SessionData types
public/                 copied as-is, never optimized
astro.config.mjs|ts
```

## Islands

| Directive | Hydrates | Use for |
|---|---|---|
| none | never | the default: static HTML, even from React, Vue or Svelte components |
| `client:load` | on page load | controls needed immediately |
| `client:idle` | when the browser is idle (`{{ timeout: 500 }}` caps the wait) | lower-priority widgets |
| `client:visible` | on entering the viewport (`{{ rootMargin }}`) | anything below the fold |
| `client:media="(max-width: 50em)"` | when the media query matches | viewport-specific UI |
| `client:only="react"` | in the browser only, no server render | browser-only libraries; the framework name is required |
| `server:defer` | in a separate server request after the page | per-user fragments on a cacheable page (needs an adapter) |

```astro
---
import CartButton from '../components/CartButton.tsx';
import Reviews from '../components/Reviews.vue';
import UserMenu from '../components/UserMenu.astro';
const { product } = Astro.props;
---
<CartButton client:load productId={product.id} />
<Reviews client:visible productId={product.id} />
<UserMenu server:defer>
  <span slot="fallback">Account</span>
</UserMenu>
```

- Add UI frameworks with `npx astro add react` (or `vue`, `svelte`, `preact`, `solid`). When React shares the project with Preact or Solid, scope each integration with `include` globs. Vue apps register plugins through the integration's `appEntrypoint`.
- `client:*` works only on framework components imported into `.astro` files. An `.astro` component can't be hydrated, and framework components can't import `.astro` components.
- Island props must be serializable: plain objects, arrays, strings, numbers, `Map`, `Set`, `Date`, `RegExp`, `BigInt`, `URL` and typed arrays. Functions can't cross, so keep the handler inside the island or share state through a store such as nanostores.
- Children and named slots arrive as static HTML. React, Preact and Solid get `children` plus camelCased slot props (`slot="social-links"` becomes `socialLinks`); Vue and Svelte get slots.
- Islands don't share framework context, even when they use the same framework. Share state through a framework-agnostic store or the URL.
- Server islands encrypt their props into a GET URL that can be cached. Past 2048 bytes Astro switches to an uncached POST, so pass ids, not records. Inside the island `Astro.url` is `/_server-islands/<Name>`; read the page URL from the `Referer` header. Set `ASTRO_KEY` (from `astro create-key`) for rolling or multi-region deploys.

## Content collections

```ts
// src/content.config.ts
import { defineCollection, reference } from 'astro:content';
import { file, glob } from 'astro/loaders';
import { z } from 'astro/zod';

const authors = defineCollection({
  loader: file('src/data/authors.json'),
  schema: z.object({ name: z.string(), email: z.email() }),
});

const blog = defineCollection({
  loader: glob({ base: './src/content/blog', pattern: '**/*.{md,mdx}' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      pubDate: z.coerce.date(),
      cover: image().optional(),
      author: reference('authors'),
      draft: z.boolean().default(false),
    }),
});

export const collections = { authors, blog };
```

- `getCollection('blog', ({ data }) => !data.draft)` returns entries in no guaranteed order, so sort them. Use `getEntry('blog', id)` for one entry and `getEntries()` to resolve references.
- Render with `const { Content, headings } = await render(entry)`, where `render` comes from `astro:content`.
- `entry.id` comes from the file name or a frontmatter `slug`. Since 6.0, `entry.slug`, `entry.render()`, `type: 'content' | 'data'`, `src/content/config.ts` and `getEntryBySlug()` are gone.
- Zod 4 changes the API: `z.email()` and `z.url()` replace string refinements, and custom messages use `error:`. Import `z` from `astro/zod`, not from `astro:content`.
- Live collections (`src/live.config.ts`, `defineLiveCollection` and a custom loader) fetch on every request and need on-demand rendering. `getLiveCollection()` and `getLiveEntry()` return `{ entries | entry, error, cacheHint }` instead of throwing, so check `error`.

## On-demand rendering, sessions and caching

- Add an adapter with `npx astro add node` (or `vercel`, `netlify`, `cloudflare`).
- Set status and headers in the page frontmatter (`Astro.response.status = 404`), or return a `Response`. Child components can't change them once streaming has started. Use `Astro.redirect()` and `Astro.rewrite()` to navigate.
- Sessions (`Astro.session`, or `context.session` in endpoints, actions and middleware) offer `get`, `set`, `regenerate` and `destroy` on on-demand routes. The Node, Cloudflare and Netlify adapters provide a storage driver; other adapters need `session.driver` set with `sessionDrivers.<name>()` from `astro/config`. Since 7.2, `session: false` drops the session runtime. Call `regenerate()` after login.
- Route caching is stable since 7.0. Set it per route with `Astro.cache.set({ maxAge, swr, tags })`, for groups with top-level `routeRules`, and purge with `context.cache.invalidate({ tags })`. It needs a provider such as `cache: { provider: memoryCache() }` (`memoryCache` from `astro/config`); the CDN providers for Netlify, Vercel and Cloudflare are experimental. Caching is a no-op in `astro dev`.
- Cloudflare adapter 13+: read bindings with `import { env } from 'cloudflare:workers'` (`Astro.locals.runtime` is gone) and request metadata from `Astro.request.cf`. `astro dev` runs in workerd, and deploys go to Workers, not Pages.

## Actions

```ts
// src/actions/index.ts
import { ActionError, defineAction } from 'astro:actions';
import { z } from 'astro/zod';

export const server = {
  subscribe: defineAction({
    accept: 'form',
    input: z.object({ email: z.email() }),
    handler: async ({ email }, context) => {
      if (!context.locals.user) throw new ActionError({ code: 'UNAUTHORIZED' });
      await newsletter.add(context.locals.user.id, email);
      return { subscribed: true };
    },
  }),
};
```

- From an island, call `const { data, error } = await actions.subscribe(formData)` with `actions` imported from `astro:actions`. `isInputError(error)` exposes per-field messages in `error.fields`. Keep `.orThrow()` for prototypes.
- An HTML form posts with `<form method="POST" action={actions.subscribe}>` and reads `Astro.getActionResult(actions.subscribe)`. That page must render on demand.
- Every action is a public endpoint named after its key, so authorize inside the handler. Gating in middleware with `getActionContext()` is an extra layer, not a replacement.

## Middleware

```ts
// src/middleware.ts
import { defineMiddleware, sequence } from 'astro:middleware';

const auth = defineMiddleware(async (context, next) => {
  context.locals.user = await readUser(context.cookies.get('session')?.value);
  if (context.url.pathname.startsWith('/account') && !context.locals.user) {
    return context.redirect('/login');
  }
  return next();
});

export const onRequest = sequence(auth);
```

- Middleware runs at build time for prerendered pages, so it can't protect them: gated routes need `prerender = false`.
- `context.rewrite('/path')` runs middleware again for the new route; `next('/path')` rewrites without running it again.
- Astro 7's `src/fetch.ts` (advanced routing, Hono-compatible) takes over the whole request pipeline. Keep `src/middleware.ts` unless you need that control.

## Images

- `<Image src={hero} alt="..." />` and `<Picture src={hero} formats={['avif', 'webp']} alt="..." />` come from `astro:assets`, and `alt` is required. Import local images from `src/` so they're optimized and hashed; `public/` files are served untouched.
- Remote images are optimized only for hosts listed in `image.domains` or `image.remotePatterns`. Give them `width` and `height`, or `inferSize`.
- Responsive images: `layout="constrained" | "full-width" | "fixed"` on one image, or `image.layout` globally (5.10+). Mark the LCP image with `priority`.
- `getImage()` runs on the server only and throws in the browser since 6.0. Since 6.0 images are cropped to the requested size by default and never upscaled.

## View transitions

- `<ClientRouter />` from `astro:transitions` in the shared `<head>` turns navigations into client-side swaps; `<ViewTransitions />` was removed in 6.0. Without it, CSS `@view-transition { navigation: auto; }` gives native cross-document transitions without JS in browsers that support them.
- Under `<ClientRouter />`, bundled module scripts run only once. Re-initialize in an `astro:page-load` listener, and add `data-astro-rerun` to inline scripts that must run on every page.
- `transition:persist` keeps an island's state across pages, `transition:name` pairs elements, and `data-astro-reload` forces a full load. 7.0 removed the `TRANSITION_*` constants and helper functions; listen for string events such as `'astro:after-swap'`.

## Environment variables

```ts
// astro.config.mjs
import { defineConfig, envField } from 'astro/config';

export default defineConfig({
  env: {
    schema: {
      API_SECRET: envField.string({ context: 'server', access: 'secret' }),
      API_URL: envField.string({ context: 'client', access: 'public', default: 'https://api.example.com' }),
    },
  },
});
```

- Import with `import { API_SECRET } from 'astro:env/server'` and `import { API_URL } from 'astro:env/client'`. Server secrets are read at runtime, and client secrets don't exist.
- `import.meta.env` values are replaced at build time (always, since 6.0) and never coerced, so `'false'` is a truthy string. Only `PUBLIC_*` keys reach client code. In SSR, read deploy-time secrets from `astro:env/server` or `getSecret()`, never from `import.meta.env`.
- `astro:env` isn't available inside `astro.config.*`; use `process.env` or Vite's `loadEnv` there.

## Security

- `security.checkOrigin` (on by default) rejects cross-site form posts to on-demand pages. Keep it.
- `security.csp: true` (6.0+) hashes Astro's own scripts and styles; add `directives` and resources for third parties. It isn't applied in `astro dev`, so test CSP against `astro preview`.
- `set:html` skips escaping, so sanitize first. Validate user-supplied URLs before passing them to `navigate()` or `Astro.redirect()`.

## Upgrading

- 6.x to 7.x: run `npx @astrojs/upgrade`. The Rust compiler is strict: close every non-void tag, and invalid nesting such as a `<div>` inside a `<p>` is no longer repaired. `compressHTML` now defaults to `'jsx'`, which strips whitespace between inline elements; add `{" "}` or set `compressHTML: true`. Markdown and MDX render with Sätteri, so remark and rehype plugins need `@astrojs/markdown-remark` and its unified processor in `markdown.processor`. `src/fetch.ts` is reserved, `@astrojs/db` is removed, and `getContainerRenderer()` moves to `@astrojs/<framework>/container-renderer`.
- 5.x to 6.x: Node 22.12+, Zod 4, legacy collections removed, `Astro.glob()` replaced by `import.meta.glob()`, `<ViewTransitions />` replaced by `<ClientRouter />`, `import.meta.env` always inlined. CSP, the fonts API and live collections became stable.

## Testing and commands

- `astro dev`, `astro build`, `astro preview`, `astro check` (type-checks `.astro` files; needs `@astrojs/check` and `typescript`), `astro sync` (regenerates types) and `astro add <integration>`.
- Unit tests: Vitest configured through `getViteConfig()` from `astro/config`. Render `.astro` components to strings with `experimental_AstroContainer` from `astro/container`.
- E2E: Playwright with `webServer` running the production build through `astro preview` (port 4321).

## Pitfalls

- **Too much JavaScript.** `client:load` everywhere, a whole page wrapped in one React island, or a UI kit imported into an island for one button. Keep markup in `.astro`, hydrate the smallest interactive leaf with the laziest directive that works, and check the chunk sizes under `dist/_astro`.
- **Hydration mismatch.** Server and browser render different markup because of dates, locales, random ids or `window` checks during render. Render deterministically from props, move browser-only logic into effects, and use `client:only` as the last resort.
- **`window is not defined`.** A framework component touches browser globals while rendering on the server. Guard it inside an effect, or use `client:only`.
- **Env surprises.** A runtime value is ignored because `import.meta.env` was inlined at build, or a secret read inside a hydrated component is `undefined`. Read secrets from `astro:env/server` on the server and pass the island only what it needs.
- **Static page behind auth.** A middleware check guards a prerendered page, which is a static file anyone can fetch. Set `prerender = false`.
- **Unoptimized remote image.** The host is missing from `image.remotePatterns`.

## Review checklist

- [ ] Every `client:*` directive is needed, and it is the laziest one that works.
- [ ] Island props are small and serializable; no functions are passed.
- [ ] Gated pages, actions and endpoints render on demand and authorize on the server.
- [ ] Secrets come from `astro:env/server`; nothing secret is `PUBLIC_` or passed to an island.
- [ ] Collections use `src/content.config.ts`, loaders, `astro/zod`, `render(entry)` and `entry.id`.
- [ ] `astro check` and `astro build` pass, and E2E runs against `astro preview`.

<!-- Written for legacies (MIT). Checked against: https://astro.build/blog/astro-7/, https://docs.astro.build/en/guides/upgrade-to/v7/, https://docs.astro.build/en/guides/upgrade-to/v6/, https://docs.astro.build/en/reference/directives-reference/, https://docs.astro.build/en/guides/framework-components/, https://docs.astro.build/en/guides/server-islands/, https://docs.astro.build/en/guides/content-collections/, https://docs.astro.build/en/guides/on-demand-rendering/, https://docs.astro.build/en/guides/sessions/, https://docs.astro.build/en/guides/caching/, https://docs.astro.build/en/guides/actions/, https://docs.astro.build/en/guides/middleware/, https://docs.astro.build/en/guides/images/, https://docs.astro.build/en/reference/modules/astro-assets/, https://docs.astro.build/en/guides/view-transitions/, https://docs.astro.build/en/guides/environment-variables/, https://docs.astro.build/en/reference/configuration-reference/, https://docs.astro.build/en/guides/integrations-guide/cloudflare/, https://docs.astro.build/en/guides/testing/, 2026-10 -->
