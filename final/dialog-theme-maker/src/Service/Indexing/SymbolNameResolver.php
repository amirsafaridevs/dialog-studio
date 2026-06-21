<?php

declare(strict_types=1);

namespace DialogStudio\Service\Indexing;

use PhpParser\Node\Name;

/**
 * Resolves PHP symbol names using the current namespace and use-import map.
 */
class SymbolNameResolver
{
    private ?string $namespace = null;

    /** @var array<string, string> */
    private array $useMap = [];

    public function reset(): void
    {
        $this->namespace = null;
        $this->useMap    = [];
    }

    public function setNamespace( ?string $namespace ): void
    {
        $this->namespace = $namespace;
    }

    public function addUse( string $alias, string $fqcn ): void
    {
        $this->useMap[ $alias ] = $fqcn;
    }

    public function resolveName( Name|string|null $name ): ?string
    {
        if ( null === $name ) {
            return null;
        }

        if ( is_string( $name ) ) {
            $name = trim( $name );

            return '' !== $name ? $name : null;
        }

        if ( $name->isFullyQualified() ) {
            return ltrim( $name->toString(), '\\' );
        }

        $parts = $name->getParts();

        if ( [] === $parts ) {
            return null;
        }

        $first = $parts[0];

        if ( isset( $this->useMap[ $first ] ) ) {
            $resolved = $this->useMap[ $first ];

            if ( count( $parts ) > 1 ) {
                $resolved .= '\\' . implode( '\\', array_slice( $parts, 1 ) );
            }

            return $resolved;
        }

        if ( null !== $this->namespace && '' !== $this->namespace ) {
            return $this->namespace . '\\' . $name->toString();
        }

        return $name->toString();
    }

    public function resolveClassName( Name|string|null $name ): ?string
    {
        return $this->resolveName( $name );
    }

    public function qualifyMethod( string $className, string $methodName ): string
    {
        return $className . '::' . $methodName;
    }
}
