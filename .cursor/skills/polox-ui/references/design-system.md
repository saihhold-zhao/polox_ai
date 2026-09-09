# Polox UI design system

## Visual thesis

Polox is a focused AI creation console, not a marketing dashboard. The persistent sidebar organizes tools; the central canvas gives one creation task visual priority. The interface should feel quiet until the user reaches a primary action.

## Tokens

Use the CSS variables in `app/assets/css/tailwind.css` as the source of truth.

| Role | Dark value | Usage |
|---|---:|---|
| Canvas | `#090909` | Main page background |
| Sidebar | `#171717` | Persistent navigation |
| Panel | `#171717` | Generator and cards |
| Raised field | `#202020` | Prompt field and selected controls |
| Hover | `#272727` | Hover and selected navigation |
| Border | `#2b2b2b` | Hairline dividers and panel outlines |
| Primary text | `#f5f5f5` | Headings and important labels |
| Secondary text | `#a3a3a3` | Descriptions and inactive controls |
| Accent | `#65a30d` | Primary actions, focus, brand mark |

## Layout

- Desktop sidebar: 256px. Use the existing sidebar primitives and responsive off-canvas behavior.
- Header: 54px, one bottom border, no heavy shadow.
- Main content: cap task content near 1120px, keep at least 24px desktop gutters and 16px mobile gutters.
- Hero: centered, 40–52px display size, two short lines, about 1.05 line height, description no wider than 720px.
- Workspace: visually wider than the hero copy; separate prompt surface from the lower settings toolbar.

## Components

- Buttons: 32–36px high for utility actions; acid-lime primary, tonal dark secondary, bordered dark outline.
- Segmented controls: 32px container, 28px options, subtle active surface, never a large pill.
- Inputs: dark raised surface, quiet placeholder, lime focus ring. Avoid bright white input backgrounds.
- Cards/panels: 16px radius, 1px border, no floating shadow. Use nested tonal surfaces for hierarchy.
- Navigation: 32px rows, active row `#272727`, 8px radius, icon and label aligned on a 16px rhythm.
- Status chips: compact and semantic. Keep the lime `New` badge only for genuinely new features.

## Motion and states

- Use 150–200ms color/opacity transitions.
- Do not animate layout for decoration. Respect `prefers-reduced-motion`.
- Hover changes one tonal step. Active controls remain obvious without glow.
- Disabled actions retain the accent hue at reduced opacity so action location stays legible.

## Responsive behavior

- Below tablet width, collapse navigation into the existing sheet.
- Scale the hero down before reducing page gutters.
- Stack workspace controls; keep the primary action full-width when it prevents crowding.
- Never allow toolbar controls or uploaded-image previews to force horizontal page scrolling.

## Canonical implementation points

- Theme tokens: `app/assets/css/tailwind.css`
- Shell: `app/layouts/default.vue`
- Header and navigation: `app/components/layout/`
- Hero: `app/pages/index.vue`
- Creation workspace: `app/components/ai-generator/AiGeneratorForm.vue`
- Segmented controls: `app/components/ai-generator/AiGeneratorCategoryTabs.vue` and `AiGeneratorTaskTabs.vue`

## Visual review checklist

- Does the main action win without making the rest of the interface green?
- Are nested surfaces separated by tone and a single hairline, not shadows?
- Are all radii from the 8/12/16px system?
- Is muted copy readable without competing with the heading?
- Do focus, hover, active, disabled, empty, and loading states remain distinct?
- Does the page remain usable at 375px and at a typical 1440px desktop viewport?
