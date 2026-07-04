---
name: uiux-pro-max
category: uiux
title: UI/UX Pro Max — data-driven design system generator
description: Professional design intelligence backed by curated datasets (67 UI styles, 160+ palettes, 57 font pairings, landing patterns, UX rules, chart types). Use for ANY substantial front-end design work — building or redesigning pages, sections, landing pages, choosing a style/palette/fonts, dashboards — especially when the request names an industry or product type (shop, spa, SaaS, portfolio, restaurant, …).
keywords: design system, palette, پالت, فونت, typography, landing, hero, ui style, redesign, بازطراحی, طراحی صفحه, لندینگ, داشبورد, فروشگاه
---
## UI/UX Pro Max

Data-driven design: NEVER invent styles, palettes, or font pairings from memory. This skill bundles curated datasets — query them with `search_skill_data` (skill_id `uiux-pro-max`) and build the design system from the top hits.
(Data © nextlevelbuilder/ui-ux-pro-max-skill, MIT — see LICENSE.txt.)

### Workflow

**Step 1 — Analyze the request.** Extract: product type (e-commerce, SaaS, restaurant, portfolio, …), target audience, style keywords, pages/sections involved. If a DESIGN PREFERENCES block exists in your context, its style and colors are FIXED constraints — the datasets then tell you how to execute them well.

**Step 2 — Check for an existing design system.** `read_file` on `wp-content/themes/{active-child-theme}/design-system/MASTER.md`. If it exists, follow it (plus any `design-system/pages/{page}.md` override for the page you're working on) and skip to Step 4. Never contradict an existing MASTER.md without the user asking for a redesign.

**Step 3 — Generate the design system from data.** Run these searches (parallel-friendly), using keywords from Step 1:

| dataset | query with | gives you |
|---|---|---|
| `products` | product type + industry keywords | recommended style, landing pattern, palette focus |
| `styles` | style name from products/prefs | concrete rules: colors, effects, do/don't, implementation checklist, CSS variables |
| `colors` | product type | full semantic palette (primary/secondary/accent/bg/fg/border/destructive + on-* pairs) |
| `typography` | mood + industry (e.g. "elegant luxury spa") | heading+body Google-Fonts pairing, CSS import |
| `landing` | page type + goal (e.g. "hero features cta") | section order, CTA placement, conversion notes |
| `ui-reasoning` | product type | decision rules + anti-patterns for the category |
| `ux-guidelines` | the component you're building (nav, form, modal…) | do/don't with code examples |
| `motion` | interaction (hover, scroll, reveal) + intensity | duration/easing values (adapt GSAP snippets to plain CSS/JS) |
| `charts` | data shape (trend, comparison, share) | chart type + accessibility guidance (dashboards only) |
| `icons` | concept (menu, cart, search) | icon names — WordPress themes: recreate as inline SVG, NEVER emoji |
| `stacks/html-tailwind` | the CSS feature in question | plain-HTML/CSS best practices (closest stack to classic WP themes) |

Then synthesize ONE coherent design system: style + full palette + font pairing + spacing scale + effects. Where DESIGN PREFERENCES set a primary/accent color, keep those exact hex values and rebuild the rest of the palette around them (backgrounds, borders, on-colors) using the closest `colors` row as the template.

**Step 3b — Persist it.** For any multi-section or multi-page work, `write_file` the result to `wp-content/themes/{active-child-theme}/design-system/MASTER.md`: palette as CSS custom properties, font pairing + import, spacing scale, corner radius, shadow/effect rules, per-component notes. Page-specific deviations go to `design-system/pages/{page-slug}.md`. This is what keeps every later page consistent.

**Step 4 — Implement.** Define the palette as CSS custom properties in the theme stylesheet and use tokens everywhere (no hardcoded hex outside the token block). Load fonts via the `CSS Import` value from `typography`. Follow the style row's `Implementation Checklist` and `Do Not Use For` columns.

### Pre-delivery checklist (verify before declaring done)

- Contrast: body text ≥ 4.5:1, secondary text ≥ 3:1 against its background.
- Icons: consistent inline SVG set — no emojis, no mixed icon families.
- Touch targets ≥ 44×44px with ≥ 8px spacing; visible hover/focus states.
- Typography: base 16px, line-height ~1.5 body, clear heading hierarchy.
- Responsive: mobile-first, no horizontal scroll at 360px, test hero/nav/footer.
- Motion: 150–300ms, easing from `motion` rows, respect `prefers-reduced-motion`.
- Forms: visible labels, error message next to the field, helper text.
- Every color on the page comes from the design-system tokens.
