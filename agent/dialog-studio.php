<?php
/**
 * Plugin Name: Dialog Theme Maker - Agent
 * Description: Agent runtime for Dialog Theme Maker — intercepts /DialogStudio/v1/* requests directly.
 * Version: 1.0.0
 *
 * This file is auto-loaded as a must-use plugin.
 * It intercepts /DialogStudio/v1/* requests and handles them directly,
 * without relying on the WordPress REST API.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

// ── Clean output buffer for our API endpoints ──
if ( stripos( $_SERVER['REQUEST_URI'] ?? '', '/DialogStudio/' ) !== false ) {
	ini_set( 'display_errors', '0' );
	error_reporting( 0 );
	while ( ob_get_level() > 0 ) {
		ob_end_clean();
	}
}

final class DialogStudio_Agent {

	private const API_PREFIX = '/DialogStudio/v1';

	/** Marker in child theme style.css that identifies a Dialog-managed theme. */
	private const DIALOG_CHILD_MARKER = 'Dialog Studio: managed';

	// --- Token options (dtm_ prefix) ---
	private const STATIC_TOKENS_OPTION = 'dtm_tokens';
	private const AGENT_TOKEN_OPTION     = 'dtm_agent_token';
	private const SETTINGS_OPTION        = 'dtm_settings';

	private const DEFAULT_CUSTOM_PROMPT  = 'طراحی‌ها را بر اساس Material Design و سبک مدرن انجام بده. از فضای سفید کافی، تایپوگرافی خوانا، سایه‌های لطیف، گوشه‌های گرد و پالت رنگی هماهنگ استفاده کن. رابط کاربری باید تمیز، ساده و واکنش‌گرا باشد.';

	// --- Security limits ---
	private const MAX_BODY_SIZE        = 2 * 1024 * 1024;
	private const RATE_LIMIT_MAX         = 200;
	private const RATE_LIMIT_WINDOW      = 60;
	private const THEME_INDEX_TIME_LIMIT = 30;

	private static ?self $instance = null;

	/** @var array<int, array{method: string, path: string, callback: string, public: bool, response: string}> */
	private array $routes = [];

	/** @var array<string, array{0: int, 1: int}> Rate limiting state: [endpoint => [timestamp, count]] */
	private static array $rate_limits = [];

	private function __construct() {}

	private function __clone() {}

	public function __wakeup(): void {
		throw new \Exception( 'Cannot unserialize singleton' );
	}

	public static function get_instance(): self {
		
		if ( self::$instance === null ) {
			self::$instance = new self();
		}

		return self::$instance;
	}

	/**
	 * Boot the agent — called from muplugins_loaded hook.
	 */
	public function boot(): void {
		
		$this->define_routes();
		$this->handle_request();
	}

	private function resolve_api_uri(): ?string {
		$request_uri = $_SERVER['REQUEST_URI'] ?? '';
		$uri         = parse_url( $request_uri, PHP_URL_PATH );

		if ( ! is_string( $uri ) ) {
			return null;
		}

		$prefix_pos = stripos( $uri, self::API_PREFIX );
		if ( $prefix_pos === false ) {
			return null;
		}

		$api_uri = substr( $uri, $prefix_pos );
		$api_uri = $this->normalize_api_uri( $api_uri );

		return untrailingslashit( $api_uri );
	}

	/**
	 * Register all routes.
	 */
	private function define_routes(): void {
		// Chat & Settings (existing)
		$this->add_route( 'GET', self::API_PREFIX . '/chat', 'handle_chat', [ 'public' => true, 'response' => 'html' ] );
		$this->add_route( 'GET', self::API_PREFIX . '/settings', 'handle_get_settings', [ 'public' => true ] );
		$this->add_route( 'GET', self::API_PREFIX . '/settings/agent', 'handle_get_agent_settings', [ 'public' => true ] );
		$this->add_route( 'GET', self::API_PREFIX . '/settings/openrouter-models', 'handle_get_openrouter_models', [ 'public' => true ] );
		$this->add_route( 'POST', self::API_PREFIX . '/settings/openrouter-models', 'handle_get_openrouter_models', [ 'public' => true ] );
		$this->add_route( 'POST', self::API_PREFIX . '/settings', 'handle_save_settings', [ 'public' => true ] );

		// File Operations (write restricted to Dialog-managed child theme)
		$this->add_route( 'POST', self::API_PREFIX . '/file/read', 'handle_file_read' );
		$this->add_route( 'POST', self::API_PREFIX . '/file/write', 'handle_file_write' );
		$this->add_route( 'POST', self::API_PREFIX . '/file/edit', 'handle_file_edit' );
		$this->add_route( 'POST', self::API_PREFIX . '/file/append', 'handle_file_append' );
		$this->add_route( 'POST', self::API_PREFIX . '/file/delete', 'handle_file_delete' );
		$this->add_route( 'POST', self::API_PREFIX . '/file/list', 'handle_file_list' );

		// Child theme management
		$this->add_route( 'GET', self::API_PREFIX . '/theme/child-status', 'handle_theme_child_status' );
		$this->add_route( 'POST', self::API_PREFIX . '/theme/child-setup', 'handle_theme_child_setup' );

		// Directory Operations
		$this->add_route( 'POST', self::API_PREFIX . '/directory/create', 'handle_directory_create' );
		$this->add_route( 'POST', self::API_PREFIX . '/directory/delete', 'handle_directory_delete' );
		$this->add_route( 'POST', self::API_PREFIX . '/directory/list', 'handle_directory_list' );

		// Search Tools (multi-keyword support)
		$this->add_route( 'POST', self::API_PREFIX . '/search/files', 'handle_search_files' );
		$this->add_route( 'POST', self::API_PREFIX . '/search/content', 'handle_search_content' );

		// WordPress Debugger
		$this->add_route( 'POST', self::API_PREFIX . '/debug/toggle', 'handle_debug_toggle' );
		$this->add_route( 'GET', self::API_PREFIX . '/debug/log', 'handle_debug_log' );
		$this->add_route( 'POST', self::API_PREFIX . '/debug/clear', 'handle_debug_clear' );

		// Dialog Theme Management
		$this->add_route( 'POST', self::API_PREFIX . '/theme/check', 'handle_theme_check' );
		$this->add_route( 'GET', self::API_PREFIX . '/theme/index', 'handle_theme_index' );
		$this->add_route( 'POST', self::API_PREFIX . '/code/graph', 'handle_code_graph' );
		$this->add_route( 'POST', self::API_PREFIX . '/code/validate', 'handle_code_validate' );

		// WordPress Plugins (pages/create + pages/update run after full WP bootstrap)
		$this->add_route( 'GET', self::API_PREFIX . '/plugins/list', 'handle_plugins_list' );

		// Memory Management (Agent learning)
		$this->add_route( 'GET', self::API_PREFIX . '/memory/read', 'handle_memory_read' );
		$this->add_route( 'POST', self::API_PREFIX . '/memory/write', 'handle_memory_write' );
	}

	/**
	 * @param array{public?: bool, response?: string} $options
	 */
	private function add_route( string $method, string $path, string $callback, array $options = [] ): void {
		$this->routes[] = [
			'method'   => $method,
			'path'     => $path,
			'callback' => $callback,
			'public'   => $options['public'] ?? false,
			'response' => $options['response'] ?? 'json',
		];
	}

	private function is_deferred_route( string $method, string $uri ): bool {
		$deferred = [
			'POST' => [
				self::API_PREFIX . '/pages/create',
				self::API_PREFIX . '/pages/update',
			],
		];

		return isset( $deferred[ $method ] ) && in_array( $uri, $deferred[ $method ], true );
	}

	private function match_route( string $method, string $uri ): ?array {
		foreach ( $this->routes as $route ) {
			if ( $route['method'] === $method && $route['path'] === $uri ) {
				return $route;
			}
		}

		return null;
	}

	/**
	 * Normalize request path casing so DialogStudio and DialogStudio both match.
	 */
	private function normalize_api_uri( string $api_uri ): string {
		return (string) preg_replace( '#^/DialogStudio/v1#i', self::API_PREFIX, $api_uri );
	}

	/**
	 * Intercept and handle API requests.
	 */
	public function handle_request(): void {
		$api_uri = $this->resolve_api_uri();
		if ( $api_uri === null ) {
			return;
		}

		$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

		if ( $this->is_deferred_route( $method, $api_uri ) ) {
			return;
		}

		$route = $this->match_route( $method, $api_uri );
		if ( $route === null ) {
			$this->json_response(
				404,
				[
					'success' => false,
					'data'    => null,
					'error'   => 'Route not found: ' . $method . ' ' . ( $_SERVER['REQUEST_URI'] ?? '' ),
				]
			);
		}

		if ( empty( $route['public'] ) ) {
			$auth_result = $this->authenticate_request();
			if ( $auth_result !== true ) {
				$this->json_response(
					401,
					[
						'success' => false,
						'data'    => null,
						'error'   => is_string( $auth_result ) ? $auth_result : 'Unauthorized',
					]
				);
			}
		}

		$callback = [ $this, $route['callback'] ];
		if ( ! is_callable( $callback ) ) {
			$this->json_response(
				500,
				[
					'success' => false,
					'data'    => null,
					'error'   => 'Internal error: callback not callable',
				]
			);
		}

		try {
			$result = call_user_func( $callback );

			if ( ( $route['response'] ?? 'json' ) === 'html' ) {
				$this->html_response( 200, is_string( $result ) ? $result : '' );
			}

			$this->json_response( 200, is_array( $result ) ? $result : [] );
		} catch ( \Throwable $e ) {
			if ( defined( 'WP_DEBUG' ) && WP_DEBUG && defined( 'WP_DEBUG_LOG' ) && WP_DEBUG_LOG ) {
				error_log( '[DialogStudio] Error in ' . $route['callback'] . ': ' . $e->getMessage() );
			}

			$this->json_response(
				500,
				[
					'success' => false,
					'data'    => null,
					'error'   => $e->getMessage(),
				]
			);
		}
	}

	// =============================================
	// Authentication
	// =============================================

	/**
	 * Check if current user is logged in and has required capability at muplugins_loaded stage.
	 *
	 * @return bool
	 */
	private function verify_early_user_access(): bool {
		global $wpdb;

		$user_id = $this->validate_auth_cookie_early();
		if ( ! $user_id ) {
			return false;
		}

		$user_meta = $wpdb->get_var(
			$wpdb->prepare(
				"SELECT meta_value FROM {$wpdb->usermeta} WHERE user_id = %d AND meta_key = %s LIMIT 1",
				$user_id,
				$wpdb->get_blog_prefix() . 'capabilities'
			)
		);

		if ( ! $user_meta ) {
			return false;
		}

		$capabilities = $this->maybe_unserialize_early( $user_meta );
		if ( ! is_array( $capabilities ) ) {
			return false;
		}

		return isset( $capabilities['administrator'] ) || isset( $capabilities['edit_theme_options'] );
	}

	/**
	 * Validate the logged-in auth cookie using the same logic as wp_validate_auth_cookie().
	 *
	 * @return int|false User ID when valid, false otherwise.
	 */
	private function validate_auth_cookie_early() {
		$cookie_elements = $this->parse_auth_cookie();
		if ( empty( $cookie_elements ) ) {
			return false;
		}

		$scheme     = $cookie_elements['scheme'];
		$username   = $cookie_elements['username'];
		$hmac       = $cookie_elements['hmac'];
		$token      = $cookie_elements['token'];
		$expiration = $cookie_elements['expiration'];

		$expired = (int) $expiration;

		if ( ( function_exists( 'wp_doing_ajax' ) && wp_doing_ajax() ) || 'POST' === ( $_SERVER['REQUEST_METHOD'] ?? '' ) ) {
			$hour = defined( 'HOUR_IN_SECONDS' ) ? HOUR_IN_SECONDS : 3600;
			$expired += $hour;
		}

		if ( $expired < time() ) {
			return false;
		}

		global $wpdb;

		$user = $wpdb->get_row(
			$wpdb->prepare(
				"SELECT ID, user_login, user_pass FROM {$wpdb->users} WHERE user_login = %s LIMIT 1",
				$username
			)
		);

		if ( ! $user ) {
			return false;
		}

		if ( str_starts_with( $user->user_pass, '$P$' ) || str_starts_with( $user->user_pass, '$2y$' ) ) {
			$pass_frag = substr( $user->user_pass, 8, 4 );
		} else {
			$pass_frag = substr( $user->user_pass, -4 );
		}

		$key  = $this->hash_early( $username . '|' . $pass_frag . '|' . $expiration . '|' . $token, $scheme );
		$hash = hash_hmac( 'sha256', $username . '|' . $expiration . '|' . $token, $key );

		if ( ! hash_equals( $hash, $hmac ) ) {
			return false;
		}

		if ( ! $this->verify_session_token_early( (int) $user->ID, $token ) ) {
			return false;
		}

		return (int) $user->ID;
	}

	/**
	 * Verify a session token against stored user session data.
	 */
	private function verify_session_token_early( int $user_id, string $token ): bool {
		if ( class_exists( 'WP_Session_Tokens' ) ) {
			return WP_Session_Tokens::get_instance( $user_id )->verify( $token );
		}

		global $wpdb;

		$session_meta = $wpdb->get_var(
			$wpdb->prepare(
				"SELECT meta_value FROM {$wpdb->usermeta} WHERE user_id = %d AND meta_key = 'session_tokens' LIMIT 1",
				$user_id
			)
		);

		if ( ! is_string( $session_meta ) || $session_meta === '' ) {
			return false;
		}

		$sessions = $this->maybe_unserialize_early( $session_meta );
		if ( ! is_array( $sessions ) ) {
			return false;
		}

		$verifier = hash( 'sha256', $token );

		return isset( $sessions[ $verifier ] );
	}

	/**
	 * Parse WordPress authentication cookie.
	 *
	 * @return array{username: string, expiration: string, token: string, hmac: string, scheme: string}|array
	 */
	private function parse_auth_cookie(): array {
		if ( function_exists( 'wp_parse_auth_cookie' ) ) {
			$parsed = wp_parse_auth_cookie( '', 'logged_in' );
			if ( is_array( $parsed ) ) {
				return $parsed;
			}
		}

		$cookie_name = '';

		foreach ( $_COOKIE as $name => $value ) {
			if ( strpos( $name, 'wordpress_logged_in_' ) === 0 ) {
				$cookie_name = $name;
				break;
			}
		}

		if ( $cookie_name === '' || empty( $_COOKIE[ $cookie_name ] ) ) {
			return [];
		}

		$cookie_elements = explode( '|', (string) $_COOKIE[ $cookie_name ] );

		if ( count( $cookie_elements ) !== 4 ) {
			return [];
		}

		return [
			'username'   => $cookie_elements[0],
			'expiration' => $cookie_elements[1],
			'token'      => $cookie_elements[2],
			'hmac'       => $cookie_elements[3],
			'scheme'     => 'logged_in',
		];
	}

	/**
	 * Authenticate the incoming request.
	 *
	 * Accepts either a Bearer agent token (external integrations) or a logged-in
	 * admin session with a valid X-DTM-Nonce header (browser chat UI).
	 *
	 * @return bool|string
	 */
	private function authenticate_request() {
		$auth_header = $_SERVER['HTTP_AUTHORIZATION']
			?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION']
			?? '';

		if ( ! empty( $auth_header ) ) {
			if ( ! preg_match( '/^Bearer\s+(.+)$/i', $auth_header, $matches ) ) {
				return 'Invalid Authorization format — must be Bearer token';
			}

			$token = $matches[1];

			$active_token = get_option( self::AGENT_TOKEN_OPTION, '' );
			if ( ! empty( $active_token ) && hash_equals( (string) $active_token, $token ) ) {
				return true;
			}

			$static_tokens = get_option( self::STATIC_TOKENS_OPTION, [] );
			if ( is_array( $static_tokens ) ) {
				foreach ( $static_tokens as $stored ) {
					if ( is_array( $stored ) && ! empty( $stored['is_active'] ) && hash_equals( (string) $stored['token'], $token ) ) {
						return true;
					}
				}
			}

			return 'Invalid or expired token';
		}

		if ( ! $this->verify_early_user_access() ) {
			return 'Unauthorized';
		}

		$nonce = $_SERVER['HTTP_X_DTM_NONCE'] ?? '';
		if ( ! is_string( $nonce ) || ! $this->verify_early_nonce( $nonce, 'dtm_settings' ) ) {
			return 'Invalid or missing nonce';
		}

		return true;
	}

	// =============================================
	// Rate Limiting
	// =============================================

	/**
	 * @return bool|int True if allowed, or seconds to wait if rate limited.
	 */
	private function check_rate_limit( string $endpoint ) {
		$now = time();

		if ( isset( self::$rate_limits[ $endpoint ] ) ) {
			$elapsed = $now - self::$rate_limits[ $endpoint ][0];

			if ( $elapsed >= self::RATE_LIMIT_WINDOW ) {
				self::$rate_limits[ $endpoint ] = [ $now, 1 ];
				return true;
			}

			if ( self::$rate_limits[ $endpoint ][1] >= self::RATE_LIMIT_MAX ) {
				return max( 1, self::RATE_LIMIT_WINDOW - $elapsed );
			}

			self::$rate_limits[ $endpoint ][1]++;
			return true;
		}

		self::$rate_limits[ $endpoint ] = [ $now, 1 ];
		return true;
	}

	// =============================================
	// Route Callbacks
	// =============================================

	/**
	 * GET /DialogStudio/v1/chat
	 *
	 * Serves the Vue chat UI shell.
	 */
	private function handle_chat(): string {
		if ( ! $this->verify_early_user_access() ) {
			http_response_code( 403 );
			header( 'Content-Type: text/html; charset=utf-8' );
			echo '<h1>Access Denied</h1><p>You must be logged in as an administrator.</p>';
			exit;
		}

		$assets         = $this->resolve_chat_assets();
		$css_url        = $assets['css_url'];
		$js_url         = $assets['js_url'];
		$version        = $assets['version'];
		$api_base       = rtrim( $this->get_home_url( self::API_PREFIX ), '/' );
		$settings_nonce = $this->create_early_nonce( 'dtm_settings' );
		$theme_status   = $this->get_child_theme_status_for_view();

		ob_start();
		include $assets['view_path'];
		return (string) ob_get_clean();
	}

	/**
	 * GET /DialogStudio/v1/settings
	 *
	 * Returns persisted agent settings for the chat UI.
	 *
	 * @return array{success: bool, data: array<string, mixed>|null, error: string|null}
	 */
	private function handle_get_settings(): array {
		$this->require_chat_user();

		$settings = $this->get_settings();
		$settings = $this->prepare_settings_for_client( $settings );

		return [
			'success' => true,
			'data'    => $settings,
			'error'   => null,
		];
	}

	/**
	 * GET /DialogStudio/v1/settings/agent
	 *
	 * Returns full agent settings including the API key for in-browser initialization.
	 *
	 * @return array{success: bool, data: array<string, mixed>|null, error: string|null}
	 */
	private function handle_get_agent_settings(): array {
		$this->require_chat_user();

		$nonce = $_SERVER['HTTP_X_DTM_NONCE'] ?? '';
		if ( ! is_string( $nonce ) || ! $this->verify_early_nonce( $nonce, 'dtm_settings' ) ) {
			$this->json_response(
				403,
				[
					'success' => false,
					'data'    => null,
					'error'   => 'Invalid or missing nonce',
				]
			);
		}

		return [
			'success' => true,
			'data'    => $this->get_settings(),
			'error'   => null,
		];
	}

	/**
	 * POST /DialogStudio/v1/settings
	 *
	 * Persists agent settings from the chat UI.
	 *
	 * @return array{success: bool, data: array<string, mixed>|null, error: string|null}
	 */
	private function handle_save_settings(): array {
		$this->require_chat_user();

		$nonce = $_SERVER['HTTP_X_DTM_NONCE'] ?? '';
		if ( ! is_string( $nonce ) || ! $this->verify_early_nonce( $nonce, 'dtm_settings' ) ) {
			$this->json_response(
				403,
				[
					'success' => false,
					'data'    => null,
					'error'   => 'Invalid or missing nonce',
				]
			);
		}

		$body     = $this->get_json_body();
		$existing = $this->get_settings();
		$settings = $this->sanitize_settings_payload( $body, $existing );

		update_option( self::SETTINGS_OPTION, $settings, false );

		return [
			'success' => true,
			'data'    => $this->prepare_settings_for_client( $settings ),
			'error'   => null,
		];
	}

	/**
	 * GET /DialogStudio/v1/settings/openrouter-models
	 *
	 * Proxies OpenRouter model catalog for the chat settings UI.
	 *
	 * @return array{success: bool, data: array<string, mixed>|null, error: string|null}
	 */
	private function handle_get_openrouter_models(): array {
		$this->require_chat_user();

		$nonce = $_SERVER['HTTP_X_DTM_NONCE'] ?? '';
		if ( ! is_string( $nonce ) || ! $this->verify_early_nonce( $nonce, 'dtm_settings' ) ) {
			$this->json_response(
				403,
				[
					'success' => false,
					'data'    => null,
					'error'   => 'Invalid or missing nonce',
				]
			);
		}

		$settings = $this->get_settings();
		$api_key  = '';

		if ( ( $_SERVER['REQUEST_METHOD'] ?? 'GET' ) === 'POST' ) {
			$body = $this->get_json_body();
			if ( is_array( $body ) && isset( $body['api_key'] ) ) {
				$api_key = sanitize_text_field( (string) $body['api_key'] );
			}
		} elseif ( isset( $_GET['api_key'] ) ) {
			$api_key = sanitize_text_field( (string) $_GET['api_key'] );
		}

		if ( $api_key === '' || $this->is_masked_api_key( $api_key ) ) {
			$api_key = (string) ( $settings['llm']['api_key'] ?? '' );
		}

		$api_key = trim( $api_key );

		if ( $api_key === '' ) {
			return [
				'success' => false,
				'data'    => null,
				'error'   => 'OpenRouter API key is required to load models.',
			];
		}

		$query = http_build_query(
			[
				'output_modalities'    => 'text',
				'supported_parameters' => 'tools',
				'sort'                 => 'top-weekly',
			]
		);

		$request = $this->openrouter_http_get( 'https://openrouter.ai/api/v1/models?' . $query, $api_key );

		if ( ! $request['success'] ) {
			return [
				'success' => false,
				'data'    => null,
				'error'   => $request['error'],
			];
		}

		$body = $request['body'];

		if ( ! is_array( $body['data'] ?? null ) ) {
			$error = is_array( $body ) && isset( $body['error']['message'] )
				? (string) $body['error']['message']
				: 'Failed to fetch OpenRouter models.';

			return [
				'success' => false,
				'data'    => null,
				'error'   => $error,
			];
		}

		$models = [];

		foreach ( $body['data'] as $model ) {
			if ( ! is_array( $model ) ) {
				continue;
			}

			$id = sanitize_text_field( (string) ( $model['id'] ?? '' ) );
			if ( $id === '' ) {
				continue;
			}

			$label = sanitize_text_field( (string) ( $model['name'] ?? $id ) );
			if ( $label === '' ) {
				$label = $id;
			}

			$models[] = [
				'id'    => $id,
				'label' => $label,
			];
		}

		return [
			'success' => true,
			'data'    => [
				'models' => $models,
			],
			'error'   => null,
		];
	}

	/**
	 * @return array{success: bool, body: array<string, mixed>|null, error: string}
	 */
	private function openrouter_http_get( string $url, string $api_key ): array {
		$headers = [
			'Authorization: Bearer ' . $api_key,
			'HTTP-Referer: ' . home_url( '/' ),
			'X-OpenRouter-Title: Dialog Theme Maker',
			'Accept: application/json',
		];

		if ( function_exists( 'curl_init' ) ) {
			$ch = curl_init( $url );
			if ( $ch === false ) {
				return [
					'success' => false,
					'body'    => null,
					'error'   => 'Failed to initialize cURL.',
				];
			}

			curl_setopt_array(
				$ch,
				[
					CURLOPT_RETURNTRANSFER => true,
					CURLOPT_TIMEOUT        => 30,
					CURLOPT_HTTPHEADER     => $headers,
					CURLOPT_SSL_VERIFYPEER => false,
					CURLOPT_SSL_VERIFYHOST => 0,
				]
			);

			$raw_body = curl_exec( $ch );
			$status   = (int) curl_getinfo( $ch, CURLINFO_HTTP_CODE );
			$curl_err = curl_error( $ch );
			curl_close( $ch );

			if ( $raw_body === false ) {
				return [
					'success' => false,
					'body'    => null,
					'error'   => $curl_err !== '' ? $curl_err : 'OpenRouter request failed.',
				];
			}

			$body = json_decode( (string) $raw_body, true );
			if ( $status !== 200 ) {
				$error = is_array( $body ) && isset( $body['error']['message'] )
					? (string) $body['error']['message']
					: 'OpenRouter request failed (' . $status . ').';

				return [
					'success' => false,
					'body'    => is_array( $body ) ? $body : null,
					'error'   => $error,
				];
			}

			return [
				'success' => true,
				'body'    => is_array( $body ) ? $body : [],
				'error'   => '',
			];
		}

		$response = wp_remote_get(
			$url,
			[
				'timeout'   => 30,
				'sslverify' => false,
				'headers'   => [
					'Authorization'      => 'Bearer ' . $api_key,
					'HTTP-Referer'       => home_url( '/' ),
					'X-OpenRouter-Title' => 'Dialog Theme Maker',
					'Accept'             => 'application/json',
				],
			]
		);

		if ( is_wp_error( $response ) ) {
			return [
				'success' => false,
				'body'    => null,
				'error'   => $response->get_error_message(),
			];
		}

		$status_code = (int) wp_remote_retrieve_response_code( $response );
		$body        = json_decode( (string) wp_remote_retrieve_body( $response ), true );

		if ( $status_code !== 200 ) {
			$error = is_array( $body ) && isset( $body['error']['message'] )
				? (string) $body['error']['message']
				: 'OpenRouter request failed (' . $status_code . ').';

			return [
				'success' => false,
				'body'    => is_array( $body ) ? $body : null,
				'error'   => $error,
			];
		}

		return [
			'success' => true,
			'body'    => is_array( $body ) ? $body : [],
			'error'   => '',
		];
	}

	/**
	 * @return array{llm: array<string, mixed>, permissions: array<string, bool>, custom_prompt: string}
	 */
	private function get_default_settings(): array {
		return [
			'llm'           => [
				'provider'            => 'deepseek',
				'model'               => 'deepseek-v4-flash',
				'api_key'             => '',
				'use_custom_endpoint' => false,
				'custom_endpoint'     => '',
				'custom_model'        => '',
			],
			'permissions'   => [
				'read_files'   => true,
				'write_files'  => true,
				'debugger'     => false,
				'manage_pages' => false,
			],
			'custom_prompt' => self::DEFAULT_CUSTOM_PROMPT,
		];
	}

	/**
	 * @return array{llm: array<string, mixed>, permissions: array<string, bool>, custom_prompt: string}
	 */
	private function get_settings(): array {
		$stored = get_option( self::SETTINGS_OPTION, [] );

		if ( ! is_array( $stored ) ) {
			return $this->get_default_settings();
		}

		$defaults = $this->get_default_settings();
		$custom_prompt = $defaults['custom_prompt'];
		if ( array_key_exists( 'custom_prompt', $stored ) && is_string( $stored['custom_prompt'] ) ) {
			$custom_prompt = $stored['custom_prompt'];
		}

		return [
			'llm'           => array_merge( $defaults['llm'], is_array( $stored['llm'] ?? null ) ? $stored['llm'] : [] ),
			'permissions'   => array_merge( $defaults['permissions'], is_array( $stored['permissions'] ?? null ) ? $stored['permissions'] : [] ),
			'custom_prompt' => $custom_prompt,
		];
	}

	/**
	 * @param array<string, mixed> $payload
	 * @param array{llm: array<string, mixed>, permissions: array<string, bool>, custom_prompt: string} $existing
	 *
	 * @return array{llm: array<string, mixed>, permissions: array<string, bool>, custom_prompt: string}
	 */
	private function sanitize_settings_payload( array $payload, array $existing ): array {
		$defaults  = $this->get_default_settings();
		$providers = [ 'deepseek', 'openai', 'claude', 'gemini', 'qwen', 'openrouter' ];

		$llm_input = is_array( $payload['llm'] ?? null ) ? $payload['llm'] : [];
		$provider  = sanitize_key( (string) ( $llm_input['provider'] ?? $existing['llm']['provider'] ) );
		if ( ! in_array( $provider, $providers, true ) ) {
			$provider = $defaults['llm']['provider'];
		}

		$model = sanitize_text_field( (string) ( $llm_input['model'] ?? $existing['llm']['model'] ) );
		if ( $model === '' ) {
			$model = (string) $defaults['llm']['model'];
		}

		$api_key_input = (string) ( $llm_input['api_key'] ?? '' );
		$api_key       = $existing['llm']['api_key'];
		if ( $api_key_input !== '' && ! $this->is_masked_api_key( $api_key_input ) ) {
			$api_key = sanitize_text_field( $api_key_input );
		}

		$use_custom = ! empty( $llm_input['use_custom_endpoint'] );

		$perm_input = is_array( $payload['permissions'] ?? null ) ? $payload['permissions'] : [];

		$custom_prompt = (string) ( $existing['custom_prompt'] ?? $defaults['custom_prompt'] );
		if ( array_key_exists( 'custom_prompt', $payload ) ) {
			$custom_prompt = sanitize_textarea_field( (string) $payload['custom_prompt'] );
		}

		return [
			'llm'           => [
				'provider'            => $provider,
				'model'               => $model,
				'api_key'             => $api_key,
				'use_custom_endpoint' => $use_custom,
				'custom_endpoint'     => esc_url_raw( (string) ( $llm_input['custom_endpoint'] ?? '' ) ),
				'custom_model'        => sanitize_text_field( (string) ( $llm_input['custom_model'] ?? '' ) ),
			],
			'permissions'   => [
				'read_files'  => array_key_exists( 'read_files', $perm_input )
					? ! empty( $perm_input['read_files'] )
					: (bool) ( $existing['permissions']['read_files'] ?? $defaults['permissions']['read_files'] ),
				'write_files' => array_key_exists( 'write_files', $perm_input )
					? ! empty( $perm_input['write_files'] )
					: (bool) ( $existing['permissions']['write_files'] ?? $defaults['permissions']['write_files'] ),
				'debugger'     => array_key_exists( 'debugger', $perm_input )
					? ! empty( $perm_input['debugger'] )
					: (bool) ( $existing['permissions']['debugger'] ?? $defaults['permissions']['debugger'] ),
				'manage_pages' => array_key_exists( 'manage_pages', $perm_input )
					? ! empty( $perm_input['manage_pages'] )
					: (bool) ( $existing['permissions']['manage_pages'] ?? $defaults['permissions']['manage_pages'] ),
			],
			'custom_prompt' => $custom_prompt,
		];
	}

	/**
	 * @param array{llm: array<string, mixed>, permissions: array<string, bool>, custom_prompt: string} $settings
	 *
	 * @return array{llm: array<string, mixed>, permissions: array<string, bool>, custom_prompt: string}
	 */
	private function prepare_settings_for_client( array $settings ): array {
		$api_key = (string) ( $settings['llm']['api_key'] ?? '' );

		$settings['llm']['has_api_key']    = $api_key !== '';
		$settings['llm']['api_key_masked'] = $api_key !== '' ? $this->mask_api_key( $api_key ) : '';
		unset( $settings['llm']['api_key'] );

		return $settings;
	}

	private function mask_api_key( string $api_key ): string {
		$length = strlen( $api_key );
		if ( $length <= 8 ) {
			return str_repeat( '*', $length );
		}

		return substr( $api_key, 0, 4 ) . str_repeat( '*', max( 4, $length - 8 ) ) . substr( $api_key, -4 );
	}

	private function is_masked_api_key( string $value ): bool {
		return (bool) preg_match( '/^[^*]*\*+[^*]*$/', $value ) && strpos( $value, '*' ) !== false;
	}

	private function require_chat_user(): void {
		if ( ! $this->verify_early_user_access() ) {
			$this->json_response(
				403,
				[
					'success' => false,
					'data'    => null,
					'error'   => 'Forbidden',
				]
			);
		}
	}

	/**
	 * Create a nonce at early stage.
	 */
	private function create_early_nonce( string $action ): string {
		$i = $this->nonce_tick_early();
		return substr( $this->hash_early( $i . '|' . $action . '|' . ( $this->get_current_user_id() ?? 0 ), 'nonce' ), -12, 10 );
	}

	/**
	 * Verify nonce at early stage.
	 */
	private function verify_early_nonce( string $nonce, string $action ): bool {
		$i        = $this->nonce_tick_early();
		$user_id  = $this->get_current_user_id() ?? 0;
		$expected = substr( $this->hash_early( $i . '|' . $action . '|' . $user_id, 'nonce' ), -12, 10 );

		if ( hash_equals( $expected, $nonce ) ) {
			return true;
		}

		$expected = substr( $this->hash_early( ( $i - 1 ) . '|' . $action . '|' . $user_id, 'nonce' ), -12, 10 );

		return hash_equals( $expected, $nonce );
	}

	/**
	 * Get current user ID from cookie at early stage.
	 */
	private function get_current_user_id(): ?int {
		$user_id = $this->validate_auth_cookie_early();

		return $user_id ? (int) $user_id : null;
	}

	/**
	 * Absolute path to the main plugin directory (not mu-plugins copy).
	 */
	private function get_plugin_root(): string {
		if ( defined( 'DialogStudio_PLUGIN_FILE' ) ) {
			return dirname( DialogStudio_PLUGIN_FILE );
		}

		// Check if this file is running from inside the plugin directory (direct)
		$agent_dir = dirname( __DIR__ );
		if ( is_readable( $agent_dir . DIRECTORY_SEPARATOR . 'dialog-studio.php' ) ) {
			return $agent_dir;
		}

		return WP_PLUGIN_DIR . DIRECTORY_SEPARATOR . 'dialog-studio';
	}

	/**
	 * Absolute path to the main plugin bootstrap file.
	 */
	private function get_plugin_file(): string {
		if ( defined( 'DialogStudio_PLUGIN_FILE' ) ) {
			return DialogStudio_PLUGIN_FILE;
		}

		return $this->get_plugin_root() . DIRECTORY_SEPARATOR . 'dialog-studio.php';
	}

	/**
	 * Resolve plugin asset URLs for the chat UI.
	 *
	 * @return array{view_path: string, css_url: string, js_url: string, version: string}
	 */
	private function resolve_chat_assets(): array {
		$plugin_root = $this->get_plugin_root();
		$plugin_file = $this->get_plugin_file();
		$version     = '1.0.0';

		if ( is_readable( $plugin_file ) ) {
			if ( ! function_exists( 'get_plugin_data' ) && is_readable( ABSPATH . 'wp-admin/includes/plugin.php' ) ) {
				require_once ABSPATH . 'wp-admin/includes/plugin.php';
			}

			if ( function_exists( 'get_plugin_data' ) ) {
				$plugin_data = get_plugin_data( $plugin_file, false, false );
				if ( ! empty( $plugin_data['Version'] ) ) {
					$version = (string) $plugin_data['Version'];
				}
			}
		}

		$css_path = $plugin_root . DIRECTORY_SEPARATOR . 'assets' . DIRECTORY_SEPARATOR . 'chat' . DIRECTORY_SEPARATOR . 'chat.css';
		$js_path  = $plugin_root . DIRECTORY_SEPARATOR . 'assets' . DIRECTORY_SEPARATOR . 'chat' . DIRECTORY_SEPARATOR . 'chat.js';

		if ( is_readable( $css_path ) ) {
			$version = (string) filemtime( $css_path );
		} elseif ( is_readable( $js_path ) ) {
			$version = (string) filemtime( $js_path );
		}

		return [
			'view_path' => $plugin_root . DIRECTORY_SEPARATOR . 'view' . DIRECTORY_SEPARATOR . 'ChatPage' . DIRECTORY_SEPARATOR . 'chat.php',
			'css_url'   => $this->plugin_asset_url( 'assets/chat/chat.css' ),
			'js_url'    => $this->plugin_asset_url( 'assets/chat/chat.js' ),
			'version'   => $version,
		];
	}

	/**
	 * WordPress pluggable equivalents for muplugins_loaded stage.
	 */
	private function get_wp_salt( string $scheme = 'auth' ): string {
		if ( function_exists( 'wp_salt' ) ) {
			return wp_salt( $scheme );
		}

		switch ( $scheme ) {
			case 'auth':
				return ( defined( 'AUTH_KEY' ) ? AUTH_KEY : '' ) . ( defined( 'AUTH_SALT' ) ? AUTH_SALT : '' );
			case 'secure_auth':
				return ( defined( 'SECURE_AUTH_KEY' ) ? SECURE_AUTH_KEY : '' ) . ( defined( 'SECURE_AUTH_SALT' ) ? SECURE_AUTH_SALT : '' );
			case 'logged_in':
				return ( defined( 'LOGGED_IN_KEY' ) ? LOGGED_IN_KEY : '' ) . ( defined( 'LOGGED_IN_SALT' ) ? LOGGED_IN_SALT : '' );
			case 'nonce':
				return ( defined( 'NONCE_KEY' ) ? NONCE_KEY : '' ) . ( defined( 'NONCE_SALT' ) ? NONCE_SALT : '' );
			default:
				return $scheme;
		}
	}

	private function hash_early( string $data, string $scheme = 'auth' ): string {
		if ( function_exists( 'wp_hash' ) ) {
			return wp_hash( $data, $scheme );
		}

		return hash_hmac( 'md5', $data, $this->get_wp_salt( $scheme ) );
	}

	private function nonce_tick_early(): int {
		if ( function_exists( 'wp_nonce_tick' ) ) {
			return wp_nonce_tick();
		}

		$nonce_life = defined( 'DAY_IN_SECONDS' ) ? DAY_IN_SECONDS : 86400;

		return (int) ceil( time() / ( $nonce_life / 2 ) );
	}

	/**
	 * @return mixed
	 */
	private function maybe_unserialize_early( string $data ) {
		if ( function_exists( 'maybe_unserialize' ) ) {
			return maybe_unserialize( $data );
		}

		if ( ! preg_match( '/^(a|O|s|i|d|b):/', $data ) ) {
			return $data;
		}

		return @unserialize( $data, [ 'allowed_classes' => false ] );
	}

	private function get_home_url( string $path = '' ): string {
		if ( function_exists( 'home_url' ) ) {
			return home_url( $path );
		}

		$home = get_option( 'home' );
		if ( ! is_string( $home ) || $home === '' ) {
			$home = ( defined( 'WP_HOME' ) ? WP_HOME : ( defined( 'WP_SITEURL' ) ? WP_SITEURL : '' ) );
		}

		$home = rtrim( (string) $home, '/' );
		$path = ltrim( $path, '/' );

		return $path === '' ? $home : $home . '/' . $path;
	}

	private function plugin_asset_url( string $relative_path ): string {
		$relative_path = ltrim( str_replace( '\\', '/', $relative_path ), '/' );
		$plugin_file   = $this->get_plugin_file();

		if ( function_exists( 'plugins_url' ) && is_readable( $plugin_file ) ) {
			return plugins_url( $relative_path, $plugin_file );
		}

		$plugins_url = defined( 'WP_PLUGIN_URL' ) ? WP_PLUGIN_URL : $this->get_home_url( 'wp-content/plugins' );

		return rtrim( (string) $plugins_url, '/' ) . '/dialog-theme-maker/' . $relative_path;
	}

	// =============================================
	// File System Security & Validation
	// =============================================

	// =============================================
	// Child Theme Path Helpers
	// =============================================

	private function get_themes_root(): string {
		if ( function_exists( 'get_theme_root' ) ) {
			return wp_normalize_path( (string) get_theme_root() );
		}
		return wp_normalize_path( WP_CONTENT_DIR . '/themes' );
	}

	private function get_active_theme_slug(): string {
		$slug = get_option( 'stylesheet', '' );
		return is_string( $slug ) ? $slug : '';
	}

	private function get_active_parent_theme_slug(): string {
		$slug = get_option( 'template', '' );
		return is_string( $slug ) ? $slug : '';
	}

	private function get_child_theme_root(): string {
		$slug = $this->get_active_theme_slug();
		if ( $slug === '' ) {
			return '';
		}
		return wp_normalize_path( $this->get_themes_root() . '/' . $slug );
	}

	private function is_dialog_managed_theme(): bool {
		$root = $this->get_child_theme_root();
		if ( $root === '' ) {
			return false;
		}
		$style = $root . '/style.css';
		if ( ! is_readable( $style ) ) {
			return false;
		}
		$header = @file_get_contents( $style, false, null, 0, 512 );
		return is_string( $header ) && strpos( $header, self::DIALOG_CHILD_MARKER ) !== false;
	}

	private function get_theme_name_from_slug( string $slug ): string {
		if ( $slug === '' ) {
			return '';
		}
		$style = wp_normalize_path( $this->get_themes_root() . '/' . $slug . '/style.css' );
		if ( ! is_readable( $style ) ) {
			return $slug;
		}
		$header = @file_get_contents( $style, false, null, 0, 512 );
		if ( is_string( $header ) && preg_match( '/^Theme Name:\s*(.+)$/mi', $header, $m ) ) {
			return trim( $m[1] );
		}
		return $slug;
	}

	/**
	 * Child theme status passed to the chat view on page load.
	 *
	 * @return array<string, mixed>
	 */
	private function get_child_theme_status_for_view(): array {
		$active_slug = $this->get_active_theme_slug();
		$parent_slug = $this->get_active_parent_theme_slug();
		$is_child    = $parent_slug !== '' && $parent_slug !== $active_slug;
		$is_managed  = $this->is_dialog_managed_theme();
		$theme_path  = $this->get_child_theme_root();

		return [
			'is_managed'        => $is_managed,
			'setup_required'    => ! $is_managed,
			'is_child_theme'    => $is_child,
			'active_slug'       => $active_slug,
			'active_name'       => $this->get_theme_name_from_slug( $active_slug ),
			'parent_slug'       => $is_child ? $parent_slug : $active_slug,
			'parent_name'       => $this->get_theme_name_from_slug( $is_child ? $parent_slug : $active_slug ),
			'child_preview_slug' => ( $is_child ? $parent_slug : $active_slug ) . '-child',
			'workspace_path'    => $theme_path,
			'ready'             => $is_managed && is_dir( $theme_path ) && is_writable( $theme_path ),
		];
	}

	/**
	 * Absolute path to the active Dialog-managed child theme (write root).
	 */
	private function get_dialog_workspace_root(): string {
		return $this->get_child_theme_root();
	}

	/**
	 * Error message when the child theme is not ready for write operations.
	 */
	private function get_dialog_workspace_write_error(): ?string {
		if ( ! $this->is_dialog_managed_theme() ) {
			return 'قالب فعلی توسط Dialog Studio مدیریت نمی‌شود. ابتدا child theme را از صفحه چت راه‌اندازی کنید.';
		}

		$root = $this->get_child_theme_root();

		if ( ! is_dir( $root ) ) {
			return 'پوشه child theme وجود ندارد.';
		}

		if ( ! is_writable( $root ) ) {
			return 'پوشه child theme قابل نوشتن نیست. دسترسی فایل را بررسی کنید.';
		}

		return null;
	}

	/**
	 * Ensure the child theme subdirectory structure exists.
	 */
	private function ensure_dialog_workspace(): void {
		$root = $this->get_child_theme_root();

		if ( ! is_dir( $root ) ) {
			return;
		}

		foreach ( [ 'assets/front/css', 'assets/front/js', 'assets/admin/css', 'assets/admin/js', 'inc' ] as $sub ) {
			$path = $root . '/' . $sub;
			if ( ! is_dir( $path ) ) {
				wp_mkdir_p( $path );
			}
		}
	}

	private function ensure_plugin_application(): bool {
		static $booted = false;

		if ( $booted ) {
			return true;
		}

		$autoload = $this->get_plugin_root() . DIRECTORY_SEPARATOR . 'vendor' . DIRECTORY_SEPARATOR . 'autoload.php';

		if ( ! is_readable( $autoload ) ) {
			return false;
		}

		require_once $autoload;

		if ( ! defined( 'DialogStudio_PLUGIN_FILE' ) ) {
			define( 'DialogStudio_PLUGIN_FILE', $this->get_plugin_file() );
		}

		$app = \DialogStudio\Core\Application::get();

		if ( $app->prefix === '' ) {
			$app->setProperty( 'basePath', $this->get_plugin_root() );
			$app->setProperty( 'prefix', 'DialogStudio' );
			$app->setProperty( 'textdomain', 'DialogStudio' );
			$app->setProperty(
				'migration_folder',
				$app->path( 'src' . DIRECTORY_SEPARATOR . 'Migration' )
			);
		}

		if ( (string) $app->getProperty( 'migration_folder', '' ) !== '' ) {
			$app->runMigrations();
		}

		$booted = true;

		return true;
	}

	private function resolve_dialog_workspace_service(): ?\DialogStudio\Service\Dialog\DialogWorkspaceService {
		if ( ! $this->ensure_plugin_application() ) {
			return null;
		}

		if ( ! class_exists( \DialogStudio\Service\Dialog\DialogWorkspaceService::class ) ) {
			return null;
		}

		return new \DialogStudio\Service\Dialog\DialogWorkspaceService();
	}


	/**
	 * WordPress installation root (ABSPATH).
	 */
	private function get_wordpress_root(): string {
		return wp_normalize_path( ABSPATH );
	}

	/**
	 * Strip a leading "./" without breaking "../" parent references.
	 */
	private function normalize_relative_path( string $path ): string {
		$normalized = wp_normalize_path( str_replace( '\\', '/', $path ) );

		if ( strncmp( $normalized, './', 2 ) === 0 ) {
			return substr( $normalized, 2 );
		}

		return $normalized;
	}

	/**
	 * Resolve agent-supplied paths.
	 * Read/search paths may target any file under the WordPress install (ABSPATH).
	 * Write paths are resolved from the dialog theme root.
	 *
	 * @param string $path
	 * @param string $operation
	 * @return string
	 */
	private function is_path_under( string $path, string $parent ): bool {
		$path   = wp_normalize_path( $path );
		$parent = rtrim( wp_normalize_path( $parent ), '/' );

		if ( $parent === '' ) {
			return false;
		}

		if ( DIRECTORY_SEPARATOR === '\\' ) {
			return stripos( $path, $parent ) === 0;
		}

		return strpos( $path, $parent ) === 0;
	}

	private function is_wordpress_content_relative( string $relative ): bool {
		$content_prefixes = [ 'plugins/', 'themes/', 'mu-plugins/', 'uploads/', 'dialog/' ];

		foreach ( $content_prefixes as $prefix ) {
			if ( strpos( $relative, $prefix ) === 0 ) {
				return true;
			}
		}

		return false;
	}

	private function is_wordpress_root_relative( string $relative ): bool {
		$root_dirs = [ 'wp-content', 'wp-includes', 'wp-admin' ];

		foreach ( $root_dirs as $dir ) {
			if ( $relative === $dir || strpos( $relative, $dir . '/' ) === 0 ) {
				return true;
			}
		}

		$root_files = [
			'wp-config.php',
			'wp-load.php',
			'wp-settings.php',
			'wp-blog-header.php',
			'index.php',
			'.htaccess',
			'xmlrpc.php',
		];

		return in_array( $relative, $root_files, true );
	}

	private function resolve_read_path( string $relative ): string {
		$dialog_path = $this->get_dialog_workspace_root();
		$wp_root     = $this->get_wordpress_root();
		$wp_content  = wp_normalize_path( WP_CONTENT_DIR );

		if ( $this->is_wordpress_content_relative( $relative ) ) {
			return wp_normalize_path( $wp_content . '/' . $relative );
		}

		if ( $this->is_wordpress_root_relative( $relative ) ) {
			return wp_normalize_path( $wp_root . '/' . $relative );
		}

		return wp_normalize_path( $dialog_path . '/' . $relative );
	}

	private function resolve_requested_path( string $path, string $operation = 'read' ): string {
		$path = trim( $path );
		if ( $path === '' ) {
			return '';
		}

		$normalized_input = wp_normalize_path( str_replace( '\\', '/', $path ) );
		$is_write         = in_array( $operation, [ 'write', 'create', 'append', 'delete' ], true );
		$dialog_path      = $this->get_dialog_workspace_root();
		$wp_root          = $this->get_wordpress_root();
		$absolute_root    = $is_write ? $dialog_path : $wp_root;

		// Convert absolute paths under the allowed root into usable paths.
		if ( preg_match( '#^[A-Za-z]:/#', $normalized_input ) || strpos( $normalized_input, '/' ) === 0 ) {
			if ( $this->is_path_under( $normalized_input, $absolute_root ) ) {
				return wp_normalize_path( $normalized_input );
			}

			if ( ! $is_write && $this->is_path_under( $normalized_input, $dialog_path ) ) {
				return wp_normalize_path( $normalized_input );
			}

			$resolved = realpath( $normalized_input );
			if ( $resolved !== false ) {
				$resolved = wp_normalize_path( $resolved );
				if ( $this->is_path_under( $resolved, $absolute_root ) || ( ! $is_write && $this->is_path_under( $resolved, $dialog_path ) ) ) {
					return $resolved;
				}
			}

			return $normalized_input;
		}

		$relative = $this->normalize_relative_path( $normalized_input );

		if ( $is_write ) {
			return wp_normalize_path( $dialog_path . '/' . $relative );
		}

		$joined   = $this->resolve_read_path( $relative );
		$resolved = realpath( $joined );

		return $resolved !== false ? wp_normalize_path( $resolved ) : $joined;
	}

	/**
	 * Validate and normalize file path for security.
	 * Prevents path traversal attacks and restricts operations to allowed directories.
	 *
	 * @param string $path Requested file path
	 * @param string $operation 'read' | 'write' | 'delete'
	 * @return array{valid: bool, normalized_path: string, error: string|null}
	 */
	private function validate_file_path( string $path, string $operation = 'read' ): array {
		$path = trim( $path );
		if ( empty( $path ) ) {
			return [
				'valid'           => false,
				'normalized_path' => '',
				'error'           => 'Empty path provided',
			];
		}

		$path = $this->resolve_requested_path( $path, $operation );

		// Convert to absolute path and resolve symlinks
		$real_path = realpath( $path );
		if ( $real_path === false ) {
			// Path doesn't exist - check if parent exists for write operations
			if ( in_array( $operation, [ 'write', 'create' ], true ) ) {
				$parent_dir = dirname( $path );
				$real_parent = realpath( $parent_dir );
				if ( $real_parent === false && wp_mkdir_p( $parent_dir ) ) {
					$real_parent = realpath( $parent_dir );
				}
				if ( $real_parent === false ) {
					return [
						'valid'           => false,
						'normalized_path' => '',
						'error'           => 'Parent directory does not exist: ' . $parent_dir,
					];
				}
				$real_path = $real_parent . DIRECTORY_SEPARATOR . basename( $path );
			} else {
				return [
					'valid'           => false,
					'normalized_path' => '',
					'error'           => 'File or directory does not exist: ' . $path,
				];
			}
		}

		$normalized_path = wp_normalize_path( $real_path );

		// Get allowed paths based on operation
		$allowed_paths = $this->get_allowed_paths( $operation );
		$is_allowed    = false;

		foreach ( $allowed_paths as $allowed_path ) {
			if ( $this->is_path_under( $normalized_path, $allowed_path ) ) {
				$is_allowed = true;
				break;
			}
		}

		if ( ! $is_allowed ) {
			return [
				'valid'           => false,
				'normalized_path' => $normalized_path,
				'error'           => sprintf( 
					'Path not allowed for %s operation: %s', 
					$operation, 
					$normalized_path 
				),
			];
		}

		return [
			'valid'           => true,
			'normalized_path' => $normalized_path,
			'error'           => null,
		];
	}

	/**
	 * Get allowed paths based on operation type.
	 *
	 * @param string $operation
	 * @return array<string>
	 */
	private function get_allowed_paths( string $operation ): array {
		$wordpress_root = $this->get_wordpress_root();

		switch ( $operation ) {
			case 'read':
				return [ $wordpress_root ];

			case 'write':
			case 'create':
			case 'append':
			case 'delete':
				$child_theme = $this->get_child_theme_root();
				return $child_theme !== '' ? [ $child_theme ] : [];

			default:
				return [];
		}
	}

	/**
	 * Default read/search scope: entire WordPress install.
	 *
	 * @return string
	 */
	private function get_default_read_scope(): string {
		return $this->get_wordpress_root();
	}

	// =============================================
	// File System Handlers
	// =============================================

	/**
	 * POST /DialogStudio/v1/file/read
	 */
	private function handle_file_read(): array {
		$this->require_chat_user();

		$body = $this->get_json_body();
		$path = sanitize_text_field( (string) ( $body['path'] ?? '' ) );

		$validation = $this->validate_file_path( $path, 'read' );
		if ( ! $validation['valid'] ) {
			return [
				'success' => false,
				'data' => null,
				'error' => $validation['error'],
			];
		}

		$file_path = $validation['normalized_path'];

		if ( ! is_file( $file_path ) || ! is_readable( $file_path ) ) {
			return [
				'success' => false,
				'data' => null,
				'error' => 'File is not readable: ' . basename( $file_path ),
			];
		}

		// Check file size (max 5MB for safety)
		$file_size = filesize( $file_path );
		if ( $file_size > 5 * 1024 * 1024 ) {
			return [
				'success' => false,
				'data' => null,
				'error' => 'File too large (max 5MB): ' . basename( $file_path ),
			];
		}

		$content = file_get_contents( $file_path );
		if ( $content === false ) {
			return [
				'success' => false,
				'data' => null,
				'error' => 'Failed to read file: ' . basename( $file_path ),
			];
		}

		[ $lines ] = $this->split_content_lines( $content );
		$total_lines = count( $lines );
		$start_line  = (int) ( $body['start_line'] ?? 0 );
		$end_line    = (int) ( $body['end_line'] ?? 0 );
		$range_requested = $start_line > 0 || $end_line > 0;

		if ( $range_requested ) {
			if ( $start_line < 1 ) {
				$start_line = 1;
			}

			if ( $end_line < 1 || $end_line < $start_line ) {
				$end_line = $start_line;
			}

			if ( $start_line > $total_lines ) {
				return [
					'success' => false,
					'data' => null,
					'error' => sprintf(
						'start_line %d is beyond file length (%d lines)',
						$start_line,
						$total_lines
					),
				];
			}

			$end_line = min( $end_line, $total_lines );
			$slice    = array_slice( $lines, $start_line - 1, $end_line - $start_line + 1 );
			$content  = implode( "\n", $slice );
		}

		return [
			'success' => true,
			'data' => [
				'path' => $path,
				'content' => $content,
				'line_count' => $total_lines,
				'start_line' => $range_requested ? $start_line : null,
				'end_line' => $range_requested ? $end_line : null,
				'size' => $file_size,
				'modified' => filemtime( $file_path ),
			],
			'error' => null,
		];
	}

	/**
	 * POST /DialogStudio/v1/file/write
	 */
	private function handle_file_write(): array {
		$this->require_chat_user();

		// Check permissions
		$settings = $this->get_settings();
		if ( empty( $settings['permissions']['write_files'] ) ) {
			return [
				'success' => false,
				'data' => null,
				'error' => 'File write permission denied',
			];
		}

		$body = $this->get_json_body();
		$path = sanitize_text_field( (string) ( $body['path'] ?? '' ) );
		$content = (string) ( $body['content'] ?? '' );
		$mode = sanitize_text_field( (string) ( $body['mode'] ?? 'create' ) );

		$theme_error = $this->get_dialog_workspace_write_error();
		if ( $theme_error !== null ) {
			return [
				'success' => false,
				'data' => null,
				'error' => $theme_error,
			];
		}

		$validation = $this->validate_file_path( $path, 'write' );
		if ( ! $validation['valid'] ) {
			return [
				'success' => false,
				'data' => null,
				'error' => $validation['error'],
			];
		}

		$file_path = $validation['normalized_path'];

		// Check if file exists and mode
		if ( $mode === 'create' && file_exists( $file_path ) ) {
			return [
				'success' => false,
				'data' => null,
				'error' => 'File already exists: ' . basename( $file_path ),
			];
		}

		// Ensure parent directory exists
		$parent_dir = dirname( $file_path );
		if ( ! is_dir( $parent_dir ) ) {
			if ( ! wp_mkdir_p( $parent_dir ) ) {
				return [
					'success' => false,
					'data' => null,
					'error' => 'Failed to create directory: ' . basename( $parent_dir ),
				];
			}
		}

		// Write file
		$bytes_written = file_put_contents( $file_path, $content );
		if ( $bytes_written === false ) {
			return [
				'success' => false,
				'data' => null,
				'error' => 'Failed to write file: ' . basename( $file_path ),
			];
		}

		return [
			'success' => true,
			'data' => array_merge(
				[
					'path' => $path,
					'bytes_written' => $bytes_written,
					'size' => filesize( $file_path ),
					'modified' => filemtime( $file_path ),
				],
				[
					'code_validation' => $this->validate_saved_file( $file_path, $path ),
				]
			),
			'error' => null,
		];
	}

	/**
	 * POST /DialogStudio/v1/file/edit
	 *
	 * Replace a 1-indexed inclusive line range inside an existing dialog theme file.
	 */
	private function handle_file_edit(): array {
		$this->require_chat_user();

		$settings = $this->get_settings();
		if ( empty( $settings['permissions']['write_files'] ) ) {
			return [
				'success' => false,
				'data' => null,
				'error' => 'File write permission denied',
			];
		}

		$body        = $this->get_json_body();
		$path        = sanitize_text_field( (string) ( $body['path'] ?? '' ) );
		$start_line  = (int) ( $body['start_line'] ?? 0 );
		$end_line    = (int) ( $body['end_line'] ?? 0 );
		$new_content = (string) ( $body['content'] ?? '' );

		if ( $start_line < 1 || $end_line < 1 ) {
			return [
				'success' => false,
				'data' => null,
				'error' => 'start_line and end_line must be positive integers (1-indexed)',
			];
		}

		if ( $end_line < $start_line ) {
			return [
				'success' => false,
				'data' => null,
				'error' => 'end_line must be greater than or equal to start_line',
			];
		}

		$theme_error = $this->get_dialog_workspace_write_error();
		if ( $theme_error !== null ) {
			return [
				'success' => false,
				'data' => null,
				'error' => $theme_error,
			];
		}


		$validation = $this->validate_file_path( $path, 'write' );
		if ( ! $validation['valid'] ) {
			return [
				'success' => false,
				'data' => null,
				'error' => $validation['error'],
			];
		}

		$file_path = $validation['normalized_path'];

		if ( ! is_file( $file_path ) || ! is_readable( $file_path ) ) {
			return [
				'success' => false,
				'data' => null,
				'error' => 'File does not exist or is not readable: ' . basename( $file_path ),
			];
		}

		$original_content = file_get_contents( $file_path );
		if ( $original_content === false ) {
			return [
				'success' => false,
				'data' => null,
				'error' => 'Failed to read file: ' . basename( $file_path ),
			];
		}

		[ $lines, $line_ending, $trailing_newline ] = $this->split_content_lines( $original_content );

		$total_lines = count( $lines );
		if ( $start_line > $total_lines || $end_line > $total_lines ) {
			return [
				'success' => false,
				'data' => null,
				'error' => sprintf(
					'Line range %d-%d is out of bounds (file has %d lines)',
					$start_line,
					$end_line,
					$total_lines
				),
			];
		}

		$replacement_lines = $this->split_replacement_lines( $new_content );

		$lines_removed = $end_line - $start_line + 1;
		$before        = array_slice( $lines, 0, $start_line - 1 );
		$after         = array_slice( $lines, $end_line );
		$updated_lines = array_merge( $before, $replacement_lines, $after );
		$updated_content = $this->join_content_lines( $updated_lines, $line_ending, $trailing_newline );

		if ( ! mb_check_encoding( $updated_content, 'UTF-8' ) ) {
			return [
				'success' => false,
				'data' => null,
				'error' => 'Edit would produce invalid UTF-8 in: ' . basename( $file_path ),
			];
		}

		$bytes_written = file_put_contents( $file_path, $updated_content );
		if ( $bytes_written === false ) {
			return [
				'success' => false,
				'data' => null,
				'error' => 'Failed to write file: ' . basename( $file_path ),
			];
		}

		return [
			'success' => true,
			'data' => array_merge(
				[
					'path' => $path,
					'start_line' => $start_line,
					'end_line' => $end_line,
					'lines_removed' => $lines_removed,
					'lines_added' => count( $replacement_lines ),
					'total_lines' => count( $updated_lines ),
					'bytes_written' => $bytes_written,
					'size' => filesize( $file_path ),
					'modified' => filemtime( $file_path ),
				],
				[
					'code_validation' => $this->validate_saved_file( $file_path, $path ),
				]
			),
			'error' => null,
		];
	}

	/**
	 * POST /DialogStudio/v1/file/append
	 */
	private function handle_file_append(): array {
		$this->require_chat_user();

		// Check permissions
		$settings = $this->get_settings();
		if ( empty( $settings['permissions']['write_files'] ) ) {
			return [
				'success' => false,
				'data' => null,
				'error' => 'File write permission denied',
			];
		}

		$body = $this->get_json_body();
		$path = sanitize_text_field( (string) ( $body['path'] ?? '' ) );
		$content = (string) ( $body['content'] ?? '' );

		$theme_error = $this->get_dialog_workspace_write_error();
		if ( $theme_error !== null ) {
			return [
				'success' => false,
				'data' => null,
				'error' => $theme_error,
			];
		}

		$validation = $this->validate_file_path( $path, 'write' );
		if ( ! $validation['valid'] ) {
			return [
				'success' => false,
				'data' => null,
				'error' => $validation['error'],
			];
		}

		$file_path = $validation['normalized_path'];

		if ( ! file_exists( $file_path ) ) {
			return [
				'success' => false,
				'data' => null,
				'error' => 'File does not exist: ' . basename( $file_path ),
			];
		}

		// Append content
		$bytes_written = file_put_contents( $file_path, $content, FILE_APPEND );
		if ( $bytes_written === false ) {
			return [
				'success' => false,
				'data' => null,
				'error' => 'Failed to append to file: ' . basename( $file_path ),
			];
		}

		return [
			'success' => true,
			'data' => [
				'path' => $path,
				'bytes_appended' => $bytes_written,
				'size' => filesize( $file_path ),
				'modified' => filemtime( $file_path ),
			],
			'error' => null,
		];
	}

	/**
	 * POST /DialogStudio/v1/file/delete
	 */
	private function handle_file_delete(): array {
		$this->require_chat_user();

		// Check permissions
		$settings = $this->get_settings();
		if ( empty( $settings['permissions']['write_files'] ) ) {
			return [
				'success' => false,
				'data' => null,
				'error' => 'File delete permission denied',
			];
		}

		$body = $this->get_json_body();
		$path = sanitize_text_field( (string) ( $body['path'] ?? '' ) );

		$theme_error = $this->get_dialog_workspace_write_error();
		if ( $theme_error !== null ) {
			return [
				'success' => false,
				'data' => null,
				'error' => $theme_error,
			];
		}

		$validation = $this->validate_file_path( $path, 'delete' );
		if ( ! $validation['valid'] ) {
			return [
				'success' => false,
				'data' => null,
				'error' => $validation['error'],
			];
		}

		$file_path = $validation['normalized_path'];

		if ( ! file_exists( $file_path ) ) {
			return [
				'success' => false,
				'data' => null,
				'error' => 'File does not exist: ' . basename( $file_path ),
			];
		}

		if ( ! is_file( $file_path ) ) {
			return [
				'success' => false,
				'data' => null,
				'error' => 'Path is not a file: ' . basename( $file_path ),
			];
		}

		// Delete file
		if ( ! unlink( $file_path ) ) {
			return [
				'success' => false,
				'data' => null,
				'error' => 'Failed to delete file: ' . basename( $file_path ),
			];
		}

		return [
			'success' => true,
			'data' => [
				'path' => $path,
				'deleted' => true,
			],
			'error' => null,
		];
	}

	/**
	 * POST /DialogStudio/v1/file/list
	 */
	private function handle_file_list(): array {
		$this->require_chat_user();

		$body = $this->get_json_body();
		$path = sanitize_text_field( (string) ( $body['path'] ?? '' ) );
		$recursive = ! empty( $body['recursive'] );
		$include_hidden = ! empty( $body['include_hidden'] );

		// Default to child theme root if no path provided
		if ( empty( $path ) ) {
			$path = $this->get_child_theme_root();
			if ( $path === '' || ! is_dir( $path ) ) {
				return [
					'success' => false,
					'data'    => null,
					'error'   => 'پوشه child theme یافت نشد. ابتدا child theme را راه‌اندازی کنید.',
				];
			}
		}

		$validation = $this->validate_file_path( $path, 'read' );
		if ( ! $validation['valid'] ) {
			return [
				'success' => false,
				'data' => null,
				'error' => $validation['error'],
			];
		}

		$dir_path = $validation['normalized_path'];

		if ( ! is_dir( $dir_path ) || ! is_readable( $dir_path ) ) {
			return [
				'success' => false,
				'data' => null,
				'error' => 'Directory is not readable: ' . basename( $dir_path ),
			];
		}

		$files = [];
		$this->scan_directory( $dir_path, $files, $recursive, $include_hidden );

		return [
			'success' => true,
			'data' => [
				'path' => $path,
				'files' => $files,
				'count' => count( $files ),
			],
			'error' => null,
		];
	}

	/**
	 * Recursively scan directory for files.
	 *
	 * @param string $dir_path
	 * @param array $files
	 * @param bool $recursive
	 * @param bool $include_hidden
	 */
	private function scan_directory( string $dir_path, array &$files, bool $recursive = true, bool $include_hidden = false ): void {
		$items = scandir( $dir_path );
		if ( $items === false ) {
			return;
		}

		foreach ( $items as $item ) {
			if ( $item === '.' || $item === '..' ) {
				continue;
			}

			if ( ! $include_hidden && strpos( $item, '.' ) === 0 ) {
				continue;
			}

			$item_path = $dir_path . DIRECTORY_SEPARATOR . $item;

			if ( is_file( $item_path ) ) {
				$files[] = [
					'name' => $item,
					'path' => wp_normalize_path( $item_path ),
					'type' => 'file',
					'size' => filesize( $item_path ),
					'modified' => filemtime( $item_path ),
					'extension' => pathinfo( $item, PATHINFO_EXTENSION ),
				];
			} elseif ( is_dir( $item_path ) && $recursive ) {
				$files[] = [
					'name' => $item,
					'path' => wp_normalize_path( $item_path ),
					'type' => 'directory',
					'size' => null,
					'modified' => filemtime( $item_path ),
					'extension' => null,
				];

				$this->scan_directory( $item_path, $files, $recursive, $include_hidden );
			}
		}
	}

	// =============================================
	// Directory Handlers
	// =============================================

	/**
	 * POST /DialogStudio/v1/directory/create
	 */
	private function handle_directory_create(): array {
		$this->require_chat_user();

		// Check permissions
		$settings = $this->get_settings();
		if ( empty( $settings['permissions']['write_files'] ) ) {
			return [
				'success' => false,
				'data' => null,
				'error' => 'Directory create permission denied',
			];
		}

		$body = $this->get_json_body();
		$path = sanitize_text_field( (string) ( $body['path'] ?? '' ) );
		$recursive = ! empty( $body['recursive'] );

		$theme_error = $this->get_dialog_workspace_write_error();
		if ( $theme_error !== null ) {
			return [
				'success' => false,
				'data' => null,
				'error' => $theme_error,
			];
		}

		$validation = $this->validate_file_path( $path, 'create' );
		if ( ! $validation['valid'] ) {
			return [
				'success' => false,
				'data' => null,
				'error' => $validation['error'],
			];
		}

		$dir_path = $validation['normalized_path'];

		if ( is_dir( $dir_path ) ) {
			return [
				'success' => false,
				'data' => null,
				'error' => 'Directory already exists: ' . basename( $dir_path ),
			];
		}

		// Create directory
		$success = $recursive ? wp_mkdir_p( $dir_path ) : mkdir( $dir_path );
		if ( ! $success ) {
			return [
				'success' => false,
				'data' => null,
				'error' => 'Failed to create directory: ' . basename( $dir_path ),
			];
		}

		return [
			'success' => true,
			'data' => [
				'path' => $path,
				'created' => true,
				'recursive' => $recursive,
			],
			'error' => null,
		];
	}

	/**
	 * POST /DialogStudio/v1/directory/delete
	 */
	private function handle_directory_delete(): array {
		$this->require_chat_user();

		// Check permissions
		$settings = $this->get_settings();
		if ( empty( $settings['permissions']['write_files'] ) ) {
			return [
				'success' => false,
				'data' => null,
				'error' => 'Directory delete permission denied',
			];
		}

		$body = $this->get_json_body();
		$path = sanitize_text_field( (string) ( $body['path'] ?? '' ) );
		$recursive = ! empty( $body['recursive'] );

		$theme_error = $this->get_dialog_workspace_write_error();
		if ( $theme_error !== null ) {
			return [
				'success' => false,
				'data' => null,
				'error' => $theme_error,
			];
		}

		$validation = $this->validate_file_path( $path, 'delete' );
		if ( ! $validation['valid'] ) {
			return [
				'success' => false,
				'data' => null,
				'error' => $validation['error'],
			];
		}

		$dir_path = $validation['normalized_path'];

		if ( ! is_dir( $dir_path ) ) {
			return [
				'success' => false,
				'data' => null,
				'error' => 'Directory does not exist: ' . basename( $dir_path ),
			];
		}

		// Check if directory is empty (unless recursive)
		if ( ! $recursive ) {
			$items = scandir( $dir_path );
			if ( $items === false || count( $items ) > 2 ) { // . and ..
				return [
					'success' => false,
					'data' => null,
					'error' => 'Directory is not empty (use recursive option): ' . basename( $dir_path ),
				];
			}
		}

		// Delete directory
		$success = $recursive ? $this->recursive_rmdir( $dir_path ) : rmdir( $dir_path );
		if ( ! $success ) {
			return [
				'success' => false,
				'data' => null,
				'error' => 'Failed to delete directory: ' . basename( $dir_path ),
			];
		}

		return [
			'success' => true,
			'data' => [
				'path' => $path,
				'deleted' => true,
				'recursive' => $recursive,
			],
			'error' => null,
		];
	}

	/**
	 * POST /DialogStudio/v1/directory/list
	 */
	private function handle_directory_list(): array {
		return $this->handle_file_list(); // Same implementation
	}

	/**
	 * Recursively delete directory and its contents.
	 */
	private function recursive_rmdir( string $dir_path ): bool {
		if ( ! is_dir( $dir_path ) ) {
			return false;
		}

		$items = scandir( $dir_path );
		if ( $items === false ) {
			return false;
		}

		foreach ( $items as $item ) {
			if ( $item === '.' || $item === '..' ) {
				continue;
			}

			$item_path = $dir_path . DIRECTORY_SEPARATOR . $item;

			if ( is_dir( $item_path ) ) {
				if ( ! $this->recursive_rmdir( $item_path ) ) {
					return false;
				}
			} else {
				if ( ! unlink( $item_path ) ) {
					return false;
				}
			}
		}

		return rmdir( $dir_path );
	}

	// =============================================
	// Search Tools (Multi-Keyword Support)
	// =============================================

	/**
	 * POST /DialogStudio/v1/search/files
	 * 
	 * Search files by name with multi-keyword support
	 */
	private function handle_search_files(): array {
		$this->require_chat_user();

		$body = $this->get_json_body();
		$keywords = (array) ( $body['keywords'] ?? [] );
		$directory = sanitize_text_field( (string) ( $body['directory'] ?? '' ) );
		$operator = sanitize_text_field( (string) ( $body['operator'] ?? 'AND' ) );
		$case_sensitive = ! empty( $body['case_sensitive'] );
		$extensions = (array) ( $body['extensions'] ?? [] );
		$max_results = max( 1, min( 100, (int) ( $body['max_results'] ?? 30 ) ) );

		// Validate keywords
		if ( empty( $keywords ) ) {
			return [
				'success' => false,
				'data' => null,
				'error' => 'At least one keyword is required',
			];
		}

		// Sanitize keywords
		$keywords = array_map( 'sanitize_text_field', array_filter( $keywords ) );
		if ( empty( $keywords ) ) {
			return [
				'success' => false,
				'data' => null,
				'error' => 'No valid keywords provided',
			];
		}

		// Default to child theme workspace if no directory provided
		if ( empty( $directory ) ) {
			$directory = $this->get_dialog_workspace_relative_scope();
		}

		$validation = $this->validate_file_path( $directory, 'read' );
		if ( ! $validation['valid'] ) {
			return [
				'success' => false,
				'data' => null,
				'error' => $validation['error'],
			];
		}

		$search_path = $validation['normalized_path'];

		if ( ! is_dir( $search_path ) || ! is_readable( $search_path ) ) {
			return [
				'success' => false,
				'data' => null,
				'error' => 'Directory is not readable: ' . basename( $search_path ),
			];
		}

		$results = $this->search_files_by_keywords(
			$search_path,
			$keywords,
			$operator, 
			$case_sensitive, 
			$extensions, 
			$max_results 
		);

		return [
			'success' => true,
			'data' => [
				'keywords' => $keywords,
				'directory' => $directory,
				'operator' => $operator,
				'results' => $results,
				'count' => count( $results ),
				'truncated' => count( $results ) >= $max_results,
			],
			'error' => null,
		];
	}

	/**
	 * POST /DialogStudio/v1/search/content
	 * 
	 * Search text content in files with multi-keyword support
	 */
	private function handle_search_content(): array {
		$this->require_chat_user();

		$body = $this->get_json_body();
		$keywords = (array) ( $body['keywords'] ?? [] );
		$path = sanitize_text_field( (string) ( $body['path'] ?? '' ) );
		$operator = sanitize_text_field( (string) ( $body['operator'] ?? 'OR' ) );
		$case_sensitive = ! empty( $body['case_sensitive'] );
		$context_lines = max( 0, min( 10, (int) ( $body['context_lines'] ?? 2 ) ) );
		$max_results = max( 1, min( 100, (int) ( $body['max_results'] ?? 20 ) ) );
		$extensions = (array) ( $body['extensions'] ?? [ 'php', 'js', 'css', 'html', 'txt', 'json', 'md' ] );

		// Validate keywords
		if ( empty( $keywords ) ) {
			return [
				'success' => false,
				'data' => null,
				'error' => 'At least one keyword is required',
			];
		}

		// Sanitize keywords
		$keywords = array_map( 'sanitize_text_field', array_filter( $keywords ) );
		if ( empty( $keywords ) ) {
			return [
				'success' => false,
				'data' => null,
				'error' => 'No valid keywords provided',
			];
		}

		// Default to child theme workspace if no path provided
		if ( empty( $path ) ) {
			$path = $this->get_dialog_workspace_relative_scope();
		}

		$validation = $this->validate_file_path( $path, 'read' );
		if ( ! $validation['valid'] ) {
			return [
				'success' => false,
				'data' => null,
				'error' => $validation['error'],
			];
		}

		$search_path = $validation['normalized_path'];

		if ( ! file_exists( $search_path ) || ! is_readable( $search_path ) ) {
			return [
				'success' => false,
				'data' => null,
				'error' => 'Path is not readable: ' . basename( $search_path ),
			];
		}

		$results = $this->search_content_by_keywords(
			$search_path,
			$keywords, 
			$operator, 
			$case_sensitive, 
			$context_lines, 
			$extensions, 
			$max_results 
		);

		return [
			'success' => true,
			'data' => [
				'keywords' => $keywords,
				'path' => $path,
				'operator' => $operator,
				'results' => $results,
				'count' => count( $results ),
				'truncated' => count( $results ) >= $max_results,
			],
			'error' => null,
		];
	}

	/**
	 * Search files by keywords with AND/OR logic.
	 *
	 * @param string $directory
	 * @param array $keywords
	 * @param string $operator 'AND' | 'OR'
	 * @param bool $case_sensitive
	 * @param array $extensions
	 * @param int $max_results
	 * @return array
	 */
	private function search_files_by_keywords( 
		string $directory, 
		array $keywords, 
		string $operator = 'AND', 
		bool $case_sensitive = false, 
		array $extensions = [], 
		int $max_results = 100 
	): array {
		$results = [];
		$count = 0;

		$iterator = new \RecursiveIteratorIterator(
			new \RecursiveDirectoryIterator( $directory, \RecursiveDirectoryIterator::SKIP_DOTS ),
			\RecursiveIteratorIterator::LEAVES_ONLY
		);

		foreach ( $iterator as $file ) {
			if ( $count >= $max_results ) {
				break;
			}

			if ( ! $file->isFile() || ! $file->isReadable() ) {
				continue;
			}

			$file_path = $file->getPathname();
			$file_name = $file->getFilename();
			$extension = $file->getExtension();

			// Filter by extension if specified
			if ( ! empty( $extensions ) && ! in_array( strtolower( $extension ), array_map( 'strtolower', $extensions ), true ) ) {
				continue;
			}

			// Check filename against keywords
			$search_text = $case_sensitive ? $file_name : strtolower( $file_name );
			$search_keywords = $case_sensitive ? $keywords : array_map( 'strtolower', $keywords );

			$matches = [];
			foreach ( $search_keywords as $keyword ) {
				$keyword_found = strpos( $search_text, $keyword ) !== false;
				$matches[] = $keyword_found;
			}

			// Apply operator logic
			$file_matches = false;
			if ( $operator === 'AND' ) {
				$file_matches = ! in_array( false, $matches, true );
			} elseif ( $operator === 'OR' ) {
				$file_matches = in_array( true, $matches, true );
			}

			if ( $file_matches ) {
				$results[] = [
					'path' => wp_normalize_path( $file_path ),
					'name' => $file_name,
					'directory' => wp_normalize_path( dirname( $file_path ) ),
					'extension' => $extension,
					'size' => $file->getSize(),
					'modified' => $file->getMTime(),
					'matches' => $this->get_keyword_matches( $search_text, $search_keywords ),
				];
				$count++;
			}
		}

		return $results;
	}

	/**
	 * Search content in files by keywords.
	 *
	 * @param string $path
	 * @param array $keywords
	 * @param string $operator
	 * @param bool $case_sensitive
	 * @param int $context_lines
	 * @param array $extensions
	 * @param int $max_results
	 * @return array
	 */
	private function search_content_by_keywords(
		string $path,
		array $keywords,
		string $operator = 'AND',
		bool $case_sensitive = false,
		int $context_lines = 2,
		array $extensions = [],
		int $max_results = 100
	): array {
		$results = [];
		$count = 0;

		$files_to_search = [];

		if ( is_file( $path ) ) {
			$files_to_search[] = new \SplFileInfo( $path );
		} elseif ( is_dir( $path ) ) {
			$iterator = new \RecursiveIteratorIterator(
				new \RecursiveDirectoryIterator( $path, \RecursiveDirectoryIterator::SKIP_DOTS ),
				\RecursiveIteratorIterator::LEAVES_ONLY
			);

			foreach ( $iterator as $file ) {
				$files_to_search[] = $file;
			}
		}

		foreach ( $files_to_search as $file ) {
			if ( $count >= $max_results ) {
				break;
			}

			if ( ! $file->isFile() || ! $file->isReadable() ) {
				continue;
			}

			$file_path = $file->getPathname();
			$file_name = $file->getFilename();
			$extension = $file->getExtension();

			// Filter by extension if specified
			if ( ! empty( $extensions ) && ! in_array( strtolower( $extension ), array_map( 'strtolower', $extensions ), true ) ) {
				continue;
			}

			// Skip binary files and large files
			if ( $file->getSize() > 10 * 1024 * 1024 ) { // 10MB limit
				continue;
			}

			$content = file_get_contents( $file_path );
			if ( $content === false ) {
				continue;
			}

			// Check if file is binary (contains null bytes)
			if ( strpos( $content, "\0" ) !== false ) {
				continue;
			}

			$matches = $this->find_content_matches( $content, $keywords, $operator, $case_sensitive, $context_lines, 15 );

			if ( ! empty( $matches ) ) {
				$results[] = [
					'path' => wp_normalize_path( $file_path ),
					'name' => $file_name,
					'directory' => wp_normalize_path( dirname( $file_path ) ),
					'extension' => $extension,
					'size' => $file->getSize(),
					'modified' => $file->getMTime(),
					'matches' => $matches,
					'match_count' => count( $matches ),
					'matches_truncated' => count( $matches ) >= 15,
				];
				$count++;
			}
		}

		return $results;
	}

	/**
	 * Find matches in file content with context.
	 *
	 * @param string $content
	 * @param array $keywords
	 * @param string $operator
	 * @param bool $case_sensitive
	 * @param int $context_lines
	 * @return array
	 */
	private function find_content_matches(
		string $content,
		array $keywords,
		string $operator = 'AND',
		bool $case_sensitive = false,
		int $context_lines = 2,
		int $max_matches_per_file = 15
	): array {
		[ $lines ] = $this->split_content_lines( $content );
		$matches = [];

		$search_keywords = $case_sensitive ? $keywords : array_map( 'strtolower', $keywords );

		foreach ( $lines as $line_number => $line ) {
			if ( count( $matches ) >= $max_matches_per_file ) {
				break;
			}

			$search_line = $case_sensitive ? $line : strtolower( $line );

			$keyword_matches = [];
			foreach ( $search_keywords as $keyword ) {
				$pos = strpos( $search_line, $keyword );
				$keyword_matches[] = $pos !== false;
			}

			// Apply operator logic
			$line_matches = false;
			if ( $operator === 'AND' ) {
				$line_matches = ! in_array( false, $keyword_matches, true );
			} elseif ( $operator === 'OR' ) {
				$line_matches = in_array( true, $keyword_matches, true );
			}

			if ( $line_matches ) {
				// Get context lines
				$start = max( 0, $line_number - $context_lines );
				$end = min( count( $lines ) - 1, $line_number + $context_lines );

				$context = [];
				for ( $i = $start; $i <= $end; $i++ ) {
					$context[] = [
						'line_number' => $i + 1, // 1-based line numbers
						'content' => $lines[ $i ],
						'is_match' => $i === $line_number,
					];
				}

				$matches[] = [
					'line_number' => $line_number + 1, // 1-based
					'line_content' => $line,
					'context' => $context,
					'keywords_found' => $this->get_keyword_matches( $search_line, $search_keywords ),
				];
			}
		}

		return $matches;
	}

	/**
	 * Get list of keywords that matched in the given text.
	 *
	 * @param string $text
	 * @param array $keywords
	 * @return array
	 */
	private function get_keyword_matches( string $text, array $keywords ): array {
		$matches = [];

		foreach ( $keywords as $keyword ) {
			if ( strpos( $text, $keyword ) !== false ) {
				$matches[] = $keyword;
			}
		}

		return $matches;
	}

	// =============================================
	// WordPress Debugger Tools
	// =============================================

	/**
	 * POST /DialogStudio/v1/debug/toggle
	 * 
	 * Enable/disable WordPress debug mode
	 */
	private function handle_debug_toggle(): array {
		$this->require_chat_user();

		// Check permissions
		$settings = $this->get_settings();
		if ( empty( $settings['permissions']['debugger'] ) ) {
			return [
				'success' => false,
				'data' => null,
				'error' => 'Debugger permission denied',
			];
		}

		$body = $this->get_json_body();
		$debug = ! empty( $body['debug'] );
		$debug_log = ! empty( $body['debug_log'] );
		$debug_display = ! empty( $body['debug_display'] );

		$wp_config_path = $this->get_wp_config_path();
		if ( ! $wp_config_path ) {
			return [
				'success' => false,
				'data' => null,
				'error' => 'wp-config.php not found or not writable',
			];
		}

		$result = $this->update_wp_debug_constants( $wp_config_path, $debug, $debug_log, $debug_display );

		if ( ! $result['success'] ) {
			return [
				'success' => false,
				'data' => null,
				'error' => $result['error'],
			];
		}

		return [
			'success' => true,
			'data' => [
				'debug' => $debug,
				'debug_log' => $debug_log,
				'debug_display' => $debug_display,
				'current_values' => $this->get_current_debug_values(),
			],
			'error' => null,
		];
	}

	/**
	 * GET /DialogStudio/v1/debug/log
	 * 
	 * Read WordPress debug.log file
	 */
	private function handle_debug_log(): array {
		$this->require_chat_user();

		// Check permissions
		$settings = $this->get_settings();
		if ( empty( $settings['permissions']['debugger'] ) ) {
			return [
				'success' => false,
				'data' => null,
				'error' => 'Debugger permission denied',
			];
		}

		$lines = max( 1, min( 10000, (int) ( $_GET['lines'] ?? 100 ) ) );

		$log_file = $this->get_debug_log_path();
		if ( ! $log_file || ! is_file( $log_file ) || ! is_readable( $log_file ) ) {
			return [
				'success' => false,
				'data' => null,
				'error' => 'Debug log file not found or not readable',
			];
		}

		// Get file size for large file handling
		$file_size = filesize( $log_file );
		if ( $file_size > 50 * 1024 * 1024 ) { // 50MB limit
			return [
				'success' => false,
				'data' => null,
				'error' => 'Debug log file too large (max 50MB)',
			];
		}

		// Read last N lines efficiently
		$content = $this->read_last_lines( $log_file, $lines );

		return [
			'success' => true,
			'data' => [
				'content' => $content,
				'file_size' => $file_size,
				'file_path' => $log_file,
				'lines_requested' => $lines,
				'modified' => filemtime( $log_file ),
			],
			'error' => null,
		];
	}

	/**
	 * POST /DialogStudio/v1/debug/clear
	 * 
	 * Clear debug.log file content
	 */
	private function handle_debug_clear(): array {
		$this->require_chat_user();

		// Check permissions
		$settings = $this->get_settings();
		if ( empty( $settings['permissions']['debugger'] ) ) {
			return [
				'success' => false,
				'data' => null,
				'error' => 'Debugger permission denied',
			];
		}

		$log_file = $this->get_debug_log_path();
		if ( ! $log_file ) {
			return [
				'success' => false,
				'data' => null,
				'error' => 'Debug log file not found',
			];
		}

		// Get current file size for reference
		$old_size = is_file( $log_file ) ? filesize( $log_file ) : 0;

		// Clear the file
		$success = file_put_contents( $log_file, '' ) !== false;
		if ( ! $success ) {
			return [
				'success' => false,
				'data' => null,
				'error' => 'Failed to clear debug log file',
			];
		}

		return [
			'success' => true,
			'data' => [
				'cleared' => true,
				'previous_size' => $old_size,
				'file_path' => $log_file,
			],
			'error' => null,
		];
	}

	/**
	 * Get wp-config.php file path.
	 *
	 * @return string|false
	 */
	private function get_wp_config_path() {
		$config_file = ABSPATH . 'wp-config.php';
		if ( is_file( $config_file ) && is_writable( $config_file ) ) {
			return $config_file;
		}

		// Check parent directory
		$parent_config = dirname( ABSPATH ) . '/wp-config.php';
		if ( is_file( $parent_config ) && is_writable( $parent_config ) ) {
			return $parent_config;
		}

		return false;
	}

	/**
	 * Get debug.log file path.
	 *
	 * @return string|false
	 */
	private function get_debug_log_path() {
		// Check WP_CONTENT_DIR/debug.log
		$log_file = WP_CONTENT_DIR . '/debug.log';
		if ( is_file( $log_file ) ) {
			return $log_file;
		}

		// Check if defined custom log file
		if ( defined( 'WP_DEBUG_LOG' ) && is_string( WP_DEBUG_LOG ) ) {
			$custom_log = WP_DEBUG_LOG;
			if ( is_file( $custom_log ) ) {
				return $custom_log;
			}
		}

		// Return default path even if file doesn't exist (for creation)
		return $log_file;
	}

	/**
	 * Update WP debug constants in wp-config.php.
	 *
	 * @param string $config_path
	 * @param bool $debug
	 * @param bool $debug_log
	 * @param bool $debug_display
	 * @return array{success: bool, error: string|null}
	 */
	private function update_wp_debug_constants( string $config_path, bool $debug, bool $debug_log, bool $debug_display ): array {
		$content = file_get_contents( $config_path );
		if ( $content === false ) {
			return [
				'success' => false,
				'error' => 'Failed to read wp-config.php',
			];
		}

		// Create backup
		$backup_path = $config_path . '.dtm-backup-' . date( 'Y-m-d-H-i-s' );
		if ( ! copy( $config_path, $backup_path ) ) {
			return [
				'success' => false,
				'error' => 'Failed to create wp-config.php backup',
			];
		}

		// Debug constants to update
		$constants = [
			'WP_DEBUG' => $debug,
			'WP_DEBUG_LOG' => $debug_log,
			'WP_DEBUG_DISPLAY' => $debug_display,
		];

		$modified = false;

		foreach ( $constants as $constant => $value ) {
			$value_str = $value ? 'true' : 'false';
			
			// Pattern to match the constant definition
			$pattern = "/define\s*\(\s*['\"]" . preg_quote( $constant, '/' ) . "['\"]\s*,\s*[^)]+\s*\)\s*;/i";
			
			if ( preg_match( $pattern, $content ) ) {
				// Update existing constant
				$replacement = "define( '{$constant}', {$value_str} );";
				$content = preg_replace( $pattern, $replacement, $content );
				$modified = true;
			} else {
				// Add new constant before the "That's all, stop editing!" line
				$insert_line = "define( '{$constant}', {$value_str} );\n";
				
				if ( strpos( $content, "/* That's all, stop editing!" ) !== false ) {
					$content = str_replace(
						"/* That's all, stop editing!",
						$insert_line . "/* That's all, stop editing!",
						$content
					);
				} elseif ( strpos( $content, "<?php" ) !== false ) {
					// Insert after <?php tag
					$content = str_replace(
						"<?php\n",
						"<?php\n" . $insert_line,
						$content
					);
				} else {
					// Prepend to file
					$content = $insert_line . $content;
				}
				$modified = true;
			}
		}

		if ( ! $modified ) {
			return [
				'success' => true,
				'error' => null,
			];
		}

		// Write updated content
		if ( file_put_contents( $config_path, $content ) === false ) {
			// Restore backup
			copy( $backup_path, $config_path );
			unlink( $backup_path );
			
			return [
				'success' => false,
				'error' => 'Failed to write updated wp-config.php',
			];
		}

		// Clean up old backups (keep last 5)
		$this->cleanup_config_backups( dirname( $config_path ) );

		return [
			'success' => true,
			'error' => null,
		];
	}

	/**
	 * Get current debug constant values.
	 *
	 * @return array
	 */
	private function get_current_debug_values(): array {
		return [
			'WP_DEBUG' => defined( 'WP_DEBUG' ) ? WP_DEBUG : false,
			'WP_DEBUG_LOG' => defined( 'WP_DEBUG_LOG' ) ? WP_DEBUG_LOG : false,
			'WP_DEBUG_DISPLAY' => defined( 'WP_DEBUG_DISPLAY' ) ? WP_DEBUG_DISPLAY : false,
		];
	}

	/**
	 * Read last N lines from a file efficiently.
	 *
	 * @param string $file_path
	 * @param int $lines
	 * @return string
	 */
	private function read_last_lines( string $file_path, int $lines ): string {
		$file = fopen( $file_path, 'r' );
		if ( ! $file ) {
			return '';
		}

		// Get file size
		fseek( $file, 0, SEEK_END );
		$file_size = ftell( $file );

		if ( $file_size === 0 ) {
			fclose( $file );
			return '';
		}

		// Start from the end and work backwards
		$chunk_size = 8192;
		$pos = $file_size;
		$content = '';
		$line_count = 0;

		while ( $pos > 0 && $line_count < $lines ) {
			// Calculate chunk start position
			$chunk_start = max( 0, $pos - $chunk_size );
			$chunk_len = $pos - $chunk_start;

			// Read chunk
			fseek( $file, $chunk_start );
			$chunk = fread( $file, $chunk_len );

			// Prepend to content
			$content = $chunk . $content;

			// Count lines in current content
			$all_lines = explode( "\n", $content );
			$line_count = count( $all_lines );

			// If we have enough lines, trim and break
			if ( $line_count >= $lines ) {
				$content = implode( "\n", array_slice( $all_lines, -$lines ) );
				break;
			}

			$pos = $chunk_start;
		}

		fclose( $file );
		return trim( $content );
	}

	/**
	 * Clean up old wp-config backup files.
	 *
	 * @param string $directory
	 */
	private function cleanup_config_backups( string $directory ): void {
		$backup_files = glob( $directory . '/wp-config.php.dtm-backup-*' );
		if ( count( $backup_files ) > 5 ) {
			// Sort by modification time (oldest first)
			array_multisort( array_map( 'filemtime', $backup_files ), SORT_ASC, $backup_files );
			
			// Remove oldest files, keep last 5
			$files_to_remove = array_slice( $backup_files, 0, count( $backup_files ) - 5 );
			foreach ( $files_to_remove as $file ) {
				unlink( $file );
			}
		}
	}

	// =============================================
	// Dialog Theme & Additional Handlers
	// =============================================

	/**
	 * POST /DialogStudio/v1/theme/check
	 */
	private function handle_theme_check(): array {
		$this->require_chat_user();

		$status = $this->get_child_theme_status_for_view();

		return [
			'success' => true,
			'data'    => $status,
			'error'   => null,
		];
	}

	private function get_dialog_workspace_relative_scope(): string {
		$slug = $this->get_active_theme_slug();
		return 'wp-content/themes/' . $slug;
	}

	// =============================================
	// Child Theme Handlers
	// =============================================

	/**
	 * GET /DialogStudio/v1/theme/child-status
	 */
	private function handle_theme_child_status(): array {
		$this->require_chat_user();

		return [
			'success' => true,
			'data'    => $this->get_child_theme_status_for_view(),
			'error'   => null,
		];
	}

	/**
	 * POST /DialogStudio/v1/theme/child-setup
	 *
	 * Creates + activates a Dialog-managed child theme from the current active theme.
	 * Requires { "confirm": true } in the request body.
	 */
	private function handle_theme_child_setup(): array {
		$this->require_chat_user();

		$body    = $this->get_json_body();
		$confirm = ! empty( $body['confirm'] );

		if ( ! $confirm ) {
			return [
				'success' => false,
				'data'    => null,
				'error'   => 'تایید لازم است. مقدار confirm: true را ارسال کنید.',
			];
		}

		$current_slug = $this->get_active_theme_slug();
		$parent_slug  = $this->get_active_parent_theme_slug();

		if ( $current_slug === '' ) {
			return [
				'success' => false,
				'data'    => null,
				'error'   => 'قالب فعال یافت نشد.',
			];
		}

		// Already managed — just ensure structure.
		if ( $this->is_dialog_managed_theme() ) {
			$this->ensure_dialog_workspace();
			return [
				'success' => true,
				'data'    => array_merge( $this->get_child_theme_status_for_view(), [ 'already_managed' => true ] ),
				'error'   => null,
			];
		}

		$actual_parent = ( $parent_slug !== '' && $parent_slug !== $current_slug )
			? $parent_slug
			: $current_slug;

		$child_slug = $actual_parent . '-child';
		$child_path = wp_normalize_path( $this->get_themes_root() . '/' . $child_slug );

		// Avoid overwriting an unrelated child theme.
		if ( is_dir( $child_path ) ) {
			$existing_style = $child_path . '/style.css';
			if ( is_readable( $existing_style ) ) {
				$header = @file_get_contents( $existing_style, false, null, 0, 512 );
				if ( is_string( $header ) && strpos( $header, self::DIALOG_CHILD_MARKER ) === false ) {
					$child_slug = $actual_parent . '-dialog-child';
					$child_path = wp_normalize_path( $this->get_themes_root() . '/' . $child_slug );
				}
			}
		}

		if ( ! is_dir( $child_path ) && ! wp_mkdir_p( $child_path ) ) {
			return [
				'success' => false,
				'data'    => null,
				'error'   => 'ساخت پوشه child theme ناموفق بود: ' . $child_path,
			];
		}

		$parent_name = $this->get_theme_name_from_slug( $actual_parent );
		$child_name  = $parent_name . ' Child';

		$style_css = "/*\n" .
			"Theme Name: {$child_name}\n" .
			"Template: {$actual_parent}\n" .
			"Description: Dialog Studio child theme based on {$parent_name}.\n" .
			self::DIALOG_CHILD_MARKER . "\n" .
			"Version: 1.0.0\n" .
			"*/\n";

		if ( file_put_contents( $child_path . '/style.css', $style_css ) === false ) {
			return [
				'success' => false,
				'data'    => null,
				'error'   => 'نوشتن style.css ناموفق بود.',
			];
		}

		$functions_php = "<?php\n/**\n * Dialog Studio managed child theme.\n * This file is auto-generated — do not remove.\n */\n\nif ( ! defined( 'ABSPATH' ) ) {\n\texit;\n}\n\nadd_action( 'wp_enqueue_scripts', function() {\n\twp_enqueue_style( 'parent-style', get_template_directory_uri() . '/style.css' );\n} );\n";

		if ( file_put_contents( $child_path . '/functions.php', $functions_php ) === false ) {
			return [
				'success' => false,
				'data'    => null,
				'error'   => 'نوشتن functions.php ناموفق بود.',
			];
		}

		foreach ( [ 'assets/front/css', 'assets/front/js', 'assets/admin/css', 'assets/admin/js', 'inc' ] as $sub ) {
			$dir = $child_path . '/' . $sub;
			if ( ! is_dir( $dir ) ) {
				wp_mkdir_p( $dir );
			}
		}

		update_option( 'stylesheet', $child_slug );
		update_option( 'template', $actual_parent );
		wp_cache_delete( 'alloptions', 'options' );

		return [
			'success' => true,
			'data'    => [
				'created'     => true,
				'activated'   => true,
				'child_slug'  => $child_slug,
				'child_name'  => $child_name,
				'parent_slug' => $actual_parent,
				'child_path'  => $child_path,
			],
			'error'   => null,
		];
	}

	/**
	 * POST /DialogStudio/v1/code/graph
	 *
	 * Builds a PHP symbol registry and code graph for any directory under WordPress.
	 */
	private function handle_code_graph(): array {
		$this->require_chat_user();

		$body      = $this->get_json_body();
		$directory = sanitize_text_field( (string) ( $body['directory'] ?? '' ) );

		if ( '' === $directory ) {
			$directory = $this->get_dialog_workspace_relative_scope();
		}

		$validation = $this->validate_file_path( $directory, 'read' );
		if ( ! $validation['valid'] ) {
			return [
				'success' => false,
				'data'    => null,
				'error'   => $validation['error'],
			];
		}

		$search_path = $validation['normalized_path'];

		if ( ! is_dir( $search_path ) || ! is_readable( $search_path ) ) {
			return [
				'success' => false,
				'data'    => null,
				'error'   => 'Directory is not readable: ' . basename( $search_path ),
			];
		}

		$empty_payload = [
			'directory'   => $directory,
			'file_count'  => 0,
			'symbol_count'=> 0,
			'registry'    => [],
			'graph'       => [
				'nodes' => [],
				'edges' => [],
			],
		];

		$previous_time_limit = ini_get( 'max_execution_time' );

		try {
			if ( false !== $previous_time_limit ) {
				@set_time_limit( self::THEME_INDEX_TIME_LIMIT );
			}

			$indexer = $this->resolve_theme_code_indexer();

			if ( null === $indexer ) {
				return [
					'success' => true,
					'data'    => array_merge(
						$empty_payload,
						[ 'available' => false ]
					),
					'error'   => null,
				];
			}

			$full_index = $indexer->buildFullIndexForDirectory( $search_path, $directory );

			return [
				'success' => true,
				'data'    => [
					'available'    => ! empty( $full_index['registry'] ),
					'directory'    => $directory,
					'file_count'   => count( $full_index['files'] ),
					'symbol_count' => count( $full_index['registry'] ),
					'registry'     => $full_index['registry'],
					'graph'        => $full_index['graph'],
				],
				'error'   => null,
			];
		} catch ( \Throwable $exception ) {
			error_log(
				sprintf(
					'DialogStudio: code graph failed for %s: %s',
					$directory,
					$exception->getMessage()
				)
			);

			return [
				'success' => true,
				'data'    => array_merge(
					$empty_payload,
					[ 'available' => false ]
				),
				'error'   => null,
			];
		} finally {
			if ( false !== $previous_time_limit && '' !== $previous_time_limit ) {
				@set_time_limit( (int) $previous_time_limit );
			}
		}
	}

	/**
	 * POST /DialogStudio/v1/code/validate
	 *
	 * Validates PHP, CSS, SCSS, JS, and HTML syntax under a directory.
	 */
	private function handle_code_validate(): array {
		$this->require_chat_user();

		$body      = $this->get_json_body();
		$directory = sanitize_text_field( (string) ( $body['directory'] ?? '' ) );

		if ( '' === $directory ) {
			$directory = $this->get_dialog_workspace_relative_scope();
		}

		$validation = $this->validate_file_path( $directory, 'read' );
		if ( ! $validation['valid'] ) {
			return [
				'success' => false,
				'data'    => null,
				'error'   => $validation['error'],
			];
		}

		$search_path = $validation['normalized_path'];

		if ( ! is_dir( $search_path ) || ! is_readable( $search_path ) ) {
			return [
				'success' => false,
				'data'    => null,
				'error'   => 'Directory is not readable: ' . basename( $search_path ),
			];
		}

		$previous_time_limit = ini_get( 'max_execution_time' );

		try {
			if ( false !== $previous_time_limit ) {
				@set_time_limit( self::THEME_INDEX_TIME_LIMIT );
			}

			$validator = $this->resolve_code_validator();

			if ( null === $validator ) {
				return [
					'success' => false,
					'data'    => null,
					'error'   => 'Code validator is not available. Run composer install in the plugin directory.',
				];
			}

			$result = $validator->validateDirectory( $search_path, $directory );

			return [
				'success' => true,
				'data'    => $result,
				'error'   => null,
			];
		} catch ( \Throwable $exception ) {
			error_log(
				sprintf(
					'DialogStudio: code validate failed for %s: %s',
					$directory,
					$exception->getMessage()
				)
			);

			return [
				'success' => false,
				'data'    => null,
				'error'   => 'Code validation failed: ' . $exception->getMessage(),
			];
		} finally {
			if ( false !== $previous_time_limit && '' !== $previous_time_limit ) {
				@set_time_limit( (int) $previous_time_limit );
			}
		}
	}

	/**
	 * GET /DialogStudio/v1/theme/index
	 *
	 * Builds a compact code index (PHP, CSS, JS) for the active child theme.
	 * Failures never block chat — always returns success with an empty index on error.
	 */
	private function handle_theme_index(): array {
		$this->require_chat_user();

		$empty_index = [
			'files' => [],
		];

		$previous_time_limit = ini_get( 'max_execution_time' );

		try {
			if ( false !== $previous_time_limit ) {
				@set_time_limit( self::THEME_INDEX_TIME_LIMIT );
			}

			$indexer = $this->resolve_theme_code_indexer();

			if ( null === $indexer ) {
				return [
					'success' => true,
					'data'    => [
						'available' => false,
						'index'     => $empty_index,
					],
					'error'   => null,
				];
			}

			$index = $indexer->buildCompactIndexForDirectory(
				$this->get_dialog_workspace_root(),
				'dialog'
			);

			return [
				'success' => true,
				'data'    => [
					'available' => ! empty( $index['files'] ),
					'index'     => $index,
				],
				'error'   => null,
			];
		} catch ( \Throwable $exception ) {
			error_log(
				sprintf(
					'DialogStudio: theme index failed: %s',
					$exception->getMessage()
				)
			);

			return [
				'success' => true,
				'data'    => [
					'available' => false,
					'index'     => $empty_index,
				],
				'error'   => null,
			];
		} finally {
			if ( false !== $previous_time_limit && '' !== $previous_time_limit ) {
				@set_time_limit( (int) $previous_time_limit );
			}
		}
	}

	/**
	 * Resolve the theme code indexer from the main plugin autoloader.
	 */
	private function resolve_theme_code_indexer(): ?\DialogStudio\Service\Indexing\ThemeCodeIndexer {
		$autoload = $this->get_plugin_root() . DIRECTORY_SEPARATOR . 'vendor' . DIRECTORY_SEPARATOR . 'autoload.php';

		if ( ! is_readable( $autoload ) ) {
			error_log( 'DialogStudio: composer autoload not found for theme indexing.' );

			return null;
		}

		require_once $autoload;

		if ( ! class_exists( \DialogStudio\Service\Indexing\ThemeCodeIndexer::class ) ) {
			error_log( 'DialogStudio: ThemeCodeIndexer class not found.' );

			return null;
		}

		return new \DialogStudio\Service\Indexing\ThemeCodeIndexer();
	}

	/**
	 * Run syntax validation on a file immediately after it was saved.
	 *
	 * @return array{
	 *     valid: bool|null,
	 *     file: string,
	 *     language: string|null,
	 *     skipped: bool,
	 *     issue_count: int,
	 *     issues: list<array<string, mixed>>,
	 *     error?: string
	 * }
	 */
	private function validate_saved_file( string $file_path, string $display_path ): array {
		$validator = $this->resolve_code_validator();

		if ( null === $validator ) {
			return [
				'valid'       => null,
				'file'        => $display_path,
				'language'    => null,
				'skipped'     => true,
				'issue_count' => 0,
				'issues'      => [],
				'error'       => 'Code validator is not available. Run composer install in the plugin directory.',
			];
		}

		try {
			return $validator->validateFile( $file_path, $display_path );
		} catch ( \Throwable $exception ) {
			error_log(
				sprintf(
					'DialogStudio: post-save validation failed for %s: %s',
					$display_path,
					$exception->getMessage()
				)
			);

			return [
				'valid'       => null,
				'file'        => $display_path,
				'language'    => null,
				'skipped'     => true,
				'issue_count' => 0,
				'issues'      => [],
				'error'       => 'Validation failed: ' . $exception->getMessage(),
			];
		}
	}

	/**
	 * Resolve the code validator from the main plugin autoloader.
	 */
	private function resolve_code_validator(): ?\DialogStudio\Service\Validation\CodeValidator {
		$autoload = $this->get_plugin_root() . DIRECTORY_SEPARATOR . 'vendor' . DIRECTORY_SEPARATOR . 'autoload.php';

		if ( ! is_readable( $autoload ) ) {
			error_log( 'DialogStudio: composer autoload not found for code validation.' );

			return null;
		}

		require_once $autoload;

		if ( ! class_exists( \DialogStudio\Service\Validation\CodeValidator::class ) ) {
			error_log( 'DialogStudio: CodeValidator class not found.' );

			return null;
		}

		return new \DialogStudio\Service\Validation\CodeValidator();
	}

	// =============================================
	// WordPress Plugins & Pages
	// =============================================

	/**
	 * GET /DialogStudio/v1/plugins/list
	 */
	private function handle_plugins_list(): array {
		$this->require_chat_user();

		if ( ! function_exists( 'get_plugins' ) ) {
			require_once ABSPATH . 'wp-admin/includes/plugin.php';
		}

		$all_plugins = get_plugins();
		$plugins     = [];

		foreach ( $all_plugins as $plugin_file => $plugin_data ) {
			$plugins[] = [
				'file'           => $plugin_file,
				'slug'           => dirname( $plugin_file ) === '.' ? basename( $plugin_file, '.php' ) : dirname( $plugin_file ),
				'name'           => (string) ( $plugin_data['Name'] ?? '' ),
				'version'        => (string) ( $plugin_data['Version'] ?? '' ),
				'description'    => wp_strip_all_tags( (string) ( $plugin_data['Description'] ?? '' ) ),
				'author'         => wp_strip_all_tags( (string) ( $plugin_data['Author'] ?? '' ) ),
				'status'         => is_plugin_active( $plugin_file ) ? 'active' : 'inactive',
				'network_active' => is_multisite() && is_plugin_active_for_network( $plugin_file ),
			];
		}

		usort(
			$plugins,
			static function ( array $a, array $b ): int {
				return strcasecmp( $a['name'], $b['name'] );
			}
		);

		return [
			'success' => true,
			'data'    => [
				'plugins' => $plugins,
				'total'   => count( $plugins ),
			],
			'error'   => null,
		];
	}

	// =============================================
	// Memory Management (Agent Learning)
	// =============================================

	/**
	 * GET /DialogStudio/v1/memory/read
	 */
	private function handle_memory_read(): array {
		$this->require_chat_user();

		$user_id = get_current_user_id();
		$thread_id = sanitize_text_field( (string) ( $_GET['thread_id'] ?? '' ) );
		$type = sanitize_text_field( (string) ( $_GET['type'] ?? '' ) );
		$limit = max( 1, min( 1000, (int) ( $_GET['limit'] ?? 100 ) ) );

		global $wpdb;
		$table_name = $wpdb->prefix . 'DialogStudio_memory_entries';

		$where_conditions = [ 'user_id = %d' ];
		$where_values = [ $user_id ];

		if ( ! empty( $thread_id ) ) {
			$where_conditions[] = 'thread_id = %s';
			$where_values[] = $thread_id;
		}

		if ( ! empty( $type ) ) {
			$where_conditions[] = 'type = %s';
			$where_values[] = $type;
		}

		$where_clause = implode( ' AND ', $where_conditions );

		$memories = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT * FROM {$table_name} WHERE {$where_clause} ORDER BY created_at DESC LIMIT %d",
				array_merge( $where_values, [ $limit ] )
			)
		);

		$formatted_memories = [];
		foreach ( $memories as $memory ) {
			$formatted_memories[] = [
				'id' => $memory->id,
				'type' => $memory->type,
				'slug' => $memory->slug,
				'payload' => json_decode( $memory->payload, true ),
				'created_at' => $memory->created_at,
				'updated_at' => $memory->updated_at,
			];
		}

		return [
			'success' => true,
			'data' => [
				'memories' => $formatted_memories,
				'count' => count( $formatted_memories ),
				'filters' => compact( 'thread_id', 'type', 'limit' ),
			],
			'error' => null,
		];
	}

	/**
	 * POST /DialogStudio/v1/memory/write
	 */
	private function handle_memory_write(): array {
		$this->require_chat_user();

		$body = $this->get_json_body();
		$user_id = get_current_user_id();
		$thread_id = sanitize_text_field( (string) ( $body['thread_id'] ?? '' ) );
		$type = sanitize_text_field( (string) ( $body['type'] ?? '' ) );
		$slug = sanitize_text_field( (string) ( $body['slug'] ?? '' ) );
		$payload = $body['payload'] ?? [];

		if ( empty( $type ) ) {
			return [
				'success' => false,
				'data' => null,
				'error' => 'Memory type is required',
			];
		}

		global $wpdb;
		$table_name = $wpdb->prefix . 'DialogStudio_memory_entries';

		$result = $wpdb->insert(
			$table_name,
			[
				'user_id' => $user_id,
				'thread_id' => $thread_id ?: null,
				'type' => $type,
				'slug' => $slug ?: null,
				'payload' => wp_json_encode( $payload ),
				'created_at' => current_time( 'mysql' ),
				'updated_at' => current_time( 'mysql' ),
			],
			[ '%d', '%s', '%s', '%s', '%s', '%s', '%s' ]
		);

		if ( $result === false ) {
			return [
				'success' => false,
				'data' => null,
				'error' => 'Failed to save memory: ' . $wpdb->last_error,
			];
		}

		return [
			'success' => true,
			'data' => [
				'id' => $wpdb->insert_id,
				'type' => $type,
				'slug' => $slug,
				'saved_at' => current_time( 'mysql' ),
			],
			'error' => null,
		];
	}

	// =============================================
	// Helpers
	// =============================================

	/**
	 * Split file content into logical lines (editor-style line numbers).
	 *
	 * Trailing newline does not create an extra empty line, matching VS Code / most editors.
	 *
	 * @return array{0: array<int, string>, 1: string, 2: bool}
	 */
	private function split_content_lines( string $content ): array {
		$line_ending      = $this->detect_line_ending( $content );
		$trailing_newline = $this->has_trailing_newline( $content );
		$lines            = $this->split_lines( $content );

		if ( $trailing_newline && $lines !== [] && end( $lines ) === '' ) {
			array_pop( $lines );
		}

		return [ $lines, $line_ending, $trailing_newline ];
	}

	/**
	 * @param array<int, string> $lines
	 */
	private function join_content_lines( array $lines, string $line_ending, bool $trailing_newline ): string {
		$updated_content = implode( $line_ending, $lines );

		if ( $trailing_newline && ( $updated_content === '' || ! str_ends_with( $updated_content, $line_ending ) ) ) {
			$updated_content .= $line_ending;
		}

		return $updated_content;
	}

	/**
	 * @return array<int, string>
	 */
	private function split_replacement_lines( string $content ): array {
		if ( $content === '' ) {
			return [];
		}

		$lines = $this->split_lines( $content );

		if ( $this->has_trailing_newline( $content ) && $lines !== [] && end( $lines ) === '' ) {
			array_pop( $lines );
		}

		return $lines;
	}

	/**
	 * Split on real line breaks only. Avoids preg_split('/\R/') without /u, which
	 * treats UTF-8 continuation byte 0x85 (e.g. Persian "م") as U+0085 NEL.
	 *
	 * @return array<int, string>
	 */
	private function split_lines( string $content ): array {
		$lines = preg_split( "/\r\n|\n|\r/", $content );

		return is_array( $lines ) ? $lines : [ $content ];
	}

	private function detect_line_ending( string $content ): string {
		return str_contains( $content, "\r\n" ) ? "\r\n" : "\n";
	}

	private function has_trailing_newline( string $content ): bool {
		if ( $content === '' ) {
			return false;
		}

		return str_ends_with( $content, "\r\n" ) || str_ends_with( $content, "\n" ) || str_ends_with( $content, "\r" );
	}

	private function get_json_body(): array {
		$content_length = (int) ( $_SERVER['CONTENT_LENGTH'] ?? 0 );
		if ( $content_length > self::MAX_BODY_SIZE ) {
			return [];
		}

		$raw = file_get_contents( 'php://input' );
		if ( empty( $raw ) ) {
			return [];
		}

		if ( strlen( $raw ) > self::MAX_BODY_SIZE ) {
			return [];
		}

		$data = json_decode( $raw, true );

		return is_array( $data ) ? $data : [];
	}

	private function json_response( int $status_code, array $data ): void {
		http_response_code( $status_code );
		header( 'Content-Type: application/json; charset=utf-8' );
		header( 'X-DialogStudio: true' );
		echo function_exists( 'wp_json_encode' )
			? wp_json_encode( $data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES )
			: json_encode( $data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES );
		exit;
	}

	private function html_response( int $status_code, string $html ): void {
		http_response_code( $status_code );
		header( 'Content-Type: text/html; charset=utf-8' );
		header( 'X-DialogStudio: true' );
		header( 'X-Robots-Tag: noindex, nofollow' );
		echo $html;
		exit;
	}
}

add_action(
	'muplugins_loaded',
	static function (): void {
		DialogStudio_Agent::get_instance()->boot();
	}
);
