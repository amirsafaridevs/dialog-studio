<?php

/**
 * Plugin Name: Dialog studio
 * Description: Dialog studio is a plugin for creating and customizing your wordpress site.
 * Version: 1.0.0
 * Author: Amir Safari
 * Author URI: https://artacode.net
 * License: GPL v2 or later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain: DialogStudio
 * Domain Path: /languages
 */


if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! defined( 'DialogStudio_PLUGIN_FILE' ) ) {
	define( 'DialogStudio_PLUGIN_FILE', __FILE__ );
}

require_once __DIR__ . '/vendor/autoload.php';

\DialogStudio\App\App::get();

register_activation_hook(
	DialogStudio_PLUGIN_FILE,
	static function () {
		\DialogStudio\Core\Application::get()->pluginActivation();
	}
);
