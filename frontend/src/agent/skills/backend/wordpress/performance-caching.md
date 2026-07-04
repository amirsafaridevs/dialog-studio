---
id: wp-performance-caching
category: wordpress
title: WordPress Performance & Caching
description: Transients, query optimization, asset loading strategy, avoiding N+1 queries. Use for "site is slow", "improve performance", "optimize", "cache this".
keywords: performance, cache, transient, query optimization, speed, enqueue, N+1, کارایی, کش, بهینه‌سازی, سرعت
---
## WordPress Performance & Caching

**Transients — cache expensive/remote work:**
```php
function dtm_get_expensive_data() {
    $cached = get_transient( 'dtm_expensive_data' );
    if ( false !== $cached ) {
        return $cached;
    }
    $data = /* expensive computation or remote API call */;
    set_transient( 'dtm_expensive_data', $data, HOUR_IN_SECONDS );
    return $data;
}
```
Invalidate explicitly on the relevant event (`save_post`, `updated_option`, etc.) with `delete_transient()` rather than relying only on expiry — stale-but-not-yet-expired data is a common bug source.

**Query discipline:**
- Never query inside a loop (classic N+1): fetch once with `WP_Query`/`get_posts` using explicit `posts_per_page` (never `-1` on unbounded data) and `'fields' => 'ids'` when you only need IDs.
- Always `wp_reset_postdata()` after a custom `WP_Query` loop that used `the_post()`.
- Prefer targeted lookups (`get_post_meta( $id, 'key', true )`, `get_option`) over broad scans; add `'no_found_rows' => true` to `WP_Query` args when pagination isn't needed (skips a COUNT query).
- Meta queries on unindexed meta keys are slow at scale — for frequently-filtered custom fields, consider a dedicated taxonomy instead of postmeta.

**Asset loading:**
- Enqueue with a real version string (filemtime or plugin version, not a hardcoded stale string) so browsers bust cache correctly on deploy.
- Load front-end JS in the footer (`wp_enqueue_script( ..., true )` last arg) unless it must run before paint.
- Gate assets to the pages that need them — never enqueue admin assets on the front end or vice versa; use `is_page()`/`is_singular()` checks or a dedicated hook rather than loading everything everywhere.
- Don't re-bundle libraries WordPress already ships (jQuery, etc.) — declare them as script dependencies instead.

**Anti-patterns:** `posts_per_page => -1` on a growing dataset, DB queries inside `the_loop`, uncached remote API calls on every page load, enqueueing every theme's CSS/JS on every page regardless of need, forgetting `wp_reset_postdata()`.
