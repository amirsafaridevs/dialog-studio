---
id: wp-security-sanitization
category: wordpress
title: WordPress Security & Data Sanitization
description: Escaping output, sanitizing input, nonces, capability checks, SQL safety. Use for any code touching $_GET/$_POST/$_REQUEST, forms, AJAX handlers, or database queries.
keywords: security, sanitize, escape, nonce, esc_html, esc_attr, wpdb prepare, capability, امنیت, اعتبارسنجی
---
## WordPress Security & Data Sanitization

**The rule that overrides all others:** output is hostile until escaped, input is hostile until sanitized. Every variable printed into HTML/attributes/URLs and every value read from `$_GET`/`$_POST`/`$_REQUEST`/`$_COOKIE` must pass through the right function — no exceptions for "trusted" admin-only data.

**Escaping on output (as late as possible, right at the point of echo):**
- `esc_html()` — plain text content.
- `esc_attr()` — HTML attribute values.
- `esc_url()` — URLs (href/src).
- `esc_js()` — inline JS string values (prefer `wp_localize_script`/`wp_add_inline_script` over inline `<script>` entirely).
- `wp_kses_post()` — rich HTML that should allow the same tags as post content.
- `wp_kses( $string, $allowed_html )` — custom allow-list for anything narrower.

**Sanitizing on input (as early as possible):**
- `sanitize_text_field()` — single-line text.
- `sanitize_textarea_field()` — multi-line text.
- `sanitize_email()`, `esc_url_raw()` (for storing, not printing), `absint()` / `intval()` for numbers.
- Always `wp_unslash()` `$_POST`/`$_GET` values BEFORE sanitizing (WP adds slashes to superglobals).

**Forms & AJAX — nonces are mandatory:**
```php
wp_nonce_field( 'dtm_save_settings', 'dtm_settings_nonce' );
// on handling:
if ( ! isset( $_POST['dtm_settings_nonce'] ) || ! wp_verify_nonce( wp_unslash( $_POST['dtm_settings_nonce'] ), 'dtm_save_settings' ) ) {
    wp_die( 'Security check failed' );
}
```
For AJAX: `check_ajax_referer( 'action_name', 'nonce_field' )`. Always pair with a capability check (`current_user_can( 'manage_options' )` etc.) — a valid nonce proves the request came from your form, NOT that the user is allowed to perform the action.

**Database:** never concatenate variables into raw SQL. Use `WP_Query`/`get_posts`/`get_option` etc. when possible; if raw SQL via `$wpdb` is unavoidable, ALWAYS use `$wpdb->prepare()`:
```php
$wpdb->get_results( $wpdb->prepare( "SELECT * FROM {$wpdb->prefix}table WHERE id = %d", $id ) );
```

**Anti-patterns that get rejected outright:** `echo $_GET['x']` unescaped, building SQL with string concatenation, trusting a nonce without a capability check, storing unsanitized `$_POST` values directly to `update_option`/postmeta.
