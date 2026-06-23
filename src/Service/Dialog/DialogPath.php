<?php

declare(strict_types=1);

namespace DialogStudio\Service\Dialog;

/**
 * Paths for the Dialog workspace — resolves to the active (managed) child theme directory.
 */
final class DialogPath
{
    public static function root(): string
    {
        return wp_normalize_path( get_stylesheet_directory() );
    }

    public static function url(): string
    {
        return get_stylesheet_directory_uri();
    }

    public static function assets( string $scope = '' ): string
    {
        $path = self::root() . '/assets';

        if ( $scope !== '' ) {
            $path .= '/' . ltrim( $scope, '/' );
        }

        return wp_normalize_path( $path );
    }

    public static function modules(): string
    {
        return wp_normalize_path( self::root() . '/inc' );
    }

    public static function relativeRoot(): string
    {
        $stylesheet = get_option( 'stylesheet', '' );
        return 'wp-content/themes/' . (string) $stylesheet;
    }

    public static function resolve( string $relative ): string
    {
        $relative = ltrim( str_replace( '\\', '/', $relative ), '/' );
        $rel_root = self::relativeRoot() . '/';

        if ( str_starts_with( $relative, $rel_root ) ) {
            $relative = substr( $relative, strlen( $rel_root ) );
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
            'front/css',
            'front/js',
            'admin/css',
            'admin/js',
        ];
    }
}
