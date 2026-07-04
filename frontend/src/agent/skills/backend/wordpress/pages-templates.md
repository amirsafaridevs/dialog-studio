---
id: wp-pages-templates
category: wordpress
title: WordPress Pages & Template Files
description: Creating pages correctly as both a template file and a WordPress page record, custom page templates, and the template hierarchy. Use for "create a page", "new template", "landing page setup".
keywords: page, template, create_page, template hierarchy, page template, custom template, صفحه, قالب صفحه
---
## WordPress Pages & Template Files

**A page is TWO artifacts, both required, in this order:**
1. A template file in the child theme: either `page-{slug}.php` (auto-matches a page with that slug via the template hierarchy) or a generic file with a `Template Name:` header comment for reuse across multiple pages:
   ```php
   <?php
   /* Template Name: Landing Page */
   ```
2. The actual WordPress page record (title, slug, status, and — if using a named template — the `_wp_page_template` meta set to the template file). Creating only the file with no page record means nothing is reachable at a URL; creating only the page record with no matching template falls back to `page.php`/`index.php` and won't show the intended layout.

**Don't recreate what exists:** look up whether a page with the intended slug/title already exists before creating a new one — editing an existing page means updating only the fields that change, not wholesale recreation.

**Template hierarchy (fallback order WordPress uses to pick a template) for a page request:** `page-{slug}.php` → `page-{id}.php` → template assigned via `Template Name` (if selected on the page) → `page.php` → `index.php`. For custom post types the equivalent single/archive fallback chain applies (see the CPT skill).

**Registering hooks a new page's template needs:** if the template enqueues its own CSS/JS, do it conditionally (`is_page( 'slug' )` or checking the loaded template) inside the normal `wp_enqueue_scripts` hook — never enqueue page-specific assets globally on every page.

**Reusable sections:** for structure shared across multiple page templates (a repeating hero, a CTA block), extract to a `template-parts/` file and `get_template_part()` it from each page template rather than duplicating markup — keeps future edits to one place.

**Anti-patterns:** creating a page template file without ever creating the WP page record, recreating a page that already exists instead of updating it, hardcoding page-specific CSS/JS into a global enqueue instead of conditionally loading it, duplicating markup across page templates instead of extracting a template part.
