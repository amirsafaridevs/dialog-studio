---
id: wp-child-theme-overrides
category: wordpress
title: Child Theme Overrides & Parent Theme Architecture
description: How to correctly override parent theme templates, functions, and styles from a child theme without ever editing the parent. Use whenever a change needs to affect something the parent theme provides.
keywords: child theme, parent theme, override, template hierarchy, pluggable function, inherit, قالب فرزند, قالب والد, بازنویسی
---
## Child Theme Overrides & Parent Theme Architecture

**The golden rule:** the parent theme is READ-ONLY. Every change happens in the child theme; the parent is only ever read for reference or overridden.

**Three ways to override, pick the right one:**

1. **Template file override** — for any file the WordPress template hierarchy loads by path/name (`header.php`, `footer.php`, `page.php`, `single.php`, `woocommerce/*`, template-parts): copy the parent's file to the SAME relative path in the child theme. WordPress automatically prefers the child's copy. Only copy the ONE file that needs to change, not whole directories.

2. **Pluggable function redeclare** — if the parent wraps a function in `if ( ! function_exists( 'parent_function' ) )`, simply declaring `function parent_function() { ... }` in the child's `functions.php` (loaded before the parent's) wins. Check the parent actually uses this pattern before relying on it — grep/read the parent source first, don't assume.

3. **Hook instead of copy (preferred when possible)** — if the parent registers behavior via `add_action`/`add_filter`, don't copy a whole template just to change one part: hook a later/earlier priority callback, or `remove_action`/`remove_filter` the parent's exact callback (same name + priority) and `add_action` your own. This is more maintainable than a full template copy because it survives parent theme updates better for unrelated changes.

**Assets:** enqueue the child stylesheet with the parent's as an explicit dependency —
```php
wp_enqueue_style( 'parent-style', get_template_directory_uri() . '/style.css' );
wp_enqueue_style( 'child-style', get_stylesheet_directory_uri() . '/style.css', [ 'parent-style' ] );
```
Never duplicate the parent's CSS wholesale in the child — override only the specific rules that change, so parent updates still flow through for everything else.

**Before touching anything:** check whether the child theme has ALREADY overridden the file/function in question (avoid creating a second conflicting override) and check whether the parent already provides the desired behavior via a hook/filter before reimplementing it from scratch.

**Anti-patterns:** editing any file under the parent theme's directory directly, copying an entire template directory when only one file changed, duplicating the parent's full stylesheet instead of a scoped override, guessing that a function is pluggable without confirming.
