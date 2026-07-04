---
id: wp-query-database
category: wordpress
title: WP_Query & Database Access Patterns
description: Correct WP_Query argument usage, meta/tax queries, pagination, and when raw $wpdb is actually justified. Use for any custom listing, filtering, or querying of posts/data beyond the default loop.
keywords: wp_query, wpdb, meta_query, tax_query, pagination, get_posts, custom query, پرس‌وجو, کوئری
---
## WP_Query & Database Access Patterns

**Default to `WP_Query`/`get_posts` — reach for `$wpdb` only when there is genuinely no core API for the data shape needed** (e.g. a custom table you created yourself).

**Standard custom loop:**
```php
$query = new WP_Query( [
    'post_type'      => 'portfolio',
    'posts_per_page' => 12,
    'paged'          => get_query_var( 'paged' ) ?: 1,
    'no_found_rows'  => false,        // set true ONLY if you don't need pagination (skips COUNT query)
    'orderby'        => 'date',
    'order'          => 'DESC',
] );
if ( $query->have_posts() ) {
    while ( $query->have_posts() ) { $query->the_post(); /* ... */ }
    wp_reset_postdata();              // MANDATORY after a custom loop that used the_post()
}
```

**Filtering by custom field (meta_query):**
```php
'meta_query' => [
    [ 'key' => 'featured', 'value' => '1', 'compare' => '=' ],
],
```
Meta queries on unindexed keys don't scale well — for a field you filter by often at real volume, a taxonomy is usually faster than `meta_query`.

**Filtering by taxonomy:**
```php
'tax_query' => [
    [ 'taxonomy' => 'project_type', 'field' => 'slug', 'terms' => [ 'branding' ] ],
],
```

**Pagination on a custom loop:** use `paged` from `get_query_var('paged')` (main query) or a distinct query var for a secondary query on the same page, and render with `paginate_links()` or `the_posts_pagination()` — never hand-roll page-number math against `$wpdb` offsets when `WP_Query` already handles it.

**When raw `$wpdb` is justified:** custom tables you created (not core WP tables), and bulk operations where the ORM-like overhead of `WP_Query` genuinely matters. Always `$wpdb->prepare()` any interpolated value — see the security skill. Never write raw SQL against `wp_posts`/`wp_postmeta` when `WP_Query`/`get_post_meta` already expresses the same query safely and portably (works across DB prefix changes, caching, etc.).

**Performance defaults:** explicit `posts_per_page` (never `-1` on data that can grow unbounded), `'fields' => 'ids'` when only IDs are needed, `'no_found_rows' => true` when pagination isn't used, `'update_post_meta_cache' => false` / `'update_post_term_cache' => false` when you know you won't need meta/terms for the result set.

**Anti-patterns:** raw SQL against core WP tables when a core function exists, `posts_per_page => -1`, missing `wp_reset_postdata()`, meta_query on a field that would work better as a taxonomy, hand-building pagination math instead of using core pagination functions.
