<?php

declare(strict_types=1);

namespace DialogStudio\Service\Runtime;

use DialogStudio\Contract\Abstract\AbstractService;

/**
 * Deploys and maintains the agent mu-plugin in WPMU_PLUGIN_DIR.
 */
class MuPluginService extends AbstractService
{
    private const MU_PLUGIN_FILENAME   = 'dialog-theme-maker.php';
    private const STATIC_TOKENS_OPTION = 'dtm_tokens';

    public function boot(): void
    {
        add_action( 'plugins_loaded', [ $this, 'ensureDeployed' ], 1 );
        add_action( 'admin_init', [ $this, 'ensureDeployed' ] );
    }

    /**
     * Run on plugin activation — deploy mu-plugin and seed default options.
     */
    public function activate(): void
    {
        $this->deploy();
        $this->seedDefaultOptions();
    }

    /**
     * Re-deploy mu-plugin if it was removed accidentally.
     */
    public function ensureDeployed(): void
    {
        if ( ! $this->isDeployed() || $this->needsRedeploy() ) {
            $this->deploy();
        }
    }

    public function deploy(): void
    {
        $source = $this->getSourcePath();

        if ( ! file_exists( $source ) ) {
            error_log( 'DialogStudio: mu-plugin source not found at ' . $source );
            return;
        }

        $mu_plugin_dir = $this->getMuPluginDir();

        if ( ! is_dir( $mu_plugin_dir ) ) {
            wp_mkdir_p( $mu_plugin_dir );
        }

        $destination = $this->getMuPluginPath();

        if ( file_exists( $destination ) ) {
            unlink( $destination ); // phpcs:ignore WordPress.WP.AlternativeFunctions.unlink_unlink
        }

        copy( $source, $destination ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_copy
    }

    public function isDeployed(): bool
    {
        return file_exists( $this->getMuPluginPath() );
    }

    private function needsRedeploy(): bool
    {
        $source      = $this->getSourcePath();
        $destination = $this->getMuPluginPath();

        if ( ! is_readable( $source ) || ! is_readable( $destination ) ) {
            return true;
        }

        return md5_file( $source ) !== md5_file( $destination );
    }

    private function seedDefaultOptions(): void
    {
        if ( null === get_option( self::STATIC_TOKENS_OPTION, null ) ) {
            add_option( self::STATIC_TOKENS_OPTION, [], '', 'no' );
        }
    }

    private function getSourcePath(): string
    {
        return $this->getApplication()->path( 'agent' . DIRECTORY_SEPARATOR . self::MU_PLUGIN_FILENAME );
    }

    private function getMuPluginDir(): string
    {
        return defined( 'WPMU_PLUGIN_DIR' ) ? WPMU_PLUGIN_DIR : WP_CONTENT_DIR . '/mu-plugins';
    }

    private function getMuPluginPath(): string
    {
        return $this->getMuPluginDir() . DIRECTORY_SEPARATOR . self::MU_PLUGIN_FILENAME;
    }
}
