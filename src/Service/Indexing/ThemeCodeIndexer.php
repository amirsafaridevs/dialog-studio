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
     * Build a high-level knowledge graph spanning the child theme and its parent.
     *
     * Unlike the compact index (a flat symbol list of the child only), this gives
     * the agent a mental map of the WHOLE project up front: which symbols matter
     * most (god nodes), which parent files the child overrides, and how files
     * cluster by responsibility. The full per-scope graphs remain available for
     * deeper, on-demand exploration via graph_query.
     *
     * @return array{
     *     child: array{slug: string, file_count: int},
     *     parent: array{slug: string, file_count: int}|null,
     *     god_nodes: list<array{symbol: string, type: string, scope: string, file: string, in_degree: int}>,
     *     overrides: list<array{path: string}>,
     *     communities: list<array{name: string, scope: string, files: list<string>}>,
     *     graph: array{
     *         nodes: list<array{id: string, type: string, file?: string, scope?: string}>,
     *         edges: list<array{from: string, to: string, type: string, line?: int}>
     *     }
     * }
     *
     * @throws ThemeIndexingException
     */
    public function buildKnowledgeGraph(): array
    {
        $themes = $this->fileScanner->getActiveThemeWithParent();

        $childAnalysis  = $this->buildFullIndexForDirectory( $themes['child']['directory'], 'child' );
        $parentAnalysis = null;

        if ( null !== $themes['parent'] ) {
            $parentAnalysis = $this->buildFullIndexForDirectory( $themes['parent']['directory'], 'parent' );
        }

        $childPaths  = $this->collectFilePaths( $childAnalysis['files'] );
        $parentPaths = null === $parentAnalysis ? [] : $this->collectFilePaths( $parentAnalysis['files'] );

        // Files the child theme overrides — a parent path that also exists in child.
        $overrides = [];
        foreach ( $parentPaths as $path ) {
            if ( in_array( $path, $childPaths, true ) ) {
                $overrides[] = [ 'path' => $path ];
            }
        }

        $mergedGraph = $this->mergeScopedGraphs( $childAnalysis, $parentAnalysis );

        return [
            'child'  => [
                'slug'       => $themes['child']['slug'],
                'file_count' => count( $childAnalysis['files'] ),
            ],
            'parent' => null === $parentAnalysis ? null : [
                'slug'       => $themes['parent']['slug'],
                'file_count' => count( $parentAnalysis['files'] ),
            ],
            'god_nodes'   => $this->computeGodNodes( $mergedGraph['nodes'], $mergedGraph['edges'], 18 ),
            'overrides'   => $overrides,
            'communities' => array_merge(
                $this->computeCommunities( $childAnalysis['files'], 'child' ),
                null === $parentAnalysis ? [] : $this->computeCommunities( $parentAnalysis['files'], 'parent' )
            ),
            'graph'       => $mergedGraph,
        ];
    }

    /**
     * Answer a focused question against the project knowledge graph.
     *
     * Modes:
     *  - "explain": everything touching one symbol or file (incoming + outgoing edges).
     *  - "neighbors": same as explain but for a single direction-agnostic hop.
     *  - "path": the shortest relationship chain between two symbols/files.
     *
     * Returns a SCOPED subgraph far smaller than the full graph, so the agent can
     * pull just the slice it needs instead of re-reading everything.
     *
     * @param array{mode?: string, target?: string, from?: string, to?: string, max_hops?: int} $args
     * @return array{mode: string, result: array<string, mixed>}
     *
     * @throws ThemeIndexingException
     */
    public function queryKnowledgeGraph( array $args ): array
    {
        $kg    = $this->buildKnowledgeGraph();
        $graph = $kg['graph'];
        $mode  = strtolower( (string) ( $args['mode'] ?? 'explain' ) );

        if ( 'path' === $mode ) {
            $from = $this->resolveGraphId( $graph['nodes'], (string) ( $args['from'] ?? '' ) );
            $to   = $this->resolveGraphId( $graph['nodes'], (string) ( $args['to'] ?? '' ) );

            return [
                'mode'   => 'path',
                'result' => [
                    'from'  => $from,
                    'to'    => $to,
                    'chain' => ( '' === $from || '' === $to )
                        ? []
                        : $this->shortestPath( $graph['edges'], $from, $to, (int) ( $args['max_hops'] ?? 6 ) ),
                ],
            ];
        }

        // explain / neighbors
        $target  = $this->resolveGraphId( $graph['nodes'], (string) ( $args['target'] ?? '' ) );
        $nodeMap = [];
        foreach ( $graph['nodes'] as $node ) {
            $nodeMap[ (string) ( $node['id'] ?? '' ) ] = $node;
        }

        $outgoing = [];
        $incoming = [];
        foreach ( $graph['edges'] as $edge ) {
            if ( ( $edge['from'] ?? '' ) === $target ) {
                $outgoing[] = $edge;
            }
            if ( ( $edge['to'] ?? '' ) === $target ) {
                $incoming[] = $edge;
            }
        }

        return [
            'mode'   => 'explain',
            'result' => [
                'target'   => $target,
                'node'     => $nodeMap[ $target ] ?? null,
                'outgoing' => array_slice( $outgoing, 0, 40 ),
                'incoming' => array_slice( $incoming, 0, 40 ),
            ],
        ];
    }

    /**
     * Resolve a loose user-supplied symbol/file string to a real graph node id.
     *
     * @param list<array<string, mixed>> $nodes
     */
    private function resolveGraphId( array $nodes, string $needle ): string
    {
        $needle = trim( $needle );
        if ( '' === $needle ) {
            return '';
        }

        $ids = [];
        foreach ( $nodes as $node ) {
            $ids[] = (string) ( $node['id'] ?? '' );
        }

        if ( in_array( $needle, $ids, true ) ) {
            return $needle;
        }

        $fileId = 'file:' . ltrim( $needle, '/' );
        if ( in_array( $fileId, $ids, true ) ) {
            return $fileId;
        }

        // Case-insensitive / suffix match (e.g. a bare method or class name).
        $lower = strtolower( $needle );
        foreach ( $ids as $id ) {
            if ( strtolower( $id ) === $lower || str_ends_with( strtolower( $id ), '::' . $lower ) ) {
                return $id;
            }
        }

        return $needle;
    }

    /**
     * Breadth-first shortest path over the (undirected) edge set.
     *
     * @param list<array<string, mixed>> $edges
     * @return list<array{from: string, to: string, type: string}>
     */
    private function shortestPath( array $edges, string $from, string $to, int $maxHops ): array
    {
        if ( $from === $to ) {
            return [];
        }

        $adjacency = [];
        foreach ( $edges as $edge ) {
            $a = (string) ( $edge['from'] ?? '' );
            $b = (string) ( $edge['to'] ?? '' );
            $t = (string) ( $edge['type'] ?? '' );
            if ( '' === $a || '' === $b ) {
                continue;
            }
            $adjacency[ $a ][] = [ 'node' => $b, 'type' => $t, 'dir' => 'out' ];
            $adjacency[ $b ][] = [ 'node' => $a, 'type' => $t, 'dir' => 'in' ];
        }

        $queue   = [ [ $from, [] ] ];
        $visited = [ $from => true ];

        while ( ! empty( $queue ) ) {
            [ $current, $trail ] = array_shift( $queue );

            if ( count( $trail ) >= $maxHops ) {
                continue;
            }

            foreach ( $adjacency[ $current ] ?? [] as $next ) {
                $node = $next['node'];
                if ( isset( $visited[ $node ] ) ) {
                    continue;
                }

                $step      = [ 'from' => $current, 'to' => $node, 'type' => $next['type'] ];
                $nextTrail = array_merge( $trail, [ $step ] );

                if ( $node === $to ) {
                    return $nextTrail;
                }

                $visited[ $node ] = true;
                $queue[]          = [ $node, $nextTrail ];
            }
        }

        return [];
    }

    /**
     * @param list<array<string, mixed>> $files
     * @return list<string>
     */
    private function collectFilePaths( array $files ): array
    {
        return array_values(
            array_map(
                static fn ( array $file ): string => (string) ( $file['path'] ?? '' ),
                $files
            )
        );
    }

    /**
     * Merge child + parent analysis graphs, tagging every node with its scope so
     * the agent can tell at a glance whether a symbol lives in the writable child
     * or the read-only parent.
     *
     * @param array{scope: string, files: list<array<string, mixed>>, graph: array{nodes: list<array<string, mixed>>, edges: list<array<string, mixed>>}} $childAnalysis
     * @param array{scope: string, files: list<array<string, mixed>>, graph: array{nodes: list<array<string, mixed>>, edges: list<array<string, mixed>>}}|null $parentAnalysis
     * @return array{nodes: list<array<string, mixed>>, edges: list<array<string, mixed>>}
     */
    private function mergeScopedGraphs( array $childAnalysis, ?array $parentAnalysis ): array
    {
        $nodes   = [];
        $edges   = [];
        $nodeIds = [];

        $append = static function ( array $analysis, string $scope ) use ( &$nodes, &$edges, &$nodeIds ): void {
            foreach ( $analysis['graph']['nodes'] as $node ) {
                $id = (string) ( $node['id'] ?? '' );
                if ( '' === $id || isset( $nodeIds[ $id ] ) ) {
                    continue;
                }
                $node['scope']  = $scope;
                $nodes[]        = $node;
                $nodeIds[ $id ] = true;
            }

            foreach ( $analysis['graph']['edges'] as $edge ) {
                $edges[] = $edge;
            }
        };

        $append( $childAnalysis, 'child' );

        if ( null !== $parentAnalysis ) {
            $append( $parentAnalysis, 'parent' );
        }

        return [
            'nodes' => $nodes,
            'edges' => $edges,
        ];
    }

    /**
     * God nodes = the most-referenced symbols (highest in-degree of non-structural
     * edges). These are the load-bearing pieces of the codebase; surfacing them up
     * front tells the agent where the gravity is before it reads anything.
     *
     * @param list<array<string, mixed>> $nodes
     * @param list<array<string, mixed>> $edges
     * @return list<array{symbol: string, type: string, scope: string, file: string, in_degree: int}>
     */
    private function computeGodNodes( array $nodes, array $edges, int $limit ): array
    {
        $structural = [ 'contains' ];
        $inDegree   = [];

        foreach ( $edges as $edge ) {
            $type = (string) ( $edge['type'] ?? '' );
            if ( in_array( $type, $structural, true ) ) {
                continue;
            }

            $target = (string) ( $edge['to'] ?? '' );
            if ( '' === $target ) {
                continue;
            }

            $inDegree[ $target ] = ( $inDegree[ $target ] ?? 0 ) + 1;
        }

        $nodeById = [];
        foreach ( $nodes as $node ) {
            $id = (string) ( $node['id'] ?? '' );
            if ( '' !== $id ) {
                $nodeById[ $id ] = $node;
            }
        }

        $ranked = [];
        foreach ( $inDegree as $symbol => $degree ) {
            $node = $nodeById[ $symbol ] ?? null;
            $type = $node['type'] ?? 'unknown';

            // File nodes are containers, not symbols of interest here.
            if ( 'file' === $type ) {
                continue;
            }

            $ranked[] = [
                'symbol'    => (string) $symbol,
                'type'      => (string) $type,
                'scope'     => (string) ( $node['scope'] ?? 'unknown' ),
                'file'      => (string) ( $node['file'] ?? '' ),
                'in_degree' => (int) $degree,
            ];
        }

        usort(
            $ranked,
            static function ( array $a, array $b ): int {
                if ( $a['in_degree'] === $b['in_degree'] ) {
                    return strcmp( $a['symbol'], $b['symbol'] );
                }

                return $b['in_degree'] <=> $a['in_degree'];
            }
        );

        return array_slice( $ranked, 0, $limit );
    }

    /**
     * Cluster files into responsibility communities by their location/role so the
     * agent has a coarse table of contents (header, footer, template-parts,
     * woocommerce, assets, includes, root).
     *
     * @param list<array<string, mixed>> $files
     * @return list<array{name: string, scope: string, files: list<string>}>
     */
    private function computeCommunities( array $files, string $scope ): array
    {
        $buckets = [];

        foreach ( $files as $file ) {
            $path   = (string) ( $file['path'] ?? '' );
            $bucket = $this->classifyCommunity( $path );

            if ( ! isset( $buckets[ $bucket ] ) ) {
                $buckets[ $bucket ] = [];
            }

            $buckets[ $bucket ][] = $path;
        }

        $communities = [];
        foreach ( $buckets as $name => $paths ) {
            sort( $paths, SORT_STRING );
            $communities[] = [
                'name'  => $name,
                'scope' => $scope,
                'files' => array_slice( $paths, 0, 25 ),
            ];
        }

        return $communities;
    }

    private function classifyCommunity( string $path ): string
    {
        $lower = strtolower( $path );

        if ( str_contains( $lower, 'woocommerce' ) || str_contains( $lower, '/woo' ) ) {
            return 'woocommerce';
        }
        if ( str_starts_with( $lower, 'templates/' ) || str_contains( $lower, '/templates/' ) ) {
            return 'templates';
        }
        if ( str_starts_with( $lower, 'template-parts/' ) ) {
            return 'template-parts';
        }
        if ( str_starts_with( $lower, 'inc/' ) ) {
            return 'includes';
        }
        if ( str_starts_with( $lower, 'assets/' ) ) {
            return 'assets';
        }
        if ( in_array( $lower, [ 'header.php', 'footer.php' ], true ) ) {
            return 'site-chrome';
        }
        if ( str_starts_with( $lower, 'page-' ) || str_starts_with( $lower, 'single' ) || str_starts_with( $lower, 'archive' ) ) {
            return 'wp-templates';
        }

        return 'root';
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
