---
id: wp-forms-validation
category: wordpress
title: WordPress Forms & Validation
description: Building custom front-end forms (contact, newsletter, custom submissions) with server-side validation, spam protection, and email delivery. Use for contact forms, custom submission forms, newsletter signup.
keywords: form, validation, contact form, wp_mail, honeypot, spam, نموذج, فرم تماس, اعتبارسنجی فرم
---
## WordPress Forms & Validation

**Server-side validation is mandatory even with client-side checks** — client-side (HTML5 `required`, JS) is UX only; a request can always bypass it, so every field must be re-validated in the PHP handler before use.

**Handling pattern (paired with the REST API or admin-ajax skill for the endpoint itself):**
1. Verify nonce + (if relevant) capability first — reject immediately if either fails.
2. Sanitize every input with the matching function (`sanitize_text_field`, `sanitize_email`, `sanitize_textarea_field`) — never trust `$_POST` type/shape.
3. Validate business rules AFTER sanitizing: required fields non-empty, `is_email()` for email fields, length/format constraints — collect ALL validation errors (not just the first) and return them together so the user isn't stuck fixing one field at a time.
4. Only after validation passes, act (send mail / save to DB / call an API).

**Spam protection (layer these, none alone is sufficient):**
- Honeypot: a hidden field (visually hidden via CSS, not `type="hidden"` which some bots skip) that must stay empty — reject silently if filled.
- Time-trap: reject submissions faster than a human could plausibly fill the form (store a timestamp in a hidden field or session, compare server-side).
- Nonce already blocks most naive automated posting since it requires loading the actual page first.
- For high-value forms, consider real CAPTCHA (e.g. Cloudflare Turnstile) — but don't add it by default, it costs conversion; only when spam is a confirmed problem.

**Sending mail:**
```php
$sent = wp_mail(
    get_option( 'admin_email' ),
    sprintf( __( 'New submission from %s', 'textdomain' ), sanitize_text_field( $name ) ),
    esc_html( $message ),
    [ 'Content-Type: text/plain; charset=UTF-8', 'Reply-To: ' . sanitize_email( $email ) ]
);
```
`wp_mail()` returns `true`/`false` — always check it and surface a real error to the user on failure rather than a false "message sent" confirmation. Never put unsanitized user input directly into mail headers (header injection risk) — this is why `Reply-To` above is sanitized.

**Anti-patterns:** trusting client-side validation alone, generic `type="hidden"` honeypots (many bots skip hidden inputs but not visually-hidden ones), unsanitized values in mail headers, showing "message sent" without checking `wp_mail()`'s return value, stopping validation at the first error instead of collecting all of them.
