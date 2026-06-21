<?php

declare(strict_types=1);

namespace DialogStudio\Service\Indexing;

use DialogStudio\Exception\ThemeIndexingException;
use FilesystemIterator;
use RecursiveCallbackFilterIterator;
use RecursiveDirectoryIterator;
use RecursiveIteratorIterator;
use WP_Theme;

/**
 * Resolves the active WordPress theme and scans its code files.
 */
class ThemeFileScanner
{
    /** @var list<string> */
    private const SKIP_DIRECTORY_NAMES = [ 'vendor', 'node_modules', '.git', 'cache' ];

    /** @var list<string> */
    private const CODE_EXTENSIONS = [ 'php', 'css', 'scss', 'js' ];

    /** @var list<string> */
    private const VALIDATION_EXTENSIONS = [ 'php', 'css', 'scss', 'js', 'html', 'htm' ];

    /**
     * Resolve the currently active theme.
     *
     * @return array{slug: string, directory: string}
     *
     * @throws ThemeIndexingException
     */
    public function getActiveTheme(): array
    {
        if ( ! function_exists( 'wp_get_theme' ) ) {
            throw new ThemeIndexingException( 'WordPress theme APIs are not available.' );
        }

        $theme = wp_get_theme();

        if ( ! $theme instanceof WP_Theme || ! $theme->exists() ) {
            throw new ThemeIndexingException( 'No active WordPress theme could be resolved.' );
        }

        $directory = $this->normalizePath( (string) $theme->get_stylesheet_directory() );

        if ( '' === $directory || ! is_dir( $directory ) || ! is_readable( $directory ) ) {
            throw new ThemeIndexingException(
                sprintf( 'Active theme directory is not readable: %s', $directory )
            );
        }

        return [
            'slug'      => (string) $theme->get_stylesheet(),
            'directory' => $directory,
        ];
    }

    /**
     * Recursively collect PHP file paths relative to the theme root.
     *
     * @return list<string>
     *
     * @throws ThemeIndexingException
     */
    public function scanPhpFiles( string $themeDirectory ): array
    {
        return $this->scanFilesByExtensions( $themeDirectory, [ 'php' ] );
    }

    /**
     * Recursively collect theme code file paths (PHP, CSS, SCSS, JS).
     *
     * @return list<string>
     *
     * @throws ThemeIndexingException
     */
    public function scanCodeFiles( string $themeDirectory ): array
    {
        return $this->scanFilesByExtensions( $themeDirectory, self::CODE_EXTENSIONS );
    }

    /**
     * Recursively collect validation targets (PHP, CSS, SCSS, JS, HTML).
     *
     * @return list<string>
     *
     * @throws ThemeIndexingException
     */
    public function scanValidationFiles( string $directory ): array
    {
        return $this->scanFilesByExtensions( $directory, self::VALIDATION_EXTENSIONS );
    }

    /**
     * @param list<string> $extensions
     * @return list<string>
     *
     * @throws ThemeIndexingException
     */
    private function scanFilesByExtensions( string $themeDirectory, array $extensions ): array
    {
        $themeDirectory = $this->normalizePath( $themeDirectory );

        if ( ! is_dir( $themeDirectory ) || ! is_readable( $themeDirectory ) ) {
            throw new ThemeIndexingException(
                sprintf( 'Theme directory is not readable: %s', $themeDirectory )
            );
        }

        $extensions = array_map( 'strtolower', $extensions );
        $files      = [];

        $directoryIterator = new RecursiveDirectoryIterator(
            $themeDirectory,
            FilesystemIterator::SKIP_DOTS | FilesystemIterator::FOLLOW_SYMLINKS
        );

        $filter = new RecursiveCallbackFilterIterator(
            $directoryIterator,
            static function ( \SplFileInfo $fileInfo, string $key, \RecursiveIterator $iterator ) use ( $extensions ): bool {
                if ( $iterator->hasChildren() ) {
                    return ! in_array( $fileInfo->getFilename(), self::SKIP_DIRECTORY_NAMES, true );
                }

                return $fileInfo->isFile()
                    && in_array( strtolower( $fileInfo->getExtension() ), $extensions, true );
            }
        );

        $iterator = new RecursiveIteratorIterator( $filter );

        foreach ( $iterator as $fileInfo ) {
            if ( ! $fileInfo instanceof \SplFileInfo ) {
                continue;
            }

            $absolutePath = $this->normalizePath( $fileInfo->getPathname() );
            $relativePath = ltrim(
                str_replace( '\\', '/', substr( $absolutePath, strlen( $themeDirectory ) ) ),
                '/'
            );

            if ( '' !== $relativePath ) {
                $files[] = $relativePath;
            }
        }

        sort( $files, SORT_STRING );

        return $files;
    }

    private function normalizePath( string $path ): string
    {
        if ( function_exists( 'wp_normalize_path' ) ) {
            return wp_normalize_path( $path );
        }

        return str_replace( '\\', '/', $path );
    }
}
