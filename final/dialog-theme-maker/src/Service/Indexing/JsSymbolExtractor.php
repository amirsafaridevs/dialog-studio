<?php

declare(strict_types=1);

namespace DialogStudio\Service\Indexing;

/**
 * Extracts JavaScript class declarations, methods, and named functions.
 */
class JsSymbolExtractor
{
    /**
     * @return array{
     *     classes: list<array{name: string, methods: list<string>}>,
     *     functions: list<string>
     * }
     */
    public function extract( string $source ): array
    {
        $stripped = $this->stripCommentsAndStrings( $source );

        $classes   = $this->extractClasses( $stripped );
        $functions = $this->extractStandaloneFunctions( $stripped );

        foreach ( $classes as $className => $methods ) {
            sort( $methods, SORT_STRING );
            $classes[ $className ] = $methods;
        }

        $classEntries = [];

        foreach ( $classes as $className => $methods ) {
            $classEntries[] = [
                'name'    => $className,
                'methods' => $methods,
            ];
        }

        usort(
            $classEntries,
            static fn ( array $left, array $right ): int => strcmp( $left['name'], $right['name'] )
        );

        sort( $functions, SORT_STRING );

        return [
            'classes'   => $classEntries,
            'functions' => $functions,
        ];
    }

    private function stripCommentsAndStrings( string $source ): string
    {
        $source = preg_replace( '/\/\*.*?\*\//s', '', $source ) ?? $source;
        $source = preg_replace( '/\/\/.*$/m', '', $source ) ?? $source;
        $source = preg_replace( "/'(?:\\\\.|[^'\\\\])*'/", "''", $source ) ?? $source;
        $source = preg_replace( '/"(?:\\\\.|[^"\\\\])*"/', '""', $source ) ?? $source;
        $source = preg_replace( '/`(?:\\\\.|[^`\\\\])*`/', '``', $source ) ?? $source;

        return $source;
    }

    /**
     * @return array<string, list<string>>
     */
    private function extractClasses( string $source ): array
    {
        $classes = [];

        if ( ! preg_match_all(
            '/\bclass\s+([A-Za-z_$][\w$]*)\s*(?:extends\s+[^{]+)?\{/',
            $source,
            $matches,
            PREG_OFFSET_CAPTURE
        ) ) {
            return $classes;
        }

        foreach ( $matches[0] as $index => $match ) {
            $className  = $matches[1][ $index ][0];
            $startIndex = $match[1] + strlen( $match[0] );
            $body       = $this->extractBalancedBlock( $source, $startIndex );

            if ( null === $body ) {
                $classes[ $className ] = [];

                continue;
            }

            $classes[ $className ] = $this->extractMethodsFromClassBody( $body );
        }

        return $classes;
    }

    /**
     * @return list<string>
     */
    private function extractMethodsFromClassBody( string $body ): array
    {
        $methods = [];

        $patterns = [
            '/^\s*(?:async\s+)?(?:static\s+)?(?:get|set)\s+([A-Za-z_$][\w$]*)\s*\(/m',
            '/^\s*(?:async\s+)?(?:static\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/m',
        ];

        foreach ( $patterns as $pattern ) {
            if ( preg_match_all( $pattern, $body, $matches ) ) {
                foreach ( $matches[1] as $methodName ) {
                    if ( 'constructor' !== $methodName ) {
                        $methods[ $methodName ] = true;
                    }
                }
            }
        }

        return array_keys( $methods );
    }

    /**
     * @return list<string>
     */
    private function extractStandaloneFunctions( string $source ): array
    {
        $functions = [];

        if ( preg_match_all( '/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/', $source, $matches ) ) {
            foreach ( $matches[1] as $functionName ) {
                $functions[ $functionName ] = true;
            }
        }

        if ( preg_match_all(
            '/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*=>)/',
            $source,
            $matches
        ) ) {
            foreach ( $matches[1] as $functionName ) {
                $functions[ $functionName ] = true;
            }
        }

        return array_keys( $functions );
    }

    private function extractBalancedBlock( string $source, int $startIndex ): ?string
    {
        $length  = strlen( $source );
        $depth   = 1;
        $content = '';

        for ( $index = $startIndex; $index < $length; $index++ ) {
            $character = $source[ $index ];

            if ( '{' === $character ) {
                ++$depth;
            } elseif ( '}' === $character ) {
                --$depth;

                if ( 0 === $depth ) {
                    return $content;
                }
            }

            if ( $depth > 0 ) {
                $content .= $character;
            }
        }

        return null;
    }
}
