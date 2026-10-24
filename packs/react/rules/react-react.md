---
paths:
  - "**/*.tsx"
  - "**/*.jsx"
  - "**/hooks/**/*.ts"
---
<!-- Adapted from ECC (MIT, Copyright (c) 2026 Affaan Mustafa): rules/react/coding-style.md, rules/react/hooks.md, rules/react/patterns.md, rules/react/security.md, rules/web/patterns.md, skills/coding-standards/SKILL.md -->
# React

In depth: `react-patterns` and `react-performance` skills.

## Components
- Function components only. Error boundaries come from Next.js `error.tsx`, `react-error-boundary`, or the one the repo already has.
- Props: a named `type Props` (an `interface` only when it is extended), destructured in the signature, callback props typed; no `React.FC`.
- Naming: component and file in PascalCase (`UserCard.tsx`); hooks `useX`; `handleX` handlers passed as `onX` props; context as `XContext`, `XProvider` and `useX`.
- JSX: `cond && <X />` only when `cond` is a boolean (a `0` renders); a ternary for either/or, never nested; early returns for guards; move multi-line expressions to a named const above the `return`.
- List keys are stable ids from the data, never the index when items can reorder, insert or delete (child state lands on the wrong row).

## Server and client components
- Server Component by default. Add `'use client'` (line 1, above imports) only for state, effects, refs, browser APIs or event handlers, on the smallest leaf possible.
- A client file cannot import a Server Component; pass it in as `children` or a slot prop. Props crossing into client components must be serializable.
- Fetch in Server Components (`await` directly) or with TanStack Query or SWR on the client; no `fetch` in `useEffect` (races, no cache, no retry).
- Every Suspense boundary has an error boundary above it, placed near the data (a segment's `error.tsx` wraps its `loading.tsx`).
- Forms: `<form action={serverAction}>` with uncontrolled inputs read from `FormData` when there is a submit step; controlled inputs only when the value drives other UI live; React Hook Form for multi-step, dynamic or cross-field forms.

## Hooks
- Call hooks unconditionally at the top level, never in loops, conditions or after an early return. Keep `react-hooks/rules-of-hooks` as an error and `exhaustive-deps` on; silence it only with a comment saying why.
- `useEffect` only syncs with external systems. Derive values during render, reset state on prop change with a `key`, and notify parents from the event handler.
- Effects that subscribe, set timers, add listeners or fetch return a cleanup (`AbortController`, `clearInterval`, `removeEventListener`); without one, changing deps race and unmounts leak.
- When next state depends on the previous one, use the updater form (`setCount(c => c + 1)`); it also avoids stale closures. Never store state you can derive; switch to `useReducer` for 3+ related values or transitions that depend on the previous state.
- Touch `ref.current` only in effects and handlers, never during render. Subscribe to external stores with `useSyncExternalStore`.
- Don't memoize by default: `useMemo`, `useCallback` and `memo` only for props of a memoized child, hook dependencies, or a measured cost.
- Extract a custom hook for logic shared by 2+ components or with a nameable purpose, not for a single caller or a renamed `useState`.
- React 19: `ref` is a regular prop (no `forwardRef`); prefer `use`, `useActionState`, `useOptimistic`, `useFormStatus` and `useTransition` to hand-rolled versions.

## State
- Local `useState` first; lift to the nearest common parent when shared; context only for low-frequency values such as theme, auth and locale (every consumer re-renders on change); a store (Zustand, Jotai) for high-frequency shared state. Server data stays in RSC, TanStack Query or SWR, never copied into a client store.
- Shareable view state (filters, sort, page, tab, search) lives in URL search params.

## Security
- `dangerouslySetInnerHTML` only with input sanitized at that call site (DOMPurify with an allowlist config); otherwise render text or use a sanitizing markdown renderer.
- User-supplied `href` and `src` values pass a scheme allowlist (`http:`, `https:`, `mailto:`), so `javascript:` and `data:` URLs never render.
- `target="_blank"` always gets `rel="noopener noreferrer"`.
- Sessions live in httpOnly, Secure cookies, never in `localStorage`, where any XSS can read them.
- Parse untrusted JSON with a schema before spreading it into state or objects (prototype pollution).
