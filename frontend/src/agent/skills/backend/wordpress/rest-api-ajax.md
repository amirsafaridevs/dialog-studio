---
id: wp-rest-api-ajax
category: wordpress
title: WordPress REST API & AJAX Endpoints
description: Registering custom REST routes and admin-ajax handlers, permission callbacks, front-end JS integration. Use for dynamic/interactive features that need server round-trips (live search, forms, load-more, filters).
keywords: rest api, ajax, admin-ajax, wp_ajax, register_rest_route, endpoint, permission_callback, درخواست, ای‌جکس
---
## WordPress REST API & AJAX Endpoints

**Prefer the REST API for new work** — it's the modern, testable, cacheable approach; reach for admin-ajax only to match an existing pattern already used elsewhere in the codebase.

**REST API route:**
```php
add_action( 'rest_api_init', function () {
    register_rest_route( 'dtm/v1', '/subscribe', [
        'methods'             => 'POST',
        'callback'            => 'dtm_handle_subscribe',
        'permission_callback' => '__return_true', // or a real capability/nonce check — see below
        'args'                => [
            'email' => [ 'required' => true, 'sanitize_callback' => 'sanitize_email' ],
        ],
    ] );
} );
function dtm_handle_subscribe( WP_REST_Request $request ) {
    $email = $request->get_param( 'email' );
    // ... do the work ...
    return new WP_REST_Response( [ 'success' => true ], 200 );
}
```
`permission_callback` is MANDATORY — never omit it (WordPress will emit a doing_it_wrong notice and default to blocking). For public endpoints it's legitimately `__return_true`; for anything sensitive, check `current_user_can()` and/or verify a nonce passed via the `X-WP-Nonce` header (`wp_rest` action, localized to the front end via `wp_create_nonce( 'wp_rest' )`).

**Front-end fetch call:**
```js
fetch( `${wpApiSettings.root}dtm/v1/subscribe`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': wpApiSettings.nonce },
  body: JSON.stringify( { email } ),
} );
```
Localize `root`/`nonce` via `wp_localize_script`, never hardcode the site URL in JS.

**admin-ajax fallback** (only when matching an existing pattern):
```php
add_action( 'wp_ajax_dtm_action', 'dtm_handle_action' );          // logged-in users
add_action( 'wp_ajax_nopriv_dtm_action', 'dtm_handle_action' );   // logged-out users, only if truly public
function dtm_handle_action() {
    check_ajax_referer( 'dtm_action_nonce', 'nonce' );
    // ... do the work ...
    wp_send_json_success( $data );  // or wp_send_json_error( $message )
}
```

**Anti-patterns:** missing `permission_callback`, trusting `$request->get_param()` without a `sanitize_callback`, forgetting `wp_ajax_nopriv_*` when logged-out users legitimately need access (or adding it when they shouldn't), hardcoding the AJAX/REST URL in JS instead of localizing it.
