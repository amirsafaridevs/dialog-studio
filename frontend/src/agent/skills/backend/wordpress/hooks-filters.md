---
id: wp-hooks-filters
category: wordpress
title: WordPress Hooks & Filters
description: Actions vs filters, hook priority/timing, common core hooks, and how to extend behavior without editing core/parent files. Use for "hook into", "when X happens do Y", enqueue timing, modifying core/theme output.
keywords: hooks, actions, filters, add_action, add_filter, do_action, apply_filters, priority, هوک, فیلتر, اکشن
---
## WordPress Hooks & Filters

**Core distinction:** actions (`add_action`/`do_action`) run code at a point in time and return nothing; filters (`add_filter`/`apply_filters`) transform a value and MUST return it. Never use a filter callback that doesn't return the (possibly modified) first argument — that silently breaks whatever was being filtered.

**Priority & argument count:**
```php
add_action( 'hook_name', 'callback', $priority = 10, $accepted_args = 1 );
```
Lower priority runs earlier (1 runs before 10). Only raise `$accepted_args` above 1 if you actually use the extra parameters — WordPress won't pass them otherwise.

**Timing — pick the right hook:**
- `plugins_loaded` — plugins are loaded, theme not yet.
- `after_setup_theme` — theme supports, textdomain, nav menus, image sizes.
- `init` — register post types/taxonomies/shortcodes; most general-purpose hook.
- `wp_enqueue_scripts` — front-end CSS/JS (never enqueue front-end assets on `init`).
- `admin_enqueue_scripts` — admin-only CSS/JS, always check `$hook` param to scope to specific admin pages.
- `wp_head` / `wp_footer` — last-resort output injection; prefer enqueue over inline `<script>`/`<style>` here.
- `template_redirect` — right before template selection, good for conditional redirects.

**Removing/overriding a parent's or plugin's hook:** you MUST match the exact callback reference, priority, and (for closures/methods) the same object instance/order the original used — `remove_action('hook', 'exact_original_callback_name', same_priority)`. If the parent used an anonymous closure, you generally can't remove it; override via a later-priority hook on the same point instead, or override the template file if it's template-driven.

**Anti-patterns:** running expensive logic directly inside a filter that fires on every page load without caching; forgetting to return the value from a filter callback; hooking enqueue calls directly instead of via `wp_enqueue_scripts`; overusing `wp_footer` for things that belong in a proper enqueued file.
