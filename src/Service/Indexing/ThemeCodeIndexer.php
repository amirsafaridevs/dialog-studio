<?php

declare(strict_types=1);

namespace DialogStudio\Service\Indexing;

use DialogStudio\Exception\ThemeIndexingException;
use PhpParser\Error;
use PhpParser\NodeTraverser;
use PhpParser\Parser;
use PhpParser\ParserFactory;

/**
 * Builds an in-memory code index for the active WordPress theme.
 */
class ThemeCodeIndexer
{
    private ThemeFileScanner $fileScanner;

    private ThemeAstVisitor $astVisitor;

    private CssSymbolExtractor $cssExtractor;

    private JsSymbolExtractor $jsExtractor;

    private Parser $parser;

    public function __construct(
        ?ThemeFileScanner $fileScanner = null,
        ?ThemeAstVisitor $astVisitor = null,
        ?CssSymbolExtractor $cssExtractor = null,
        ?JsSymbolExtractor $jsExtractor = null,
        ?Parser $parser = null
    ) {
        $this->fileScanner  = $fileScanner ?? new ThemeFileScanner();
        $this->astVisitor   = $astVisitor ?? new ThemeAstVisitor();
        $this->cssExtractor = $cssExtractor ?? new CssSymbolExtractor();
        $this->jsExtractor  = $jsExtractor ?? new JsSymbolExtractor();
        $this->parser       = $parser ?? ( new ParserFactory() )->createForNewestSupportedVersion();
    }

    /**
     * Build a full code index for the active theme.
     *
     * @return array{
     *     theme: string,
     *     files: list<array<string, mixed>>
     * }
     *
     * @throws ThemeIndexingException
     */
    public function buildIndex(): array
    {
        $theme = $this->fileScanner->getActiveTheme();
        $index = $this->buildIndexForDirectory( $theme['directory'], $theme['slug'] );

        return [
            'theme' => $theme['slug'],
            'scope' => $theme['slug'],
            'files' => $index['files'],
        ];
    }

    /**
     * Build a full code index for any readable directory.
     *
     * @return array{
     *     scope: string,
     *     directory: string,
     *     files: list<array<string, mixed>>
     * }
     *
     * @throws ThemeIndexingException
     */
    public function buildIndexForDirectory( string $directoryAbsolute, string $scopeLabel = '' ): array
    {
        $directoryAbsolute = $this->normalizePath( $directoryAbsolute );
        $filePaths         = $this->fileScanner->scanCodeFiles( $directoryAbsolute );
        $indexedFiles      = [];

        foreach ( $filePaths as $relativePath ) {
            $indexedFiles[] = $this->indexFile(
                $directoryAbsolute,
                $relativePath
            );
        }

        if ( '' === $scopeLabel ) {
            $scopeLabel = basename( $directoryAbsolute );
        }

        return [
            'scope'     => $scopeLabel,
            'directory' => $directoryAbsolute,
            'files'     => $indexedFiles,
        ];
    }

    /**
     * Build symbol registry, references, and code graph for the active theme.
     *
     * @return array{
     *     theme: string,
     *     files: list<array<string, mixed>>,
     *     registry: array<string, array{type: string, file: string, methods?: list<string>}>,
     *     graph: array{
     *         nodes: list<array{id: string, type: string, file?: string}>,
     *         edges: list<array{from: string, to: string, type: string, line?: int}>
     *     }
     * }
     *
     * @throws ThemeIndexingException
     */
    public function buildFullIndex(): array
    {
        $index = $this->buildIndex();

        return $this->buildAnalysisFromIndex( $index, $index['scope'] ?? $index['theme'] ?? '' );
    }

