---
id: uiux-dashboard-admin
category: uiux
title: Dashboard / Admin UI design style
description: Data-dense dashboard and admin-panel layout conventions — sidebar nav, data tables, stat cards, charts. Use for admin areas, internal tools, analytics/reporting screens, member dashboards.
keywords: dashboard, admin, panel, data table, analytics, backend ui, داشبورد, پنل مدیریت, جدول داده
---
## Dashboard / Admin UI design style

**Feel it should produce:** control and clarity under information density — the user should scan, find, and act quickly, not admire the visuals.

**Core rules:**
- Layout skeleton: fixed left sidebar (nav, collapsible on mobile/tablet) + top bar (search, user menu, notifications) + main content area with consistent page padding.
- Stat/KPI cards at the top of a dashboard page: big number, short label, small trend indicator (↑/↓ with color, e.g. green/red used ONLY for these directional indicators, not decoratively elsewhere) — 3–4 per row max on desktop.
- Data tables: sticky header row, zebra-striping OR hover-row-highlight (not both), right-align numeric columns, left-align text, clear sort indicators on sortable columns, row actions in a consistent trailing column (icon buttons or a kebab menu), pagination or virtual scroll for long lists — never render thousands of rows unpaginated.
- Charts: one clear color per data series, legend always visible, gridlines subtle/muted (never competing with the data line), tooltips on hover show exact values — favor simple bar/line charts over decorative 3D or overly stylized ones.
- Color use is functional, not decorative: neutral grays for structure, ONE brand accent for primary actions/active nav state, semantic colors (green=success/positive, red=error/negative, amber=warning) reserved strictly for those meanings.
- Empty/loading/error states are first-class: every table/chart needs a designed empty state ("No results — try adjusting filters") and a loading skeleton, not a blank flash.
- Density: tighter spacing than a marketing page is correct here (8px-based scale, compact row heights) — but keep tap targets ≥ 40px on touch-capable admin views.

**Anti-patterns to avoid:** marketing-page whitespace applied to data-dense screens (wastes scan efficiency), decorative gradients/shadows on data cards, using red/green outside their semantic meaning, unpaginated tables, charts with more than ~5–6 competing series.
