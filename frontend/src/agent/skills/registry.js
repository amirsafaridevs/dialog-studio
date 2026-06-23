/**
 * Skill registry — just-in-time expertise.
 *
 * Instead of one giant always-on system prompt, each skill is a small focused
 * block of domain knowledge with a `when()` trigger. selectSkills() picks the
 * skills relevant to THIS turn (based on the user's words, the file being
 * edited, the last tool used, and whether an error just happened) and the agent
 * loop injects only those bodies. Result: a lean, fast prompt that still carries
 * deep expertise exactly when it matters.
 *
 * Bodies are kept tight on purpose — they sharpen behaviour, they are not
 * textbooks. Add or tune skills here; nothing else needs to change.
 */

const PHP_SKILL = `## WordPress / PHP discipline
- Hooks, enqueues, and filters belong in functions.php. Standalone modules go in inc/*.php (auto-loaded like mini-plugins) — prefer small, single-purpose files.
- Enqueue assets with wp_enqueue_style / wp_enqueue_script (with version + dependencies); never hardcode <link>/<script> tags into templates.
- Escape on output: esc_html(), esc_attr(), esc_url(), wp_kses_post(). Sanitize on input: sanitize_text_field(), absint(), etc. Never echo raw user or DB data.
- Prefix all global functions to avoid collisions (e.g. dtm_render_hero()). Wrap function declarations in function_exists() guards when in doubt.
- Use core APIs (WP_Query, get_posts, get_template_part, wp_nav_menu) instead of raw SQL or manual file includes.`;

const CSS_DESIGN_SKILL = `## Design & CSS implementation
Decide what the page must make the visitor do/feel, then design for that. One element per section wins the eye — give it size, contrast, and space. Things that belong together sit close; unrelated things get distance.
- Type: one display size, one heading size, one body size, one label size. Max two typefaces. Make the jumps decisive.
- Color has jobs: background recedes, text is legible, ONE primary marks the action, accents are rare. Cut colors that only "look nice".
- Motion must finish "this helps the user by ___" or it goes. Default to stillness.
- Mobile-first: write the small-screen layout first, layer up with @media (min-width: 768px) / (1200px). Tap targets ≥ 44px, body ≥ 16px, usable down to 375px.
- Put any repeated value in a CSS custom property (:root). Keep specificity flat — single-class selectors, no deep nesting, never !important to win specificity.
- Every interactive element gets hover AND focus states.
- Avoid default-AI looks (dark + neon accent; warm off-white + serif + terracotta; dense editorial grid) unless the user asked for them — derive the direction from the site's actual subject and audience.`;

const TEMPLATE_SKILL = `## Dialog template system
Dialog templates are NOT plain theme files — they are PHP files under wp-content/dialog/templates/ that are ALSO registered in the database with display rules.
- Create/change/remove them ONLY with create_template / update_template / delete_template. Never write_file into templates/ — that file would never load.
- Call list_templates first to find the target (id, slug, type, conditions) before update_template or delete_template.
- conditions MUST use the rules wrapper: {"rules":[{"page":"front_page"},{"page":"singular","post_type":"page"},{"page":"archive","post_type":"post"},{"page":"woocommerce","endpoint":"cart"},{"page":"search"},{"page":"404"}]}.
- type selects where it loads: header, footer, singular, archive, canvas, front_page, search, 404, woocommerce, section.
- For canvas/page types, includes_header / includes_footer toggle the site chrome (assets always load). Lower priority number wins when several templates match.`;

const WOOCOMMERCE_SKILL = `## WooCommerce
- Build shop UI with templates of type "woocommerce" and endpoint conditions (shop, cart, checkout, account) or product/archive conditions — see the template skill for the rules wrapper.
- Hook into WooCommerce actions (woocommerce_before_main_content, woocommerce_after_shop_loop_item, etc.) rather than rewriting core markup.
- Read wp-content/plugins/woocommerce/templates/ for reference, but NEVER edit plugin files — override behaviour from the child theme.
- Confirm WooCommerce is active (list_plugins) if the user's request depends on it.`;

