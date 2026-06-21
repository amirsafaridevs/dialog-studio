<?php

declare(strict_types=1);

namespace DialogStudio\Service\Indexing;

/**
 * In-memory code graph with nodes and edges for theme symbol relationships.
 */
class CodeGraph
{
    /** @var list<array{id: string, type: string, file?: string}> */
    private array $nodes = [];

    /** @var list<array{from: string, to: string, type: string, line?: int}> */
    private array $edges = [];

    /** @var array<string, true> */
    private array $nodeIds = [];

    /** @var array<string, true> */
    private array $edgeKeys = [];

    /**
     * @param array{
     *     files: list<array{
     *         path: string,
     *         references?: list<array{
     *             type: string,
     *             source_file: string,
     *             source_symbol: string,
     *             target_symbol: string,
     *             line: int
     *         }>
     *     }>
     * } $index
     */
    public static function build( array $index, SymbolRegistry $registry ): self
    {
        $graph = new self();

        foreach ( $index['files'] as $file ) {
            $graph->addFileNode( $file['path'] );
        }

        foreach ( $registry->getClasses() as $className => $class ) {
            $graph->addNode( $className, 'class', $class['file'] );
            $graph->addEdge( self::fileNodeId( $class['file'] ), $className, 'contains' );

            foreach ( $class['methods'] as $methodName ) {
                $methodId = $className . '::' . $methodName;
                $graph->addNode( $methodId, 'method', $class['file'] );
                $graph->addEdge( $className, $methodId, 'contains' );
            }
        }

        foreach ( $registry->getInterfaces() as $interfaceName => $interface ) {
            $graph->addNode( $interfaceName, 'interface', $interface['file'] );
            $graph->addEdge( self::fileNodeId( $interface['file'] ), $interfaceName, 'contains' );

            foreach ( $interface['methods'] as $methodName ) {
                $methodId = $interfaceName . '::' . $methodName;
                $graph->addNode( $methodId, 'method', $interface['file'] );
                $graph->addEdge( $interfaceName, $methodId, 'contains' );
            }
        }

        foreach ( $registry->getTraits() as $traitName => $trait ) {
            $graph->addNode( $traitName, 'trait', $trait['file'] );
            $graph->addEdge( self::fileNodeId( $trait['file'] ), $traitName, 'contains' );

            foreach ( $trait['methods'] as $methodName ) {
                $methodId = $traitName . '::' . $methodName;
                $graph->addNode( $methodId, 'method', $trait['file'] );
                $graph->addEdge( $traitName, $methodId, 'contains' );
            }
        }

        foreach ( $registry->getFunctions() as $functionName => $function ) {
            $graph->addNode( $functionName, 'function', $function['file'] );
            $graph->addEdge( self::fileNodeId( $function['file'] ), $functionName, 'contains' );
        }

        foreach ( $index['files'] as $file ) {
            foreach ( $file['references'] ?? [] as $reference ) {
                $graph->addReferenceEdge( $reference );
            }
        }

        return $graph;
    }

    /**
     * @param array{
     *     type: string,
     *     source_file: string,
     *     source_symbol: string,
     *     target_symbol: string,
     *     line: int
     * } $reference
     */
    private function addReferenceEdge( array $reference ): void
    {
        $sourceSymbol = $reference['source_symbol'];
        $targetSymbol = $reference['target_symbol'];
        $line         = $reference['line'];
        $type         = $reference['type'];

        if ( in_array( $type, [ 'static_call', 'method_call', 'function_call', 'hook_invoke', 'instantiation' ], true ) ) {
            $this->ensureContextNode( $sourceSymbol, $reference['source_file'] );
        }

        switch ( $type ) {
            case 'extends':
                $this->addNode( $targetSymbol, 'class' );
                $this->addEdge( $sourceSymbol, $targetSymbol, 'extends', $line );
                break;

            case 'implements':
                $this->addNode( $targetSymbol, 'interface' );
                $this->addEdge( $sourceSymbol, $targetSymbol, 'implements', $line );
                break;

            case 'uses_trait':
                $this->addNode( $targetSymbol, 'trait' );
                $this->addEdge( $sourceSymbol, $targetSymbol, 'uses_trait', $line );
                break;

            case 'instantiation':
                $this->addNode( $targetSymbol, 'class' );
                $this->addEdge( $sourceSymbol, $targetSymbol, 'instantiates', $line );
                break;

            case 'static_call':
            case 'method_call':
                $this->ensureCallableNode( $targetSymbol, $reference['source_file'] );
                $this->addEdge( $sourceSymbol, $targetSymbol, 'calls', $line );
                break;

            case 'function_call':
                $this->addNode( $targetSymbol, 'function' );
                $this->addEdge( $sourceSymbol, $targetSymbol, 'calls', $line );
                break;

            case 'hook_callback':
                $this->addNode( $sourceSymbol, 'hook' );
                $this->ensureCallableNode( $targetSymbol, $reference['source_file'] );
                $this->addEdge( $sourceSymbol, $targetSymbol, 'hook_callback', $line );
                break;

            case 'hook_invoke':
                $this->addNode( $targetSymbol, 'hook' );
                $this->addEdge( $sourceSymbol, $targetSymbol, 'hook_invoke', $line );
                break;
        }
    }

