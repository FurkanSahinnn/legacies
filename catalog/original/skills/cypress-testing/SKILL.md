---
name: cypress-testing
description: Cypress 16 end-to-end and component tests covering the command queue (no async/await), retry-ability, cy.intercept stubbing and waiting, cy.session with test isolation, data-cy selectors, fixtures, typed custom commands and queries, cy.env and Cypress.expose, flake fixes, CI parallelisation with Cypress Cloud, and when Playwright fits better. Use when editing cypress.config.ts or cypress/**/*.cy.ts files, writing custom commands or component tests, upgrading Cypress, or fixing flaky Cypress runs.
---

# Cypress Testing (Cypress 16)

The current release is Cypress 16.2; 16.0 shipped on 2026-09-01. Cypress 16 needs Node 22, 24 or 26+, runs Chrome, Chromium and Edge traffic over HTTP/2, and supports TypeScript 5–7. Check the version in `package.json` before using 16-only APIs, because `Cypress.env()` and `cy.exec()` still exist on 15.x.

The `e2e-testing` skill (Playwright-based) covers generic E2E strategy: page objects, quarantine, artifacts and the report template. This skill covers what is specific to Cypress.

## Outdated APIs Claude tends to write

| Outdated | Use instead (since) |
|---|---|
| `cypress.json`, `pluginsFile`, `integrationFolder` | `cypress.config.ts` with `defineConfig({ e2e: { setupNodeEvents } })` (10) |
| `cy.server()`, `cy.route()` | `cy.intercept()` (removed in 12) |
| `Cypress.Cookies.preserveOnce()` | `cy.session()` (12) |
| `cypress open-ct` / `run-ct` | `cypress open --component` / `run --component` (14) |
| `cypress/react18`, `cypress/angular-signals`, `cypress/angular-zoneless` | `cypress/react` (React 18/19), `cypress/angular` (14, 16) |
| `.tab()` from a plugin | `cy.press(Cypress.Keyboard.Keys.TAB)` (14.3) |
| `Cypress.env('KEY')` | `Cypress.expose('KEY')` for public values, `cy.env(['KEY'])` for secrets (16) |
| `cy.exec('cmd')` | `cy.task('name')`, running `execFileSync` inside the Node task (16) |
| `.end()` | Start a new chain from `cy` (16) |
| `Cypress.config('viewportWidth', 800)` inside a test | `cy.viewport(800, 600)` (16) |
| `Commands.overwrite('getCookie', …)` | `Commands.overwriteQuery(…)`, because cookie and storage getters are queries now (16) |
| `experimentalMemoryManagement`, `experimentalFastVisibility` | `manageBrowserMemory`, `visibilityStrategy` (16) |

Cypress 16 splits configuration values in two:

- **`expose`:** non-secret values that the browser can read synchronously. Set them on the CLI with `--expose KEY=value`.
- **`env`:** secrets, readable only through `cy.env()`, which is asynchronous and returns just the keys you ask for. `CYPRESS_*` environment variables fill `env`, not `expose`.

Cypress doesn't redact values returned by `cy.env()`, so keep them out of assertions and `cy.log()`.

## The command queue: no async/await

- **Chainables, not values:** `cy.*` calls enqueue commands and return a Chainable, not the element or value. The queue runs after the test function returns, so `await cy.get()` and `const btn = cy.get()` don't work. Don't return a Promise from a test that also enqueues commands.
- **Synchronous code runs first:** any plain code between commands runs at enqueue time, before the commands do:

```ts
let orderId = ''
cy.get('[data-cy=order-id]').invoke('text').then((text) => { orderId = text })
cy.visit(`/orders/${orderId}`) // wrong: the URL was built before .then ran

cy.get('[data-cy=order-id]').invoke('text').then((id) => {
  cy.visit(`/orders/${id}`) // right: continue inside the callback
})
```

- **Passing values along:** use `.then()`, aliases (`.as('order')`, then `cy.get('@order')`), or `this.order` inside `function () {}` tests. Arrow functions have no `this`.
- **Aliases:** an alias of a query re-runs the query when it's read (since 12). Freeze a value with `.as('name', { type: 'static' })`.
- **Promises and Node work:** bring a Promise into the queue with `cy.wrap(promise)`, and do Node-side async work with `cy.task()`.
- **Conditional testing:** branching on what the DOM happens to show (`if ($body.find(...).length)`) causes flakes. Make the state deterministic with stubs and seeded data instead.

