---
id: wp-woocommerce-backend
category: wordpress
title: WooCommerce Backend Customization
description: Extending WooCommerce via hooks and template overrides — product/cart/checkout customization, custom fields, pricing logic. Use for any WooCommerce backend/logic work (pairs with the e-commerce UI skill for visual work).
keywords: woocommerce, backend, hooks, product, cart, checkout, order, custom field, ووکامرس, بک‌اند
---
## WooCommerce Backend Customization

**First confirm WooCommerce is active** (`list_plugins` or check for the `woocommerce` plugin) before writing any WooCommerce-dependent code — guard with `if ( class_exists( 'WooCommerce' ) )` or `if ( function_exists( 'WC' ) )` so the theme doesn't fatal-error if it's ever deactivated.

**Customize via hooks, never by rewriting core markup:**
- `woocommerce_before_main_content` / `woocommerce_after_main_content` — wrap the shop content area.
- `woocommerce_before_shop_loop_item` / `woocommerce_after_shop_loop_item_title` — product card structure.
- `woocommerce_single_product_summary` — the PDP right-column stack (priority controls exact order: price=10, excerpt=20, add-to-cart=30, meta=40, sharing=50 — insert at the priority matching where you want your addition).
- `woocommerce_checkout_fields` — filter to add/remove/reorder checkout fields.
- `remove_action( 'hook', 'default_callback', priority )` to drop a default WooCommerce element (must match the exact original callback+priority — check WooCommerce core source or docs, don't guess), then `add_action` your replacement.

**Template overrides:** copy the specific file from `wp-content/plugins/woocommerce/templates/` into the CHILD theme under `woocommerce/` at the same relative path (e.g. `woocommerce/single-product/price.php`). Never edit the plugin's own template files directly — a WooCommerce update would silently overwrite them.

**Use WooCommerce's own APIs, never touch its tables directly:**
- `wc_get_product( $id )` for product data, not raw postmeta queries.
- `WC()->cart` for cart operations (add/remove/get totals).
- `wc_price( $amount )` to format currency consistently with store settings.
- `$product->get_price()`, `->get_stock_quantity()`, etc. — the CRUD object API, not `get_post_meta()` with guessed meta keys.

**Custom product fields:** hook `woocommerce_product_options_general_product_data` (admin field UI) + `woocommerce_process_product_meta` (save) for simple products, or a custom product data tab via `woocommerce_product_data_tabs` for a larger group of fields.

**Anti-patterns:** querying `wp_postmeta` directly for price/stock instead of the CRUD API, editing plugin template files in place, removing a default hook without matching its exact priority, assuming WooCommerce is active without checking.
