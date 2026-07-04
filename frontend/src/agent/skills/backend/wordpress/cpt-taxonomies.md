---
id: wp-cpt-taxonomies
category: wordpress
title: Custom Post Types & Taxonomies
description: Registering custom post types, custom taxonomies, and their templates (archive/single). Use for "add a new content type", portfolio/testimonials/team/events post types, custom categories.
keywords: custom post type, cpt, taxonomy, register_post_type, register_taxonomy, archive, single template, نوع پست, تکسونومی
---
## Custom Post Types & Taxonomies

**Registration location:** `inc/post-types.php` (or similarly named module), hooked on `init`, never inline in `functions.php` if it grows past a few lines.

```php
add_action( 'init', 'dtm_register_portfolio_cpt' );
function dtm_register_portfolio_cpt() {
    register_post_type( 'portfolio', [
        'labels'       => [ 'name' => __( 'Portfolio', 'textdomain' ), 'singular_name' => __( 'Project', 'textdomain' ) ],
        'public'       => true,
        'has_archive'  => true,
        'show_in_rest' => true,               // required for block editor / Gutenberg
        'menu_icon'    => 'dashicons-portfolio',
        'supports'     => [ 'title', 'editor', 'thumbnail', 'excerpt' ],
        'rewrite'      => [ 'slug' => 'portfolio' ],
    ] );
}
```

**Custom taxonomy:**
```php
add_action( 'init', 'dtm_register_project_type_tax' );
function dtm_register_project_type_tax() {
    register_taxonomy( 'project_type', [ 'portfolio' ], [
        'labels'       => [ 'name' => __( 'Project Types', 'textdomain' ) ],
        'hierarchical' => true,               // true = category-like, false = tag-like
        'show_in_rest' => true,
        'rewrite'      => [ 'slug' => 'project-type' ],
    ] );
}
```

**Templates the child theme must provide for a new CPT:** `archive-{post_type}.php` (falls back to `archive.php` → `index.php`), `single-{post_type}.php` (falls back to `single.php` → `index.php`), `taxonomy-{taxonomy}.php` for the taxonomy archive. Always check the theme hierarchy fallback exists before assuming a template is missing.

**Rules:**
- ALWAYS flush rewrite rules is NOT something to call manually on every load (never call `flush_rewrite_rules()` inside `init` — it's expensive; WordPress handles it on activation/plugin changes, or visit Settings → Permalinks once after registering).
- `show_in_rest: true` is required for the post type/taxonomy to work with the block editor and REST API — default it on unless there's a specific reason not to.
- Use `WP_Query` with `post_type => 'portfolio'` to list entries; never assume `have_posts()` alone scopes to the CPT.
