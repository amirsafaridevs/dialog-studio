<?php
/**
 * Dialog page shell — ensures wp_head/wp_footer always run for canvas and page templates.
 * Header/footer HTML visibility is controlled by includes_header / includes_footer on the active template.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

use DialogStudio\Service\Dialog\DialogTemplateRenderer;

?><!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
	<meta charset="<?php bloginfo( 'charset' ); ?>">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<?php wp_head(); ?>
</head>
<body <?php body_class(); ?>>
<?php
wp_body_open();
get_header();
?>
<main id="dialog-content" class="dialog-content">
<?php DialogTemplateRenderer::renderActiveContent(); ?>
</main>
<?php
get_footer();
wp_footer();
?>
</body>
</html>
