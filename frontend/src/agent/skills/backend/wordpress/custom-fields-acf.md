---
id: wp-custom-fields-acf
category: wordpress
title: Custom Fields & Meta Boxes (ACF and native)
description: Adding custom fields to posts/pages/options via ACF (if active) or native meta boxes, and safely reading/writing postmeta. Use for "add a field", "let the admin customize X per page", options pages.
keywords: custom fields, acf, advanced custom fields, meta box, postmeta, options page, فیلد سفارشی, متا باکس
---
## Custom Fields & Meta Boxes

**Check which system is available first:** `function_exists( 'get_field' )` / `class_exists( 'ACF' )` indicates Advanced Custom Fields is active — prefer it if so (the site owner likely manages fields visually through it). Otherwise fall back to native meta boxes.

**If ACF is active:**
- Fields are normally defined via the ACF admin UI (Custom Fields → Field Groups) or a local JSON/PHP field group registration (`acf_add_local_field_group`) if the theme manages fields in code for portability.
- Read values with `get_field( 'field_name', $post_id )` (never raw `get_post_meta` for ACF fields — ACF applies its own formatting/type handling).
- For an ACF Options Page (site-wide settings, not tied to a post): `acf_add_options_page()` then `get_field( 'field_name', 'option' )`.
- Always null-check: `get_field()` returns `false`/`null` when empty — template code must handle the empty case, never assume a field has a value.

**Native meta box (no ACF, or a genuinely simple single field):**
```php
add_action( 'add_meta_box', 'dtm_add_subtitle_box' ); // register on 'add_meta_boxes' hook, not 'add_meta_box'
add_action( 'add_meta_boxes', function () {
    add_meta_box( 'dtm_subtitle', __( 'Subtitle', 'textdomain' ), 'dtm_render_subtitle_box', 'post' );
} );
function dtm_render_subtitle_box( $post ) {
    wp_nonce_field( 'dtm_save_subtitle', 'dtm_subtitle_nonce' );
    $value = get_post_meta( $post->ID, '_dtm_subtitle', true );
    echo '<input type="text" name="dtm_subtitle" value="' . esc_attr( $value ) . '" class="widefat">';
}
add_action( 'save_post', function ( $post_id ) {
    if ( ! isset( $_POST['dtm_subtitle_nonce'] ) || ! wp_verify_nonce( wp_unslash( $_POST['dtm_subtitle_nonce'] ), 'dtm_save_subtitle' ) ) return;
    if ( ! current_user_can( 'edit_post', $post_id ) ) return;
    if ( isset( $_POST['dtm_subtitle'] ) ) {
        update_post_meta( $post_id, '_dtm_subtitle', sanitize_text_field( wp_unslash( $_POST['dtm_subtitle'] ) ) );
    }
} );
```
Prefix meta keys with an underscore (`_dtm_subtitle`) to hide them from the default Custom Fields UI when they're managed by your own box, and always nonce + capability check on save.

**Anti-patterns:** reading an ACF field with raw `get_post_meta` (loses ACF's formatting/relationship resolution), saving postmeta on `save_post` without a nonce+capability check (CSRF risk), assuming a custom field always has a value in the template.