## Retry-ability

- **What retries:** queries (`get`, `find`, `contains`, `its`, `invoke`, `filter`, `eq` and others) retry together with their assertions, from the top of the chain, until `defaultCommandTimeout` (4 s) runs out. Actions (`click`, `type`, `check`, `select`) run once, after actionability checks. `.then()` never retries.
- **Where to assert:** put `.should()` right after the query, as in `cy.get('[data-cy=row]').should('have.length', 3)`. Don't write `.then(($rows) => expect($rows).to.have.length(3))`.
- **Several checks on one subject:** use `.should(($el) => { … })`. The callback retries, and calling `cy.*` inside it throws.
- **Actions end chains:** put actions at the end of a chain, and re-query after anything that re-renders. This avoids "detached from the DOM" errors:

```ts
cy.get('[data-cy=todo-input]').type('Buy milk{enter}')
cy.get('[data-cy=todo-item]').should('have.length', 1).and('contain.text', 'Buy milk')
```

- **Negative assertions:** `should('not.exist')` passes before the element has even appeared. Assert the positive state first (the spinner is visible), then assert that it disappears.
- **Timeouts:** raise the timeout on the one slow query (`{ timeout: 15_000 }`), not globally.

## Network: cy.intercept

```ts
beforeEach(() => {
  cy.intercept({ method: 'GET', pathname: '/api/orders' }, { fixture: 'orders.json' }).as('listOrders')
  cy.intercept('POST', '/api/orders', { statusCode: 201, body: { id: 'o-42' } }).as('createOrder')
})

it('creates an order', () => {
  cy.visit('/orders')
  cy.wait('@listOrders')
  cy.get('[data-cy=sku]').type('A-1')
  cy.get('[data-cy=submit]').click()
  cy.wait('@createOrder').its('request.body').should('deep.include', { sku: 'A-1' })
  cy.contains('[data-cy=toast]', 'Order o-42 created')
})
```

- **Order:** register an intercept before the action that sends the request, which means before `cy.visit()` for page-load calls. All intercepts reset before each test.
- **Overrides:** the most recently defined matching handler runs first. Adding `times: 1` to the route matcher makes a one-shot override, for example `cy.intercept({ method: 'GET', pathname: '/api/orders', times: 1 }, { statusCode: 500 })`, so the first call fails and the retry succeeds.
- **Waiting:** wait on aliases (`cy.wait('@createOrder')`), never `cy.wait(2000)`. The yielded interception exposes `request` and `response` for assertions.
- **Matching:** string URLs are glob-matched with minimatch, not substring-matched. A route-matcher object such as `{ method, pathname, query }` is more explicit.
- **Failure and latency:** simulate them with `{ statusCode: 500 }`, `{ forceNetworkError: true }` or `{ delay: 1500 }`. Edit real responses with `req.continue((res) => { … })`.
- **What to stub:** stub what you don't own, such as payments and third-party APIs, and keep a few unstubbed smoke specs against the real backend.
- **Native network path:** Cypress 16 intercepts Chrome and Edge traffic on the browser's native network path. As a result, `req.httpVersion` isn't reported and intercepted responses lack compression headers.

## Sessions and test isolation

- **Test isolation:** `testIsolation: true` (the default since 12) clears the page, cookies, localStorage and sessionStorage in all domains before each test. Every test visits its own page and builds its own state, so never depend on test order. Turn isolation off only for a deliberately sequential suite.
- **Cached logins:** cache logins with `cy.session()`, logging in through the API rather than the form. Keep one spec that covers the UI login.

```ts
Cypress.Commands.add('loginAs', (role: Role) => {
  cy.session(
    ['loginAs', role],
    () => {
      cy.env<{ E2E_PASSWORD: string }>(['E2E_PASSWORD']).then(({ E2E_PASSWORD }) => {
        cy.request('POST', '/api/login', { email: `${role}@example.test`, password: E2E_PASSWORD })
      })
    },
    {
      validate: () => {
        cy.request('/api/me').its('status').should('eq', 200)
      },
      cacheAcrossSpecs: true,
    },
  )
})
```

