<?php
/**
 * Chat UI shell — mounts the Vue application.
 *
 * Assets are loaded directly (no wp_enqueue) because this page is served
 * from the MU agent at muplugins_loaded.
 *
 * @var string $css_url
 * @var string $js_url
 * @var string $version
 * @var string $api_base
 * @var string $settings_nonce
 * @var array<string, mixed> $theme_status
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$css_href      = htmlspecialchars( (string) ( $css_url ?? '' ), ENT_QUOTES, 'UTF-8' );
$js_src        = htmlspecialchars( (string) ( $js_url ?? '' ), ENT_QUOTES, 'UTF-8' );
$asset_ver     = htmlspecialchars( (string) ( $version ?? '1.0.0' ), ENT_QUOTES, 'UTF-8' );
$config_api    = json_encode( $api_base ?? '/DialogStudio/v1', JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES );
$config_nonce  = json_encode( $settings_nonce ?? '', JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES );

$is_managed      = ! empty( $theme_status['is_managed'] );
$setup_required  = ! empty( $theme_status['setup_required'] );
$active_name     = htmlspecialchars( (string) ( $theme_status['active_name'] ?? '' ), ENT_QUOTES, 'UTF-8' );
$parent_name     = htmlspecialchars( (string) ( $theme_status['parent_name'] ?? $theme_status['active_name'] ?? '' ), ENT_QUOTES, 'UTF-8' );
$child_preview   = htmlspecialchars( (string) ( $theme_status['child_preview_slug'] ?? '' ), ENT_QUOTES, 'UTF-8' );
$workspace_path  = htmlspecialchars( (string) ( $theme_status['workspace_path'] ?? '' ), ENT_QUOTES, 'UTF-8' );

$config_theme = json_encode(
	[
		'isManaged'       => $is_managed,
		'setupRequired'   => $setup_required,
		'workspacePath'   => (string) ( $theme_status['workspace_path'] ?? '' ),
		'ready'           => ! empty( $theme_status['ready'] ),
		'activeSlug'      => (string) ( $theme_status['active_slug'] ?? '' ),
		'activeName'      => (string) ( $theme_status['active_name'] ?? '' ),
		'parentSlug'      => (string) ( $theme_status['parent_slug'] ?? '' ),
		'parentName'      => (string) ( $theme_status['parent_name'] ?? '' ),
		'childPreviewSlug' => (string) ( $theme_status['child_preview_slug'] ?? '' ),
	],
	JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
);
?>
<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta name="robots" content="noindex, nofollow">
	<title>دیالوگ — سازنده قالب</title>
	<link rel="preconnect" href="https://fonts.googleapis.com">
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
	<link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;500;600&display=swap" rel="stylesheet">
	<link rel="stylesheet" href="<?php echo $css_href; ?>?v=<?php echo $asset_ver; ?>">
	<script>
		window.__DTM_CONFIG__ = {
			apiBase: <?php echo $config_api; ?>,
			settingsNonce: <?php echo $config_nonce; ?>,
			theme: <?php echo $config_theme; ?>
		};
	</script>
	<style>
		#ds-setup-overlay {
			position: fixed; inset: 0; z-index: 99999;
			background: rgba(0,0,0,.55); backdrop-filter: blur(4px);
			display: flex; align-items: center; justify-content: center;
			font-family: Vazirmatn, system-ui, sans-serif; direction: rtl;
		}
		#ds-setup-modal {
			background: #1e1e2e; color: #cdd6f4; border-radius: 16px;
			padding: 36px 32px; max-width: 460px; width: 90%;
			box-shadow: 0 24px 64px rgba(0,0,0,.6);
			border: 1px solid rgba(255,255,255,.08);
		}
		#ds-setup-modal h2 {
			margin: 0 0 8px; font-size: 1.25rem; font-weight: 600;
			color: #89b4fa;
		}
		#ds-setup-modal p { margin: 0 0 12px; line-height: 1.7; font-size: .95rem; color: #bac2de; }
		#ds-setup-modal .ds-info-box {
			background: rgba(137,180,250,.08); border: 1px solid rgba(137,180,250,.2);
			border-radius: 10px; padding: 14px 16px; margin: 16px 0;
			font-size: .875rem; color: #89b4fa;
		}
		#ds-setup-modal .ds-info-box span { display: block; margin-bottom: 6px; }
		#ds-setup-modal .ds-info-box span:last-child { margin-bottom: 0; }
		#ds-setup-btn {
			display: inline-flex; align-items: center; gap: 8px;
			background: #89b4fa; color: #1e1e2e; border: none;
			border-radius: 10px; padding: 12px 24px; font-size: 1rem;
			font-weight: 600; cursor: pointer; transition: opacity .2s;
			font-family: inherit; margin-top: 8px; width: 100%; justify-content: center;
		}
		#ds-setup-btn:hover { opacity: .88; }
		#ds-setup-btn:disabled { opacity: .5; cursor: not-allowed; }
		#ds-setup-status {
			margin-top: 14px; font-size: .875rem; min-height: 20px;
			padding: 10px 14px; border-radius: 8px; display: none;
		}
		#ds-setup-status.ds-error { background: rgba(243,139,168,.12); color: #f38ba8; display: block; }
		#ds-setup-status.ds-success { background: rgba(166,227,161,.12); color: #a6e3a1; display: block; }
		#ds-setup-status.ds-loading { background: rgba(137,180,250,.08); color: #89b4fa; display: block; }
	</style>
</head>
<body class="dtm-body" lang="fa">

<?php if ( $setup_required ) : ?>
<div id="ds-setup-overlay">
	<div id="ds-setup-modal">
		<h2>راه‌اندازی محیط کاری</h2>
		<p>برای شروع کار با Dialog Studio، یک Child Theme ساخته و فعال می‌شود.</p>

		<div class="ds-info-box">
			<span>📦 قالب فعلی: <strong><?php echo $parent_name; ?></strong></span>
			<span>✨ Child Theme جدید: <strong><?php echo $child_preview; ?></strong></span>
			<span>🔒 قالب اصلی دست نخورده باقی می‌ماند و می‌توان آن را به‌روزرسانی کرد</span>
		</div>

		<p style="font-size:.85rem;color:#6c7086;">
			Agent فقط در child theme کار می‌کند و کدها در آنجا ذخیره می‌شوند.
		</p>

		<button id="ds-setup-btn" onclick="dsSetupChildTheme()">
			<span id="ds-setup-btn-text">ساخت و فعال‌سازی Child Theme</span>
		</button>
		<div id="ds-setup-status"></div>
	</div>
</div>

<script>
async function dsSetupChildTheme() {
	const btn    = document.getElementById('ds-setup-btn');
	const status = document.getElementById('ds-setup-status');
	const btnTxt = document.getElementById('ds-setup-btn-text');

	btn.disabled = true;
	btnTxt.textContent = 'در حال پردازش…';
	status.className   = 'ds-loading';
	status.textContent = 'در حال ساخت child theme…';

	try {
		const apiBase = (window.__DTM_CONFIG__ && window.__DTM_CONFIG__.apiBase)
			? window.__DTM_CONFIG__.apiBase
			: '/DialogStudio/v1';

		const res = await fetch(apiBase + '/theme/child-setup', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-DTM-Nonce': (window.__DTM_CONFIG__ && window.__DTM_CONFIG__.settingsNonce) || '',
			},
			credentials: 'same-origin',
			body: JSON.stringify({ confirm: true })
		});

		const json = await res.json();

		if (json && json.success) {
			status.className   = 'ds-success';
			status.textContent = json.data && json.data.already_managed
				? 'محیط کاری آماده است. در حال بارگذاری…'
				: 'Child theme با موفقیت ساخته و فعال شد. در حال بارگذاری…';

			setTimeout(() => window.location.reload(), 1200);
		} else {
			const errMsg = (json && json.error) ? json.error : 'خطای ناشناخته';
			status.className   = 'ds-error';
			status.textContent = 'خطا: ' + errMsg;
			btn.disabled       = false;
			btnTxt.textContent = 'تلاش مجدد';
		}
	} catch (err) {
		status.className   = 'ds-error';
		status.textContent = 'خطا در ارتباط با سرور: ' + err.message;
		btn.disabled       = false;
		btnTxt.textContent = 'تلاش مجدد';
	}
}
</script>
<?php endif; ?>

<div id="dtm-chat-app"></div>
<script type="module" src="<?php echo $js_src; ?>?v=<?php echo $asset_ver; ?>"></script>
</body>
</html>
