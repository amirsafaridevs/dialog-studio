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
 * @var array{ready: bool, installed: bool, active: bool, required_slug: string, active_theme: array{name: string, slug: string}} $theme_status
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$css_href   = htmlspecialchars( (string) ( $css_url ?? '' ), ENT_QUOTES, 'UTF-8' );
$js_src     = htmlspecialchars( (string) ( $js_url ?? '' ), ENT_QUOTES, 'UTF-8' );
$asset_ver  = htmlspecialchars( (string) ( $version ?? '1.0.0' ), ENT_QUOTES, 'UTF-8' );
$config_api = json_encode( $api_base ?? '/DialogStudio/v1', JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES );
$config_nonce = json_encode( $settings_nonce ?? '', JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES );

$theme_ready = ! empty( $theme_status['ready'] );
$theme_message = '';
if ( ! $theme_ready ) {
	if ( empty( $theme_status['installed'] ) ) {
		$theme_message = 'قالب dialog نصب نیست. لطفاً قالب dialog را نصب و فعال کنید.';
	} else {
		$active_name = (string) ( $theme_status['active_theme']['name'] ?? 'نامشخص' );
		$theme_message = sprintf(
			'قالب فعال "%s" است. برای استفاده از Dialog Theme Maker باید قالب dialog فعال باشد.',
			$active_name
		);
	}
}

$config_theme = json_encode(
	[
		'requiredSlug' => (string) ( $theme_status['required_slug'] ?? 'dialog' ),
		'ready'        => $theme_ready,
		'installed'    => ! empty( $theme_status['installed'] ),
		'active'       => ! empty( $theme_status['active'] ),
		'message'      => $theme_message,
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
</head>
<body class="dtm-body" lang="fa">
	<div id="dtm-chat-app"></div>
	<script type="module" src="<?php echo $js_src; ?>?v=<?php echo $asset_ver; ?>"></script>
</body>
</html>
