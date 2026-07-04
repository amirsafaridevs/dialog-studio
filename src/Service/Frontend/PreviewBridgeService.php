<?php

declare(strict_types=1);

namespace DialogStudio\Service\Frontend;

use DialogStudio\Contract\Abstract\AbstractService;

/**
 * Enqueues the preview bridge script on frontend and admin pages embedded in the chat iframe.
 */
class PreviewBridgeService extends AbstractService
{
    private const PREVIEW_QUERY_KEY = 'dtm_preview';
    private const SCRIPT_ID         = 'dtm-preview-bridge-js';

    private static bool $script_printed = false;

    public function boot(): void
    {
        static $booted = false;

        if ( $booted ) {
            return;
        }

        $booted = true;

        add_action( 'send_headers', [ $this, 'preventCachingOfPreviewRequests' ] );
        add_action( 'wp_head', [ $this, 'printPreviewBridgeScript' ], 1 );
        add_action( 'admin_head', [ $this, 'printPreviewBridgeScript' ], 1 );
    }

    /**
     * When the page is being loaded inside the agent's preview iframe, make sure
     * page-cache plugins (WP Rocket, W3TC, WP Super Cache, LiteSpeed, etc.) and the
     * browser itself never serve a stale response — the agent needs to see the
     * live result of its own edits on the very next load.
     */
    public function preventCachingOfPreviewRequests(): void
    {
        if ( ! $this->shouldLoadPreviewBridge() ) {
            return;
        }

        if ( ! defined( 'DONOTCACHEPAGE' ) ) {
            define( 'DONOTCACHEPAGE', true );
        }

        if ( ! defined( 'DONOTCACHEOBJECT' ) ) {
            define( 'DONOTCACHEOBJECT', true );
        }

        if ( ! defined( 'DONOTCACHEDB' ) ) {
            define( 'DONOTCACHEDB', true );
        }

        if ( function_exists( 'nocache_headers' ) ) {
            nocache_headers();
        }

        // LiteSpeed Cache reads this header explicitly; the constants above cover
        // most other cache plugins but LiteSpeed needs its own signal.
        if ( ! headers_sent() ) {
            header( 'X-LiteSpeed-Cache-Control: no-cache' );
        }
    }

    public function printPreviewBridgeScript(): void
    {
        if ( self::$script_printed || ! $this->shouldLoadPreviewBridge() ) {
            return;
        }

        if ( ! defined( 'DialogStudio_PLUGIN_FILE' ) ) {
            return;
        }

        $relative_path = 'assets/preview/preview-bridge.js';
        $absolute_path = plugin_dir_path( DialogStudio_PLUGIN_FILE ) . $relative_path;

        if ( ! is_readable( $absolute_path ) ) {
            return;
        }

        $url     = plugins_url( $relative_path, DialogStudio_PLUGIN_FILE );
        $version = (string) filemtime( $absolute_path );

        self::$script_printed = true;

        printf(
            '<script src="%s?v=%s" id="%s"></script>%s',
            esc_url( $url ),
            esc_attr( $version ),
            esc_attr( self::SCRIPT_ID ),
            "\n"
        );
    }

    private function shouldLoadPreviewBridge(): bool
    {
        // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only preview flag
        return isset( $_GET[ self::PREVIEW_QUERY_KEY ] )
            && '1' === (string) wp_unslash( $_GET[ self::PREVIEW_QUERY_KEY ] );
    }
}
