---
paths:
  - "**/*.css"
  - "**/*.scss"
  - "**/*.html"
  - "**/*.tsx"
  - "**/*.jsx"
---
<!-- Adapted from ECC (MIT, Copyright (c) 2026 Affaan Mustafa): rules/web/coding-style.md, rules/web/design-quality.md, rules/web/performance.md, rules/web/security.md, rules/web/testing.md, rules/react/security.md -->
# Web UI

## Markup and accessibility
- Semantic elements over `div` stacks (`header`, `nav`, `main`, `section`, `footer`); `<button type="button">` for actions, `<a href>` for navigation. Label landmarks (`nav aria-label`, `section aria-labelledby`).
- Everything works from the keyboard and has designed hover, `:focus-visible`, active and disabled states. Inputs have labels; images have `alt` (empty when decorative); text meets WCAG AA contrast; motion respects `prefers-reduced-motion`.

## Styling and motion
- Use design tokens (CSS custom properties or the Tailwind theme) for color, type scale, spacing, radius and timing; don't repeat raw hex or px values.
- Animate only `transform` and `opacity` (`clip-path` and `filter` sparingly), never layout properties such as `width`, `height`, `top`, `left`, `margin`, `padding` or `font-size`. Scope `will-change` narrowly and remove it afterwards; prefer CSS transitions for simple motion and IntersectionObserver over scroll handlers.

## Performance
- Targets: LCP under 2.5 s, INP under 200 ms, CLS under 0.1.
- Images: explicit `width` and `height` (or `next/image`), lazy below the fold, high fetch priority only for the LCP image, AVIF or WebP, never shipped far larger than rendered.
- Fonts: at most two families, `font-display: swap` (`next/font` does this), subset, preload only the critical weight.
- Reserve space for late-loading content so it doesn't shift the layout.

## Security
- Production CSP allows scripts by nonce or hash; `script-src` never gets `'unsafe-inline'` or `'unsafe-eval'`. Tailor origins instead of pasting a template. Also send HSTS, `X-Content-Type-Options: nosniff`, `frame-ancestors 'none'` (or `X-Frame-Options: DENY`), `Referrer-Policy: strict-origin-when-cross-origin` and a restrictive `Permissions-Policy`.
- Never put untrusted HTML into `innerHTML`. Third-party scripts load `async` or `defer`, with SRI when served from a CDN.

## Checking UI work
- Check narrow (320-375 px) and desktop widths for overflow, both themes if the app has them, and keyboard navigation. Visual-heavy components are better covered by screenshot comparison than by markup assertions.