    /**
     * Build symbol registry and code graph for any readable directory.
     *
     * @return array{
     *     scope: string,
     *     directory: string,
     *     files: list<array<string, mixed>>,
     *     registry: array<string, array{type: string, file: string, methods?: list<string>}>,
     *     graph: array{
     *         nodes: list<array{id: string, type: string, file?: string}>,
     *         edges: list<array{from: string, to: string, type: string, line?: int}>
     *     }
     * }
     *
     * @throws ThemeIndexingException
     */
    public function buildFullIndexForDirectory( string $directoryAbsolute, string $scopeLabel = '' ): array
    {
        $index = $this->buildIndexForDirectory( $directoryAbsolute, $scopeLabel );

        return $this->buildAnalysisFromIndex( $index, $index['scope'] );
    }

    /**
     * @param array{scope?: string, theme?: string, files: list<array<string, mixed>>} $index
     * @return array{
     *     scope: string,
     *     directory?: string,
     *     theme?: string,
     *     files: list<array<string, mixed>>,
     *     registry: array<string, array{type: string, file: string, methods?: list<string>}>,
     *     graph: array{
     *         nodes: list<array{id: string, type: string, file?: string}>,
     *         edges: list<array{from: string, to: string, type: string, line?: int}>
     *     }
     * }
     */
    private function buildAnalysisFromIndex( array $index, string $scopeLabel ): array
    {
        $registry = SymbolRegistry::fromIndex( $index );
        $graph    = CodeGraph::build( $index, $registry );

        $result = [
            'scope'    => $scopeLabel,
            'files'    => $index['files'],
            'registry' => $registry->toArray(),
            'graph'    => $graph->toArray(),
        ];

        if ( isset( $index['directory'] ) ) {
            $result['directory'] = $index['directory'];
        }

        if ( isset( $index['theme'] ) ) {
            $result['theme'] = $index['theme'];
        }

        return $result;
    }

    /**
     * Build a compact index suitable for LLM context payloads.
     *
     * @return array{
     *     files: list<array{
     *         path: string,
     *         classes: list<string>,
     *         methods: list<string>,
     *         functions: list<string>
     *     }>
     * }
     *
     * @throws ThemeIndexingException
     */
    public function buildCompactIndex(): array
    {
        $index = $this->buildIndex();

        return [
            'files' => array_map(
                static function ( array $file ): array {
                    $methods = [];

                    foreach ( $file['classes'] as $class ) {
                        foreach ( $class['methods'] as $method ) {
                            $methods[] = $method;
                        }
                    }

                    foreach ( $file['interfaces'] as $interface ) {
                        foreach ( $interface['methods'] as $method ) {
                            $methods[] = $method;
                        }
                    }

                    foreach ( $file['traits'] as $trait ) {
                        foreach ( $trait['methods'] as $method ) {
                            $methods[] = $method;
                        }
                    }

                    $methods = array_values( array_unique( $methods ) );
                    sort( $methods, SORT_STRING );

                    $classes = array_map(
                        static fn ( array $class ): string => $class['name'],
                        $file['classes']
                    );

                    sort( $classes, SORT_STRING );

                    $functions = $file['functions'];
                    sort( $functions, SORT_STRING );

                    return [
                        'path'      => $file['path'],
                        'classes'   => $classes,
                        'methods'   => $methods,
                        'functions' => $functions,
                    ];
                },
                $index['files']
            ),
        ];
    }

