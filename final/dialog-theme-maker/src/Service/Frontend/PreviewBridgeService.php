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

    public function boot(): void
    {
        add_action( 'wp_head', [ $this, 'printPreviewBridgeScript' ], 1 );
        add_action( 'admin_head', [ $this, 'printPreviewBridgeScript' ], 1 );
    }

    public function printPreviewBridgeScript(): void
    {
        if ( ! $this->shouldLoadPreviewBridge() ) {
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
