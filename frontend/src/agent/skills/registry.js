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

const PHP_SKILL = `## WordPress / PHP — how a pro writes it
Placement (decide FIRST): hooks, enqueues, filters → functions.php; any self-contained feature → its own inc/{feature}.php (auto-loaded mini-plugin). One file = one responsibility. Never grow functions.php into a dumping ground.
Pattern for a feature module (inc/*.php):
  if ( ! defined('ABSPATH') ) exit;
  add_action('init', 'dtm_feature_init');           // hook, don't run at top level
  function dtm_feature_init() { /* ... */ }          // prefixed, function_exists-safe
Output is hostile until escaped: esc_html() for text, esc_attr() for attributes, esc_url() for links, wp_kses_post() for rich HTML. Input is hostile until sanitized: sanitize_text_field(), absint(), wp_unslash() before sanitizing $_POST. NEVER echo a raw variable.
Data: WP_Query / get_posts with explicit args; always wp_reset_postdata() after a custom loop. Never write raw SQL when a core API exists. Never query inside a render loop — fetch once, loop over results.
Anti-patterns that get rejected: editing parent-theme or plugin files (override instead), inline <script>/<style> in templates (enqueue instead), unprefixed global functions, querying the DB on every request without a transient, trusting $_GET/$_POST/$_REQUEST unsanitized.`;

const CSS_DESIGN_SKILL = `## Design & CSS — how a pro implements it
Start from intent: name what the page must make the visitor DO, then make that one action the most prominent thing on the screen (size, contrast, whitespace). Proximity groups related items; distance separates unrelated ones.
Typography: exactly one display, one heading, one body, one label size; max two typefaces; decisive jumps (e.g. 16 / 20 / 32 / 56), never timid 2px steps.
Color has jobs: background recedes, body text is legible (contrast ≥ 4.5:1), ONE primary owns the main action, accents are rare. Delete any color that is only "nice".
Architecture: every repeated value → a :root custom property (--space-4, --color-primary). Single-class selectors, flat specificity, no deep descendant chains, NEVER !important to win a specificity fight (fix the selector instead). Reuse existing classes/tokens before inventing new ones — read the current CSS first.
Mobile-first ALWAYS: write the 375px layout, then layer @media (min-width:768px) and (min-width:1200px). Tap targets ≥ 44px, body ≥ 16px.
States: every interactive element needs :hover AND :focus-visible. Motion must justify "this helps the user by ___" or it's cut; default to stillness; respect prefers-reduced-motion.
Avoid the default-AI look (dark + neon; off-white + serif + terracotta; dense editorial grid) unless asked — derive the direction from the site's real subject and audience.`;

const TEMPLATE_SKILL = `## Dialog template system — the rules that make a template actually load
Dialog templates are DB-registered PHP files under wp-content/dialog/templates/. A file written there with write_file will NEVER load — the registration is what wires it in.
Workflow, every time:
  1. create_template (new) or update_template (existing, by id/slug, only the fields you change) or delete_template.
type = where it loads: header | footer | singular | archive | canvas | front_page | search | 404 | woocommerce | section.
conditions MUST use the rules wrapper:
  {"rules":[{"page":"front_page"},{"page":"singular","post_type":"page"},{"page":"singular","post_type":"product"},{"page":"archive","post_type":"post"},{"page":"archive","taxonomy":"category"},{"page":"woocommerce","endpoint":"cart"},{"page":"search"},{"page":"404"}]}
canvas/page types: includes_header / includes_footer toggle the site chrome (assets still load regardless). Lower priority number wins when several templates match — use it deliberately to override a broad template with a narrow one.
Inside the template body use core tags (get_header where appropriate, the loop, wp_nav_menu, dynamic_sidebar) — not hardcoded markup you could get from WordPress.`;

const WOOCOMMERCE_SKILL = `## WooCommerce — extend, never fork
First confirm WooCommerce is active (list_plugins) if the request depends on it.
Build shop UI as Dialog templates of type "woocommerce" with endpoint conditions (shop, cart, checkout, account) or product/archive conditions (see the template skill's rules wrapper).
Customize via hooks, not markup rewrites: woocommerce_before_main_content / woocommerce_after_main_content, woocommerce_before_shop_loop_item / woocommerce_after_shop_loop_item_title, woocommerce_single_product_summary (priority controls order), woocommerce_checkout_fields (filter). remove_action to drop a default block, add_action to insert yours.
Template overrides go in the CHILD theme under woocommerce/ (e.g. woocommerce/single-product/price.php), copied from wp-content/plugins/woocommerce/templates/ for reference. NEVER edit the plugin's own files.
Use WooCommerce APIs (wc_get_product, WC()->cart, wc_price()) rather than touching its tables.`;