- **Session ids:** the id must include everything that changes the session (user, role, tenant) and no secrets, because it appears in the Command Log.
- **Validation:** with `validate`, an expired or revoked session is rebuilt instead of failing later. The page is blank after `cy.session()`, so call `cy.visit()` next.
- **Other origins:** since 14, Cypress no longer injects `document.domain`. Steps on another origin, such as an SSO page, must run inside `cy.origin('https://idp.example.test', () => { … })`.

## Selectors, fixtures and test data

- **Selectors:** select by attributes that exist for tests, such as `cy.get('[data-cy=submit]')`. Use `cy.contains('[data-cy=toast]', 'Saved')` when the text itself is part of the requirement. Avoid CSS classes, tag chains, `:nth-child` and generated ids.
- **Fixtures:** they live in `cypress/fixtures/`. Serve one with `{ fixture: 'orders.json' }` or load it with `cy.fixture<Order[]>('orders.json')`. Keep fixtures small and shaped like real responses.
- **Test data:** seed and reset data in `beforeEach`, through `cy.task()` (Node side, direct to the database or API) or test-only endpoints, not by clicking through the UI:

```ts
// cypress.config.ts
export default defineConfig({
  e2e: {
    baseUrl: 'http://localhost:3000',
    setupNodeEvents(on) {
      on('task', {
        async 'db:reset'() {
          await resetDatabase()
          return null // a task must return a value or null, never undefined
        },
      })
    },
  },
})
```

## Custom commands and queries with types

```ts
// cypress/support/commands.ts
type Role = 'admin' | 'member'

declare global {
  namespace Cypress {
    interface Chainable {
      loginAs(role: Role): Chainable<void>
      getByCy(id: string): Chainable<JQuery<HTMLElement>>
    }
  }
}

Cypress.Commands.add('getByCy', (id: string) => cy.get(`[data-cy="${id}"]`))
export {}
```

- **Typing setup:** `declare global` only works in a module, so add `export {}` when the file has no other import or export. `cypress/tsconfig.json` sets `"types": ["cypress", "node"]`.
- **Commands vs queries:** custom commands suit workflows such as logging in and seeding data. A helper that must retry like `cy.get` belongs in `Cypress.Commands.addQuery()`: its outer function runs once and returns a synchronous, side-effect-free inner function that Cypress calls repeatedly.
- **Restraint:** don't wrap single clicks in commands. Don't overwrite built-in queries with `Commands.overwrite`; when it's unavoidable, use `overwriteQuery`.

## Component testing

```tsx
// cypress.config.ts: component: { devServer: { framework: 'react', bundler: 'vite' } }
// cypress/support/component.ts
import { mount } from 'cypress/react'
declare global { namespace Cypress { interface Chainable { mount: typeof mount } } }
Cypress.Commands.add('mount', mount)

// src/components/Counter.cy.tsx
it('increments and reports the new value', () => {
  const onChange = cy.stub().as('onChange')
  cy.mount(<Counter initial={2} onChange={onChange} />)
  cy.get('[data-cy=increment]').click()
  cy.get('[data-cy=count]').should('have.text', '3')
  cy.get('@onChange').should('have.been.calledWith', 3)
})
```

- **Running and support:** run component tests with `cypress run --component`.
  - Mount packages: `cypress/react` (React 18, 19), `cypress/vue`, `cypress/angular` (Angular 21+, zoneless by default in 16) and `cypress/svelte` (Svelte 5).
  - Dev servers: Vite 8+ or webpack 5. Next.js needs 15.0.4+.
- **Providers and network:** wrap providers (router, query client, store, theme) in a project-level `mount` command, and stub the network with `cy.intercept()` just as in E2E tests.
- **Scope:** use component tests for behaviour that needs a real browser, and keep pure logic in Vitest or Jest.

## Flaky tests: causes and fixes

