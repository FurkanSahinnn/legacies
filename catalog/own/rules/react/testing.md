---
paths:
  - "**/*.test.ts"
  - "**/*.test.tsx"
  - "**/*.spec.ts"
  - "**/*.spec.tsx"
  - "**/__tests__/**"
---
<!-- Adapted from ECC (MIT, Copyright (c) 2026 Affaan Mustafa): rules/react/testing.md, rules/typescript/testing.md -->
# React and TypeScript tests

- Testing Library queries by role (`getByRole('button', { name: /save/i })`), then label, then text; `getByTestId` is the last resort. `queryBy*` asserts absence, `findBy*` waits for elements, `waitFor` waits for side effects.
- Interact through `const user = userEvent.setup()` and `await user.click(...)`, not `fireEvent`.
- Mock HTTP with MSW (reset handlers after each test) rather than stubbing `fetch`, React hooks or child components. Render through one shared `renderWithProviders` helper.
- Test custom hooks with `renderHook`, wrapping state changes in `act`; treat `act()` warnings as bugs.
- Add an axe check (`vitest-axe` or `jest-axe`) to component tests. Real layout, scrolling, drag-and-drop and visual regression belong in Playwright.
- One component test runner per repo. E2E for critical user flows: Playwright. Details: `react-testing` and `e2e-testing` skills.
