---
name: polox-ui
description: Implement and review Polox.ai UI in this Nuxt 4 application. Use for any page, component, layout, theme, Tailwind class, responsive behavior, interaction, or visual QA change so new work preserves the dark creative-workspace design language.
---

# Polox UI

Build UI as a restrained, professional creative tool: cinematic black canvas, compact controls, crisp hairline borders, and one acid-lime action accent.

## Workflow

1. Read `references/design-system.md` before changing UI.
2. Inspect the nearest existing component and reuse the project's shadcn-vue primitives, Nuxt conventions, icons, tokens, and composables.
3. Preserve behavior, data flow, authentication, and accessibility unless the request explicitly changes them.
4. Implement desktop and mobile states together. Keep controls keyboard accessible and retain visible focus indicators.
5. Run `pnpm typecheck` and the relevant lint/build check after edits.
6. Start the app and visually inspect the changed route at desktop and mobile widths. Check hierarchy, spacing, contrast, overflow, disabled states, and console errors.

## Non-negotiables

- Use semantic theme tokens from `app/assets/css/tailwind.css`; do not scatter near-duplicate hex values through Vue files.
- Default to the dark product surface. Use acid lime only for primary actions, focus, selection, and small brand moments.
- Prefer 1px borders and tonal separation over drop shadows. Avoid gradients, glassmorphism, neon glows, and decorative blobs.
- Keep radii controlled: 8px controls, 12px fields, 16px major panels. Do not make every surface pill-shaped.
- Keep typography neutral and precise: Geist, tight display tracking, medium UI labels, muted supporting copy.
- Keep the page task-first: one hero, one primary workspace, minimal surrounding chrome.
- Extend existing components rather than creating parallel primitives.

## Handoff

Summarize changed files and verification. Call out any visual assumption that could not be verified in a browser.