    /**
     * Build a compact code index for any readable directory.
     *
     * @throws ThemeIndexingException
     */
    public function buildCompactIndexForDirectory( string $directoryAbsolute, string $scopeLabel = 'dialog' ): array
    {
        $index = $this->buildIndexForDirectory( $directoryAbsolute, $scopeLabel );

        return [
            'scope' => $scopeLabel,
            'files' => array_map(
                static function ( array $file ): array {
                    $methods = [];

                    foreach ( $file['classes'] as $class ) {
                        foreach ( $class['methods'] as $method ) {
                            $methods[] = $method;
                        }
                    }

                    foreach ( $file['interfaces'] as $interface ) {
                        foreach ( $interface['methods'] as $method ) {
                            $methods[] = $method;
                        }
                    }

                    foreach ( $file['traits'] as $trait ) {
                        foreach ( $trait['methods'] as $method ) {
                            $methods[] = $method;
                        }
                    }

                    $methods = array_values( array_unique( $methods ) );
                    sort( $methods, SORT_STRING );

                    $classes = array_map(
                        static fn ( array $class ): string => $class['name'],
                        $file['classes']
                    );

                    sort( $classes, SORT_STRING );

                    $functions = $file['functions'];
                    sort( $functions, SORT_STRING );

                    return [
                        'path'      => $file['path'],
                        'classes'   => $classes,
                        'methods'   => $methods,
                        'functions' => $functions,
                    ];
                },
                $index['files']
            ),
        ];
    }

    /**
     * @return array{
     *     path: string,
     *     namespace: string|null,
     *     classes: list<array{name: string, methods: list<string>}>,
     *     interfaces: list<array{name: string, methods: list<string>}>,
     *     traits: list<array{name: string, methods: list<string>}>,
     *     functions: list<string>,
     *     references: list<array{
     *         type: string,
     *         source_file: string,
     *         source_symbol: string,
     *         target_symbol: string,
     *         line: int
     *     }>
     * }
     */
    private function indexFile( string $themeDirectory, string $relativePath ): array
    {
        $extension = strtolower( pathinfo( $relativePath, PATHINFO_EXTENSION ) );

        if ( in_array( $extension, [ 'css', 'scss' ], true ) ) {
            return $this->indexCssFile( $themeDirectory, $relativePath );
        }

        if ( 'js' === $extension ) {
            return $this->indexJsFile( $themeDirectory, $relativePath );
        }

        return $this->indexPhpFile( $themeDirectory, $relativePath );
    }

    /**
     * @return array{
     *     path: string,
     *     namespace: string|null,
     *     classes: list<array{name: string, methods: list<string>}>,
     *     interfaces: list<array{name: string, methods: list<string>}>,
     *     traits: list<array{name: string, methods: list<string>}>,
     *     functions: list<string>,
     *     references: list<array{
     *         type: string,
     *         source_file: string,
     *         source_symbol: string,
     *         target_symbol: string,
     *         line: int
     *     }>
     * }
     */
    private function indexCssFile( string $themeDirectory, string $relativePath ): array
    {
        $emptyResult = $this->emptyFileIndex( $relativePath );
        $source      = $this->readThemeFile( $themeDirectory, $relativePath );

        if ( null === $source ) {
            return $emptyResult;
        }

        $symbols = $this->cssExtractor->extract( $source );

        $emptyResult['classes'] = array_map(
            static fn ( string $className ): array => [
                'name'    => $className,
                'methods' => [],
            ],
            $symbols['classes']
        );
        $emptyResult['functions'] = $symbols['functions'];

        return $emptyResult;
    }

    /**
     * @return array{
     *     path: string,
     *     namespace: string|null,
     *     classes: list<array{name: string, methods: list<string>}>,
     *     interfaces: list<array{name: string, methods: list<string>}>,
     *     traits: list<array{name: string, methods: list<string>}>,
     *     functions: list<string>,
     *     references: list<array{
     *         type: string,
     *         source_file: string,
     *         source_symbol: string,
     *         target_symbol: string,
     *         line: int
     *     }>
     * }
     */
    private function indexJsFile( string $themeDirectory, string $relativePath ): array
    {
        $emptyResult = $this->emptyFileIndex( $relativePath );
        $source      = $this->readThemeFile( $themeDirectory, $relativePath );

        if ( null === $source ) {
            return $emptyResult;
        }

        $symbols = $this->jsExtractor->extract( $source );

        $emptyResult['classes']   = $symbols['classes'];
        $emptyResult['functions'] = $symbols['functions'];

        return $emptyResult;
    }