const DEBUGGING_SKILL = `## Debugging
- Fatal error / white screen: toggle_debug(debug:true, debug_log:true), reproduce, then read_debug_log to get the exact file + line, fix it, and clear_debug_log when done.
- Wrong rendering or layout: preview_reload, then preview_get_html (with a selector) to inspect the real DOM — diagnose from what actually renders, not assumptions.
- Always read the code_validation block returned by your last edit before assuming the change worked.
- Change the smallest thing that fixes the root cause; re-verify in the preview.`;

const PAGE_SKILL = `## Creating pages
A new page = two steps: (1) write the page template file in the child theme (page-{slug}.php) with write_file, (2) call create_page with title/slug/status and the template filename so WordPress creates the actual page. Register any needed hooks in functions.php. Use update_page to change an existing page; identify it by id or slug and send only the fields you are changing.`;

/**
 * Skill definitions. `when` receives { userText, editTarget, lastTool, hadError }.
 */
export const SKILLS = [
  {
    id: 'wordpress-php',
    body: PHP_SKILL,
    when: ({ editTarget, userText }) =>
      /\.php$/i.test(editTarget) || /\bphp\b|hook|فیلتر|functions\.php|enqueue|شورت\s?کد|shortcode/i.test(userText),
  },
  {
    id: 'css-design',
    body: CSS_DESIGN_SKILL,
    when: ({ editTarget, userText }) =>
      /\.(css|scss)$/i.test(editTarget)
      || /طراحی|دیزاین|design|رنگ|color|فاصله|spacing|چیدمان|layout|فونت|font|تایپوگرافی|hero|زیبا|ظاهر|استایل|style|responsive|موبایل|واکنش/i.test(userText),
  },
  {
    id: 'template-system',
    body: TEMPLATE_SKILL,
    when: ({ editTarget, lastTool, userText }) =>
      /templates\//i.test(editTarget)
      || /template|قالب|هدر|header|فوتر|footer|archive|آرشیو|single|canvas/i.test(userText)
      || ['create_template', 'update_template', 'delete_template', 'list_templates'].includes(lastTool),
  },
  {
    id: 'woocommerce',
    body: WOOCOMMERCE_SKILL,
    when: ({ userText }) =>
      /woocommerce|ووکامرس|shop|فروشگاه|محصول|product|cart|سبد\s?خرید|checkout|پرداخت|تسویه/i.test(userText),
  },
  {
    id: 'debugging',
    body: DEBUGGING_SKILL,
    when: ({ userText, hadError }) =>
      Boolean(hadError)
      || /خطا|ارور|error|سفید|white\s?screen|کار نمی\s?کنه|کار نمیکند|broken|باگ|bug|fix|درست کن|fatal|debug|دیباگ/i.test(userText),
  },
  {
    id: 'page-creation',
    body: PAGE_SKILL,
    when: ({ userText, lastTool }) =>
      /\b(page|برگه|صفحه)\b/i.test(userText) && /(بساز|ایجاد|اضافه|new|create|add)/i.test(userText)
      || ['create_page', 'update_page'].includes(lastTool),
  },
];

/**
 * Return the skill bodies relevant to the current turn.
 * @param {{ userText?: string, editTarget?: string, lastTool?: string, hadError?: boolean }} context
 * @returns {Array<{ id: string, body: string }>}
 */
export function selectSkills(context = {}) {
  const ctx = {
    userText: context.userText || '',
    editTarget: context.editTarget || '',
    lastTool: context.lastTool || '',
    hadError: Boolean(context.hadError),
  };

  return SKILLS.filter((skill) => {
    try {
      return skill.when(ctx);
    } catch {
      return false;
    }
  }).map((skill) => ({ id: skill.id, body: skill.body }));
}

export default selectSkills;
