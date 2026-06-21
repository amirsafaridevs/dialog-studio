<?php

declare(strict_types=1);

namespace DialogStudio\Service\Dialog;

class DialogAssetLoader
{
    public function registerHooks(): void
    {
        add_action( 'wp_enqueue_scripts', [ $this, 'enqueueFrontAssets' ], 20 );
        add_action( 'admin_enqueue_scripts', [ $this, 'enqueueAdminAssets' ], 20 );
    }

    public function enqueueFrontAssets(): void
    {
        $this->enqueueScopeAssets( 'front' );
    }

    public function enqueueAdminAssets(): void
    {
        $this->enqueueScopeAssets( 'admin' );
    }

    private function enqueueScopeAssets( string $scope ): void
    {
        $base_dir = DialogPath::assets( $scope );
        $base_url = trailingslashit( DialogPath::url() ) . 'assets/' . $scope;

        if ( ! is_dir( $base_dir ) ) {
            return;
        }

        $this->enqueueFilesFromDirectory( $base_dir, $base_url . '/css', 'css', $scope, 'style' );
        $this->enqueueFilesFromDirectory( $base_dir, $base_url . '/js', 'js', $scope, 'script' );
    }

    /**
     * @param 'style'|'script' $assetType
     */
    private function enqueueFilesFromDirectory(
        string $scopeDir,
        string $scopeUrl,
        string $subdir,
        string $scope,
        string $assetType
    ): void {
        $directory = wp_normalize_path( $scopeDir . '/' . $subdir );

        if ( ! is_dir( $directory ) ) {
            return;
        }

        $files = glob( $directory . '/*.' . $subdir );

        if ( ! is_array( $files ) ) {
            return;
        }

        sort( $files, SORT_STRING );

        foreach ( $files as $file ) {
            if ( ! is_readable( $file ) ) {
                continue;
            }

            $basename = basename( $file );
            $handle   = 'dialog-' . $scope . '-' . $subdir . '-' . sanitize_title( pathinfo( $basename, PATHINFO_FILENAME ) );
            $url      = trailingslashit( $scopeUrl ) . $basename;
            $version  = (string) filemtime( $file );

            if ( $assetType === 'style' ) {
                wp_enqueue_style( $handle, $url, [], $version );
                continue;
            }

            wp_enqueue_script( $handle, $url, [], $version, true );
        }
    }
}