const DEBUGGING_SKILL = `## Debugging — diagnose from evidence, fix the root
Fatal error / white screen: toggle_debug(debug:true, debug_log:true) → reproduce → read_debug_log for the exact file:line → fix that → clear_debug_log when resolved. Don't guess at causes the log can name.
Wrong render / layout: preview_reload, then preview_get_html with a selector to inspect the REAL DOM and computed result — diagnose from what actually rendered, never from what you assume the code does.
After every edit, read the returned code_validation block before continuing; a failed syntax check means fix-before-proceed.
Relationship bugs ("why does X run / not run", "what overrides this") → graph_query(mode:"explain") on the symbol/file before reading broadly.
Change the SMALLEST thing that fixes the root cause; then re-verify in the preview. Resist shotgun edits.`;

const PAGE_SKILL = `## Creating pages — file + record, in that order
A page is two artifacts: a template file in the child theme AND a WordPress page record.
  1. write_file the page template (page-{slug}.php, or a custom template with the "Template Name:" header for reuse).
  2. create_page with title/slug/status and the template filename so WordPress creates the actual post.
Register any hooks the page needs in functions.php (or inc/*.php). Editing an existing page → update_page by id or slug, sending ONLY the fields you change. Don't recreate a page that already exists — look it up first.`;

const ARCHITECTURE_SKILL = `## Parent/child theme architecture
Your Project knowledge graph shows two themes: the CHILD (your writable workspace) built on a READ-ONLY parent. The golden rule: never edit the parent — change its behaviour from the child.
How to override correctly:
  - A template file (header.php, footer.php, page-x.php, woocommerce/*) → copy the parent's path into the SAME relative path in the child; WordPress loads the child's copy. The graph's "overrides" list already names which ones the child replaced.
  - A function the parent declares with function_exists() / pluggable → redeclare it in the child (loads first, wins).
  - Otherwise → don't copy; HOOK. add_action/add_filter/remove_action against what the parent registered. Use graph_query(mode:"explain") on the parent symbol to see where it's wired before you touch it.
Assets: enqueue the child's stylesheet with the parent stylesheet as a dependency (wp_enqueue_style with get_template_directory_uri() for parent, get_stylesheet_directory_uri() for child). Don't duplicate parent CSS — override only the rules you change.
Before reimplementing anything, check the graph: if the parent already provides it, override/extend rather than rebuild.`;

const PERFORMANCE_SKILL = `## Performance discipline
- Enqueue assets with a real version string and correct dependencies; load front-end JS in the footer (wp_enqueue_script last arg true) unless it must run in head. Don't enqueue admin assets on the front end or vice versa — gate with the right hook (wp_enqueue_scripts vs admin_enqueue_scripts).
- Never run a DB query inside a render loop. Fetch once (WP_Query/get_posts with explicit fields and posts_per_page — never -1 on unbounded data), then iterate. Always wp_reset_postdata() after.
- Cache expensive or remote work with transients: get_transient → compute on miss → set_transient with a sane TTL; invalidate on the relevant save_post/updated_option hook.
- Prefer specific core lookups (get_post_meta, get_option) over broad scans. Avoid loading whole post objects when you only need IDs ('fields' => 'ids').
- Don't enqueue libraries WordPress already bundles (jQuery) — declare them as dependencies instead of shipping a copy.`;

const ACCESSIBILITY_SKILL = `## Accessibility (ships with every UI change)
- Semantic HTML first: header/nav/main/footer/article/button. A clickable thing is a <button> or <a>, never a <div> with a click handler.
- Every <img> gets meaningful alt (empty alt="" only for purely decorative images). Icons that convey meaning get an aria-label.
- One <h1> per page; heading levels never skip. Form fields have associated <label>s (for/id).
- Keyboard: everything interactive is reachable and operable by keyboard; visible :focus-visible state on all of them (don't remove outlines without replacing them).
- Color contrast ≥ 4.5:1 for body text, ≥ 3:1 for large text and UI borders. Never signal state by color alone — pair it with text or an icon.
- Respect prefers-reduced-motion for any animation.`;

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
      || ['create_template', 'update_template', 'delete_template'].includes(lastTool),
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
  {
    id: 'theme-architecture',
    body: ARCHITECTURE_SKILL,
    when: ({ userText, lastTool }) =>
      /override|اورراید|بازنویسی|parent|قالب اصلی|قالب والد|child|قالب فرزند|inherit|ارث|extend|توسعه|hook|فیلتر|filter|reuse/i.test(userText)
      || ['graph_query', 'code_graph'].includes(lastTool),
  },
  {
    id: 'performance',
    body: PERFORMANCE_SKILL,
    when: ({ userText }) =>
      /performance|پرفورمنس|کارایی|سرعت|speed|slow|کند|بهینه|optimi|cache|کش|transient|query|کوئری|enqueue|بارگذاری|load time/i.test(userText),
  },
  {
    id: 'accessibility',
    body: ACCESSIBILITY_SKILL,
    when: ({ editTarget, userText }) =>
      /\.(php|html|vue|js)$/i.test(editTarget)
      || /accessib|a11y|دسترس‌پذیر|دسترسی‌پذیر|aria|screen reader|صفحه‌خوان|کنتراست|contrast|keyboard|کیبورد|semantic|سمانتیک/i.test(userText),
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
