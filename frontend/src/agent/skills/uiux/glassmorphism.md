---
id: uiux-glassmorphism
category: uiux
title: Glassmorphism design style
description: Frosted-glass translucent panels over colorful/gradient backgrounds — for apps, dashboards, modern product landing pages wanting a premium "glass" depth effect.
keywords: glassmorphism, glass, frosted, blur, translucent, backdrop-filter, شیشه‌ای, بلور, شفاف
---
## Glassmorphism design style

**Feel it should produce:** light, airy, premium depth without heaviness — panels feel like frosted glass floating over a colorful backdrop.

**Core rules:**
- Requires a colorful or gradient background BEHIND the glass panels to work — glassmorphism on a plain white/gray background looks broken. Use a soft gradient mesh or blurred color blobs behind content.
- Glass panel recipe: semi-transparent background (rgba(255,255,255,0.10–0.20) on dark, or rgba(255,255,255,0.5–0.7) on light), `backdrop-filter: blur(12–20px)`, a thin 1px border in rgba(255,255,255,0.2–0.3), subtle rounded corners (12–20px), soft outer shadow for lift.
- Always provide a fallback: browsers without backdrop-filter support should still show a legible semi-opaque panel — never rely on blur alone for text contrast.
- Text on glass panels needs sufficient own contrast (don't assume the blur guarantees readability) — test against the busiest part of the background it could sit over.
- Use glass panels for cards, nav bars, and modals — not for full-page backgrounds or body text blocks (too much blur reduces readability at scale).
- Pair with vibrant accent colors and soft gradients elsewhere on the page — glassmorphism looks best embedded in an already colorful design system.

**Anti-patterns to avoid:** glass panels on a flat single-color background (no depth to reveal), overusing blur so nothing is crisp, low-contrast text directly on blurred glass, stacking multiple glass layers (murky, unreadable).
