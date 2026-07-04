---
id: wp-debugging-errors
category: wordpress
title: WordPress Debugging & Error Diagnosis
description: Systematic approach to diagnosing fatal errors, white screens, and unexpected behavior using WP_DEBUG and the debug log. Use for "it's broken", "white screen", "error", "not working" requests.
keywords: debug, error, white screen, fatal error, wp_debug, debug.log, troubleshoot, خطا, دیباگ, سفید شدن صفحه
---
## WordPress Debugging & Error Diagnosis

**Diagnose from evidence, never from guessing.** The debug log tells you the exact file and line — read it before hypothesizing.

**Standard sequence for any "it's broken" report:**
1. Enable debug mode with logging on, display off in production-like contexts (`WP_DEBUG=true`, `WP_DEBUG_LOG=true`, `WP_DEBUG_DISPLAY=false` — display=true only in a pure dev/local check where showing errors on-page is safe).
2. Clear the existing debug log so only fresh errors from reproducing the issue appear.
3. Reproduce: navigate/reload the exact page or trigger the exact action that fails.
4. Read the debug log for the precise error, file, and line number — a PHP Fatal error names the exact failing function/file; don't scan broadly when the log already told you where.
5. Fix the root cause at that location — not a workaround elsewhere.
6. Re-clear the log, reproduce again, confirm the log is now clean.
7. Turn debug mode back OFF when done (never leave `WP_DEBUG_DISPLAY` on — it leaks file paths/stack traces to visitors).

**Common fatal error classes and what they mean:**
- `Call to undefined function` — a function from a plugin/parent that isn't active, or a typo; check the function actually exists (`function_exists`) before calling if it's conditionally available.
- `Cannot redeclare function` — a pluggable function was declared twice (e.g. copied into the child AND still present via an include) — remove the duplicate.
- `Trying to access array offset on value of type null` / `null given` — a value expected to be an array/object is null; usually a query returned nothing and the code didn't check before use.
- Syntax errors — always run the code validator after any PHP edit; catch these before they ever reach the live debug log.

**White screen with NO log entry:** usually a fatal error suppressed by hosting-level display settings, or a resource limit (memory/timeout) — check the server error log (not just WP's debug.log) if WP's own log is empty but the page is still blank.

**Layout/rendering bugs (not fatal errors):** these are NOT debug-log issues — inspect the actual rendered DOM/computed styles in the live preview instead of assuming from source code; diagnose from what really rendered, never from what the code "should" do.

**Anti-patterns:** guessing at a fix without reading the log, leaving `WP_DEBUG_DISPLAY` on after debugging, fixing a symptom far from the log's named file/line instead of the actual cause, skipping the "clear log then reproduce" step (leads to reading stale unrelated errors).
