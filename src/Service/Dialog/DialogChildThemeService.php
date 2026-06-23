<?php

declare(strict_types=1);

namespace DialogStudio\Service\Dialog;

class DialogChildThemeService
{
    public const MANAGED_MARKER = 'Dialog Studio: managed';

    public function getStatus(): array
    {
        $active_slug  = get_option( 'stylesheet', '' );
        $parent_slug  = get_option( 'template', '' );
        $is_child     = is_string( $parent_slug ) && is_string( $active_slug ) && $parent_slug !== $active_slug;
        $is_managed   = $this->isManagedTheme( (string) $active_slug );
        $theme_path   = $this->themeDir( (string) $active_slug );

        return [
            'is_managed'     => $is_managed,
            'setup_required' => ! $is_managed,
            'is_child_theme' => $is_child,
            'active_slug'    => (string) $active_slug,
            'active_name'    => $this->themeName( (string) $active_slug ),
            'parent_slug'    => $is_child ? (string) $parent_slug : (string) $active_slug,
            'parent_name'    => $this->themeName( $is_child ? (string) $parent_slug : (string) $active_slug ),
            'theme_path'     => $theme_path,
            'ready'          => $is_managed && is_dir( $theme_path ) && is_writable( $theme_path ),
        ];
    }

    public function isManagedTheme( string $slug = '' ): bool
    {
        if ( $slug === '' ) {
            $slug = (string) get_option( 'stylesheet', '' );
        }

        $style = $this->themeDir( $slug ) . '/style.css';

        if ( ! is_readable( $style ) ) {
            return false;
        }

        $header = file_get_contents( $style, false, null, 0, 512 );

        return is_string( $header ) && strpos( $header, self::MANAGED_MARKER ) !== false;
    }

    /**
     * @return array{success: bool, data: array<string, mixed>|null, error: string|null}
     */
    public function setup(): array
    {
        $current_slug = (string) get_option( 'stylesheet', '' );
        $template_opt = (string) get_option( 'template', '' );

        if ( $current_slug === '' ) {
            return $this->error( 'فعال‌سازی قالب ناموفق: slug قالب فعلی خالی است.' );
        }

        if ( $this->isManagedTheme( $current_slug ) ) {
            $this->ensureStructure( $current_slug );
            return [
                'success' => true,
                'data'    => array_merge( $this->getStatus(), [ 'already_managed' => true ] ),
                'error'   => null,
            ];
        }

        $parent_slug = ( $template_opt !== '' && $template_opt !== $current_slug )
            ? $template_opt
            : $current_slug;

        $child_slug = $parent_slug . '-child';
        $child_path = $this->themeDir( $child_slug );

        if ( is_dir( $child_path ) && ! $this->isManagedTheme( $child_slug ) ) {
            $child_slug = $parent_slug . '-dialog-child';
            $child_path = $this->themeDir( $child_slug );
        }

        if ( ! is_dir( $child_path ) && ! wp_mkdir_p( $child_path ) ) {
            return $this->error( 'ساخت پوشه child theme ناموفق بود: ' . $child_path );
        }

        $parent_name = $this->themeName( $parent_slug );
        $child_name  = $parent_name . ' Child';

        if ( file_put_contents( $child_path . '/style.css', $this->styleContent( $child_name, $parent_slug, $parent_name ) ) === false ) {
            return $this->error( 'نوشتن style.css ناموفق بود.' );
        }

        if ( file_put_contents( $child_path . '/functions.php', $this->functionsContent() ) === false ) {
            return $this->error( 'نوشتن functions.php ناموفق بود.' );
        }

        $this->ensureStructure( $child_slug );

        update_option( 'stylesheet', $child_slug );
        update_option( 'template', $parent_slug );
        wp_cache_delete( 'alloptions', 'options' );

        return [
            'success' => true,
            'data'    => [
                'created'     => true,
                'activated'   => true,
                'child_slug'  => $child_slug,
                'parent_slug' => $parent_slug,
                'child_name'  => $child_name,
                'child_path'  => $child_path,
            ],
            'error'   => null,
        ];
    }

    public function ensureStructure( string $slug = '' ): void
    {
        if ( $slug === '' ) {
            $slug = (string) get_option( 'stylesheet', '' );
        }

        $root = $this->themeDir( $slug );

        if ( ! is_dir( $root ) ) {
            return;
        }

        foreach ( [ 'assets/front/css', 'assets/front/js', 'assets/admin/css', 'assets/admin/js', 'inc' ] as $sub ) {
            $dir = $root . '/' . $sub;
            if ( ! is_dir( $dir ) ) {
                wp_mkdir_p( $dir );
            }
        }
    }

    public function themeDir( string $slug ): string
    {
        return wp_normalize_path( get_theme_root() . '/' . $slug );
    }

    public function themeName( string $slug ): string
    {
        if ( $slug === '' ) {
            return '';
        }

        $style = $this->themeDir( $slug ) . '/style.css';

        if ( ! is_readable( $style ) ) {
            return $slug;
        }

        $header = @file_get_contents( $style, false, null, 0, 512 );

        if ( is_string( $header ) && preg_match( '/^Theme Name:\s*(.+)$/mi', $header, $m ) ) {
            return trim( $m[1] );
        }

        return $slug;
    }

    private function styleContent( string $child_name, string $parent_slug, string $parent_name ): string
    {
        return "/*\n" .
            "Theme Name: {$child_name}\n" .
            "Template: {$parent_slug}\n" .
            "Description: Dialog Studio child theme based on {$parent_name}.\n" .
            self::MANAGED_MARKER . "\n" .
            "Version: 1.0.0\n" .
            "*/\n";
    }

    private function functionsContent(): string
    {
        return "<?php\n" .
            "/**\n" .
            " * Dialog Studio managed child theme.\n" .
            " * This file is auto-generated — do not remove.\n" .
            " */\n\n" .
            "if ( ! defined( 'ABSPATH' ) ) {\n" .
            "\texit;\n" .
            "}\n\n" .
            "add_action( 'wp_enqueue_scripts', function() {\n" .
            "\twp_enqueue_style( 'parent-style', get_template_directory_uri() . '/style.css' );\n" .
            "} );\n";
    }

    /**
     * @return array{success: false, data: null, error: string}
     */
    private function error( string $message ): array
    {
        return [ 'success' => false, 'data' => null, 'error' => $message ];
    }
}