    /**
     * @return array{
     *     path: string,
     *     namespace: string|null,
     *     classes: list<array{name: string, methods: list<string>}>,
     *     interfaces: list<array{name: string, methods: list<string>}>,
     *     traits: list<array{name: string, methods: list<string>}>,
     *     functions: list<string>,
     *     references: list<array{
     *         type: string,
     *         source_file: string,
     *         source_symbol: string,
     *         target_symbol: string,
     *         line: int
     *     }>
     * }
     */
    private function indexPhpFile( string $themeDirectory, string $relativePath ): array
    {
        $emptyResult = $this->emptyFileIndex( $relativePath );
        $source      = $this->readThemeFile( $themeDirectory, $relativePath );

        if ( null === $source ) {
            return $emptyResult;
        }

        try {
            $ast = $this->parser->parse( $source );
        } catch ( Error $error ) {
            error_log(
                sprintf(
                    'DialogStudio: parse error in theme file %s: %s',
                    $relativePath,
                    $error->getMessage()
                )
            );

            return $emptyResult;
        }

        if ( null === $ast ) {
            return $emptyResult;
        }

        $this->astVisitor->reset();

        $traverser = new NodeTraverser();
        $traverser->addVisitor( $this->astVisitor );
        $traverser->traverse( $ast );

        $result = $this->astVisitor->getResult();

        return [
            'path'       => $relativePath,
            'namespace'  => $result['namespace'],
            'classes'    => $result['classes'],
            'interfaces' => $result['interfaces'],
            'traits'     => $result['traits'],
            'functions'  => $result['functions'],
            'references' => $this->attachSourceFileToReferences( $relativePath, $result['references'] ),
        ];
    }

    /**
     * @return array{
     *     path: string,
     *     namespace: string|null,
     *     classes: list<array{name: string, methods: list<string>}>,
     *     interfaces: list<array{name: string, methods: list<string>}>,
     *     traits: list<array{name: string, methods: list<string>}>,
     *     functions: list<string>,
     *     references: list<array{
     *         type: string,
     *         source_file: string,
     *         source_symbol: string,
     *         target_symbol: string,
     *         line: int
     *     }>
     * }
     */
    private function emptyFileIndex( string $relativePath ): array
    {
        return [
            'path'       => $relativePath,
            'namespace'  => null,
            'classes'    => [],
            'interfaces' => [],
            'traits'     => [],
            'functions'  => [],
            'references' => [],
        ];
    }

    private function readThemeFile( string $themeDirectory, string $relativePath ): ?string
    {
        $absolutePath = $this->normalizePath( $themeDirectory . '/' . $relativePath );

        if ( ! is_readable( $absolutePath ) ) {
            error_log(
                sprintf(
                    'DialogStudio: skipped unreadable theme file during indexing: %s',
                    $relativePath
                )
            );

            return null;
        }

        $source = file_get_contents( $absolutePath );

        if ( false === $source ) {
            error_log(
                sprintf(
                    'DialogStudio: failed to read theme file during indexing: %s',
                    $relativePath
                )
            );

            return null;
        }

        return $source;
    }

    /**
     * @param list<array{type: string, source_symbol: string, target_symbol: string, line: int}> $references
     * @return list<array{type: string, source_file: string, source_symbol: string, target_symbol: string, line: int}>
     */
    private function attachSourceFileToReferences( string $relativePath, array $references ): array
    {
        $enriched = [];

        foreach ( $references as $reference ) {
            $enriched[] = [
                'type'          => $reference['type'],
                'source_file'   => $relativePath,
                'source_symbol' => $reference['source_symbol'],
                'target_symbol' => $reference['target_symbol'],
                'line'          => $reference['line'],
            ];
        }

        return $enriched;
    }

    private function normalizePath( string $path ): string
    {
        if ( function_exists( 'wp_normalize_path' ) ) {
            return wp_normalize_path( $path );
        }

        return str_replace( '\\', '/', $path );
    }
}
