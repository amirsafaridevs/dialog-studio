<?php
/**
 * Dialog page shell stub — kept for compatibility.
 * Template rendering is now handled directly by the active child theme.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}
?><!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
	<meta charset="<?php bloginfo( 'charset' ); ?>">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<?php wp_head(); ?>
</head>
<body <?php body_class(); ?>>
<?php wp_body_open(); get_header(); ?>
<main id="dialog-content" class="dialog-content"></main>
<?php get_footer(); wp_footer(); ?>
</body>
</html>