    private function ensureContextNode( string $sourceSymbol, string $file ): void
    {
        if ( str_contains( $sourceSymbol, '::' ) ) {
            $this->addNode( $sourceSymbol, 'method', $file );

            return;
        }

        $this->addNode( $sourceSymbol, 'function', $file );
    }

    private function ensureCallableNode( string $targetSymbol, string $file ): void
    {
        if ( str_contains( $targetSymbol, '::' ) ) {
            $this->addNode( $targetSymbol, 'method', $file );

            return;
        }

        $this->addNode( $targetSymbol, 'function', $file );
    }

    private function addFileNode( string $path ): void
    {
        $this->addNode( self::fileNodeId( $path ), 'file', $path );
    }

    private function addNode( string $id, string $type, ?string $file = null ): void
    {
        if ( isset( $this->nodeIds[ $id ] ) ) {
            return;
        }

        $node = [
            'id'   => $id,
            'type' => $type,
        ];

        if ( null !== $file && '' !== $file ) {
            $node['file'] = $file;
        }

        $this->nodes[]        = $node;
        $this->nodeIds[ $id ] = true;
    }

    private function addEdge( string $from, string $to, string $type, ?int $line = null ): void
    {
        $edgeKey = $from . '|' . $to . '|' . $type . '|' . (string) ( $line ?? 0 );

        if ( isset( $this->edgeKeys[ $edgeKey ] ) ) {
            return;
        }

        $edge = [
            'from' => $from,
            'to'   => $to,
            'type' => $type,
        ];

        if ( null !== $line && $line > 0 ) {
            $edge['line'] = $line;
        }

        $this->edges[]             = $edge;
        $this->edgeKeys[ $edgeKey ] = true;
    }

    /**
     * @return array{nodes: list<array{id: string, type: string, file?: string}>, edges: list<array{from: string, to: string, type: string, line?: int}>}
     */
    public function toArray(): array
    {
        return [
            'nodes' => $this->nodes,
            'edges' => $this->edges,
        ];
    }

    /**
     * @return list<array{from: string, to: string, type: string, line?: int}>
     */
    public function findEdgesTo( string $targetId, ?string $type = null ): array
    {
        return array_values(
            array_filter(
                $this->edges,
                static function ( array $edge ) use ( $targetId, $type ): bool {
                    if ( $edge['to'] !== $targetId ) {
                        return false;
                    }

                    return null === $type || $edge['type'] === $type;
                }
            )
        );
    }

    /**
     * @return list<array{from: string, to: string, type: string, line?: int}>
     */
    public function findEdgesFrom( string $sourceId, ?string $type = null ): array
    {
        return array_values(
            array_filter(
                $this->edges,
                static function ( array $edge ) use ( $sourceId, $type ): bool {
                    if ( $edge['from'] !== $sourceId ) {
                        return false;
                    }

                    return null === $type || $edge['type'] === $type;
                }
            )
        );
    }

    /**
     * @return list<string>
     */
    public function findHookCallbacks( string $hookName ): array
    {
        return array_values(
            array_map(
                static fn ( array $edge ): string => $edge['to'],
                $this->findEdgesFrom( $hookName, 'hook_callback' )
            )
        );
    }

    private static function fileNodeId( string $path ): string
    {
        return 'file:' . $path;
    }
}