| Symptom | Likely cause | Fix |
|---|---|---|
| Passes locally, fails in CI | `cy.wait(ms)`, or a race with a request | Alias the request, `cy.wait('@alias')`, then assert on the UI |
| "detached from the DOM" | Chaining after an action that re-rendered | End chains at actions and re-query |
| Intermittent assertion failure | Assertion inside `.then()` (no retry) | `.should()` or `.should(callback)` |
| Passes alone, fails in the suite | Shared state or order dependence | Keep `testIsolation`, seed per test, use `cy.session()` |
| Fails on app errors | `uncaught:exception` from app or third-party code | Fix the app; ignore one known message in a handler, never all |
| Timer or animation races | Real clocks, CSS transitions | `cy.clock()`/`cy.tick()`; disable animations in the test build |
| Input drops characters after the upgrade | 16 types with `keystrokeDelay: 0` | Assert the field value; pass `{ delay: 10 }` to that one `.type()` if the app needs it |

- **Reproduce first:** repeat the test locally (`Cypress._.times(20, (i) => it('run ' + i, …))`) before you add retries.
- **Retries hide flakes:** with `retries: { runMode: 2, openMode: 0 }`, a test that passed only on retry is still broken. Track retried tests; Cypress Cloud flags them. Flake-detection strategies (`retries.experimentalStrategy`) are still experimental.

## CI and parallelisation (decision level)

- **One job:** `cypress-io/github-action@v7` installs Cypress, caches the binary and runs the tests. Its `start` and `wait-on` inputs boot the app, and `component: true` runs component tests.
  - Test against a production build.
  - Pass `--browser chrome`, because Electron is deprecated as a test browser in 16.
  - Upload screenshots on failure; video has been off by default since 13.
- **Across machines:** `cypress run --record --parallel --group <name> --ci-build-id <id>` balances specs across machines by duration, but it requires Cypress Cloud and a record key. Since Cypress 13, third-party orchestrators (Sorry Cypress, Currents) are blocked. Without Cloud, split specs statically per job (`--spec` lists or a split plugin) and accept the imbalance.
- **Is Cloud worth it?** It pays off for large suites that take tens of minutes serially, for Test Replay of CI-only failures, and for flake analytics and spec prioritisation. Skip it for small suites, or when data must stay in-house.

## When Playwright fits better

Playwright is the better choice when you need:

- several tabs, windows, users or browser contexts in one test, or heavy iframe and download flows;
- Safari/WebKit as a first-class target (WebKit support in Cypress is experimental);
- free built-in sharding and workers, plain async/await, or tests written in Python, Java or .NET;
- flows that cross many origins.

Cypress stays the better fit for its interactive runner and time-travel debugging, for component tests in the same tool, and when a healthy suite already exists. Migrate when these limits block real tests, not for style. Playwright guidance lives in the `e2e-testing` skill.

## Review checklist

- [ ] Commands are never awaited, and no value from a chain is read outside its callback.
- [ ] Assertions use `.should()` after queries, and there is no `cy.wait(<number>)`.
- [ ] Intercepts are defined before the action that triggers them and awaited by alias.
- [ ] Each test stands alone under `testIsolation`, and logins go through `cy.session()` with `validate`.
- [ ] Selectors use `data-cy`, fixtures are small and realistic, and data is seeded through `cy.task()` or an API.
- [ ] Custom commands are typed in `declare global`, and retrying helpers are built with `addQuery`.
- [ ] On Cypress 16, there is no `Cypress.env()`, `cy.exec()` or `.end()`, and secrets come only from `cy.env()`.
- [ ] Retries don't hide flakes, and CI runs Chrome against a production build.

<!-- Written for legacies (MIT). Checked against: https://docs.cypress.io/app/references/changelog, https://docs.cypress.io/app/references/migration-guide, https://www.cypress.io/releases/16-0-0, https://docs.cypress.io/app/core-concepts/retry-ability, https://docs.cypress.io/api/commands/intercept, https://docs.cypress.io/api/commands/session, https://docs.cypress.io/api/cypress-api/expose, https://docs.cypress.io/api/cypress-api/custom-queries, https://docs.cypress.io/api/commands/press, https://docs.cypress.io/app/tooling/typescript-support, https://docs.cypress.io/app/component-testing/react/overview, https://docs.cypress.io/app/guides/test-retries, https://github.com/cypress-io/github-action, 2026-10 -->
