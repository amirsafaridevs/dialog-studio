<?php

declare(strict_types=1);

namespace DialogStudio\Service\Indexing;

/**
 * Extracts CSS class selectors and named at-rules from stylesheet source.
 */
class CssSymbolExtractor
{
    /**
     * @return array{
     *     classes: list<string>,
     *     functions: list<string>
     * }
     */
    public function extract( string $source ): array
    {
        $stripped = $this->stripComments( $source );

        $classes = $this->extractClassSelectors( $stripped );
        $functions = $this->extractNamedAtRules( $stripped );

        sort( $classes, SORT_STRING );
        sort( $functions, SORT_STRING );

        return [
            'classes'   => $classes,
            'functions' => $functions,
        ];
    }

    private function stripComments( string $source ): string
    {
        $source = preg_replace( '/\/\*.*?\*\//s', '', $source ) ?? $source;

        return preg_replace( '/\/\/.*$/m', '', $source ) ?? $source;
    }

    /**
     * @return list<string>
     */
    private function extractClassSelectors( string $source ): array
    {
        $classes = [];

        if ( preg_match_all( '/\.([a-zA-Z_][\w-]*)/', $source, $matches ) ) {
            foreach ( $matches[1] as $className ) {
                $classes[ $className ] = true;
            }
        }

        return array_keys( $classes );
    }

    /**
     * @return list<string>
     */
    private function extractNamedAtRules( string $source ): array
    {
        $names = [];

        $patterns = [
            '/@keyframes\s+([a-zA-Z_][\w-]*)/',
            '/@mixin\s+([a-zA-Z_][\w-]*)/',
            '/@function\s+([a-zA-Z_][\w-]*)/',
        ];

        foreach ( $patterns as $pattern ) {
            if ( preg_match_all( $pattern, $source, $matches ) ) {
                foreach ( $matches[1] as $name ) {
                    $names[ $name ] = true;
                }
            }
        }

        return array_keys( $names );
    }
}
