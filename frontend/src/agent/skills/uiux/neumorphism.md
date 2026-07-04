---
id: uiux-neumorphism
category: uiux
title: Neumorphism (soft UI) design style
description: Soft extruded/embossed UI where elements appear molded from the same-color background using dual shadows — for settings panels, calculators, music players, niche product UIs wanting a tactile soft look.
keywords: neumorphism, soft ui, embossed, extruded, tactile, نئومورفیسم, برجسته
---
## Neumorphism (soft UI) design style

**Feel it should produce:** soft, tactile, "physical" — as if buttons and panels are molded from the same material as the background.

**Core rules:**
- Monochromatic base is mandatory: background and elements share nearly the SAME base color (e.g. #e0e5ec) — depth comes only from shadow, never from a different fill color.
- Dual-shadow recipe for a raised element: a light shadow top-left (e.g. `-6px -6px 12px rgba(255,255,255,0.7)`) + a dark shadow bottom-right (e.g. `6px 6px 12px rgba(163,177,198,0.6)`) on the SAME background color.
- Pressed/inset state: invert to `inset` shadows on both sides to read as "pushed in" (use for active/selected states, toggles, input fields).
- Corners: consistently rounded (16–24px) — sharp corners break the "molded" illusion.
- Use sparingly on ONE contained UI area (a settings panel, a card, a player) — an entire page of neumorphism has notoriously poor accessibility (low contrast, unclear affordances) so keep primary text/CTAs on normal high-contrast surfaces.
- Contrast discipline: because base and element colors are so close, text and icons need a separate higher-contrast color — never rely on the soft shadow alone to convey what's clickable. Always pair with a clear :focus-visible outline for keyboard users.

**Anti-patterns to avoid:** applying to an entire content-heavy page (accessibility risk — low contrast, ambiguous affordances), mixing with sharp corners or flat design elsewhere, using colorful accents that break the monochrome illusion, skipping focus states (already-subtle affordances become invisible for keyboard/screen-reader users without them).
