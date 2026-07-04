---
id: uiux-mobile-first-app
category: uiux
title: Mobile-first / App-like web design style
description: Native-app-like patterns for mobile web — bottom nav, thumb-reachable actions, card stacks, gesture-friendly spacing. Use when the request emphasizes mobile experience, PWA feel, or "make it feel like an app".
keywords: mobile-first, app-like, pwa, bottom nav, thumb zone, touch, mobile ux, موبایل, اپلیکیشن مانند
---
## Mobile-first / App-like design style

**Feel it should produce:** the site should feel like a native app on a phone — fast to navigate one-handed, not a shrunk desktop page.

**Core rules:**
- Design the 375px layout FIRST, always, regardless of what other style skills are also active — this skill's rules layer on top of (not instead of) the chosen visual style.
- Primary navigation: fixed bottom tab bar (not a hamburger-only top menu) for the 3–5 most important destinations, with the active tab clearly highlighted; hamburger/drawer reserved for secondary/overflow items only.
- Thumb zone discipline: primary actions (submit, add-to-cart, next) live in the bottom third of the screen, reachable by thumb without regrip — never place the only CTA at the very top of a tall scrolling page.
- Touch targets ≥ 44×44px with real spacing between them (no adjacent tappable elements closer than 8px) to prevent mis-taps.
- Content patterns: horizontal-scroll card carousels for browsable collections (instead of dense grids), pull-to-refresh-style affordance where relevant, sticky contextual headers that shrink on scroll.
- Forms: one field focus per screen-width step where possible, native input types (tel, email, number) to trigger the right mobile keyboard, large tappable labels (label wraps the input).
- Motion: use transitions that mimic native navigation (slide-in for "forward", slide-out for "back") rather than generic fades, but keep them fast (200–300ms) and respect prefers-reduced-motion.
- Safe-area awareness: account for notches/home-indicator padding (env(safe-area-inset-*)) on fixed bottom bars.

**Anti-patterns to avoid:** shrinking a desktop layout instead of redesigning for touch, top-only navigation with no bottom bar for an app-like brief, tiny tap targets packed tightly, hover-dependent interactions with no touch equivalent, ignoring safe-area insets on fixed elements.
