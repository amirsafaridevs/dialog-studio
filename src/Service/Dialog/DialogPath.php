<?php

declare(strict_types=1);

namespace DialogStudio\Service\Dialog;

/**
 * Paths for the Dialog workspace under wp-content/dialog.
 */
final class DialogPath
{
    public const WORKSPACE_DIR = 'dialog';

    public const ASSETS_DIR = 'assets';

    public const MODULES_DIR = 'modules';

    public const TEMPLATES_DIR = 'templates';

    public static function root(): string
    {
        return wp_normalize_path( WP_CONTENT_DIR . '/' . self::WORKSPACE_DIR );
    }

    public static function url(): string
    {
        return content_url( self::WORKSPACE_DIR );
    }

    public static function assets( string $scope = '' ): string
    {
        $path = self::root() . '/' . self::ASSETS_DIR;

        if ( $scope !== '' ) {
            $path .= '/' . ltrim( $scope, '/' );
        }

        return wp_normalize_path( $path );
    }

    public static function modules(): string
    {
        return wp_normalize_path( self::root() . '/' . self::MODULES_DIR );
    }

    public static function templates(): string
    {
        return wp_normalize_path( self::root() . '/' . self::TEMPLATES_DIR );
    }

    public static function relativeRoot(): string
    {
        return 'wp-content/' . self::WORKSPACE_DIR;
    }

    public static function resolve( string $relative ): string
    {
        $relative = ltrim( str_replace( '\\', '/', $relative ), '/' );

        if ( str_starts_with( $relative, self::relativeRoot() . '/' ) ) {
            $relative = substr( $relative, strlen( self::relativeRoot() ) + 1 );
        }

        if ( str_starts_with( $relative, self::WORKSPACE_DIR . '/' ) ) {
            $relative = substr( $relative, strlen( self::WORKSPACE_DIR ) + 1 );
        }

        return wp_normalize_path( self::root() . '/' . $relative );
    }

    public static function toRelative( string $absolute ): string
    {
        $absolute = wp_normalize_path( $absolute );
        $root     = rtrim( self::root(), '/' );

        if ( ! str_starts_with( $absolute, $root ) ) {
            return $absolute;
        }

        return ltrim( substr( $absolute, strlen( $root ) ), '/' );
    }

    /**
     * @return list<string>
     */
    public static function assetSubdirectories(): array
    {
        return [
            'admin/css',
            'admin/js',
            'admin/img',
            'front/css',
            'front/js',
            'front/img',
        ];
    }
}
