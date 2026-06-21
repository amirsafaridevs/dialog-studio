<?php

declare(strict_types=1);

namespace DialogStudio\Service\Indexing;

/**
 * Central in-memory symbol registry with O(1) lookups.
 */
class SymbolRegistry
{
    /** @var array<string, array{type: string, file: string, methods?: list<string>}> */
    private array $symbols = [];

    /** @var array<string, array{type: string, file: string, class: string, name: string}> */
    private array $methods = [];

    /** @var array<string, array{type: string, file: string, name: string}> */
    private array $functions = [];

    /** @var array<string, array{type: string, file: string, methods: list<string>}> */
    private array $classes = [];

    /** @var array<string, array{type: string, file: string, methods: list<string>}> */
    private array $interfaces = [];

    /** @var array<string, array{type: string, file: string, methods: list<string>}> */
    private array $traits = [];

    /**
     * @param array{
     *     theme?: string,
     *     files: list<array{
     *         path: string,
     *         namespace?: string|null,
     *         classes: list<array{name: string, methods: list<string>}>,
     *         interfaces: list<array{name: string, methods: list<string>}>,
     *         traits: list<array{name: string, methods: list<string>}>,
     *         functions: list<string>
     *     }>
     * } $index
     */
    public static function fromIndex( array $index ): self
    {
        $registry = new self();

        foreach ( $index['files'] as $file ) {
            $registry->registerFile( $file );
        }

        return $registry;
    }

    /**
     * @param array{
     *     path: string,
     *     namespace?: string|null,
     *     classes: list<array{name: string, methods: list<string>}>,
     *     interfaces: list<array{name: string, methods: list<string>}>,
     *     traits: list<array{name: string, methods: list<string>}>,
     *     functions: list<string>
     * } $file
     */
    public function registerFile( array $file ): void
    {
        $path      = $file['path'];
        $namespace = $file['namespace'] ?? null;

        foreach ( $file['classes'] as $class ) {
            $className = self::qualifySymbolName( $class['name'], $namespace );
            $entry     = [
                'type'    => 'class',
                'file'    => $path,
                'methods' => $class['methods'],
            ];

            $this->classes[ $className ]  = $entry;
            $this->symbols[ $className ]  = $entry;

            foreach ( $class['methods'] as $methodName ) {
                $methodId = $className . '::' . $methodName;

                $this->methods[ $methodId ] = [
                    'type'  => 'method',
                    'file'  => $path,
                    'class' => $className,
                    'name'  => $methodName,
                ];
            }
        }

        foreach ( $file['interfaces'] as $interface ) {
            $interfaceName = self::qualifySymbolName( $interface['name'], $namespace );
            $entry         = [
                'type'    => 'interface',
                'file'    => $path,
                'methods' => $interface['methods'],
            ];

            $this->interfaces[ $interfaceName ] = $entry;
            $this->symbols[ $interfaceName ]    = $entry;

            foreach ( $interface['methods'] as $methodName ) {
                $methodId = $interfaceName . '::' . $methodName;

                $this->methods[ $methodId ] = [
                    'type'  => 'method',
                    'file'  => $path,
                    'class' => $interfaceName,
                    'name'  => $methodName,
                ];
            }
        }

        foreach ( $file['traits'] as $trait ) {
            $traitName = self::qualifySymbolName( $trait['name'], $namespace );
            $entry     = [
                'type'    => 'trait',
                'file'    => $path,
                'methods' => $trait['methods'],
            ];

            $this->traits[ $traitName ]  = $entry;
            $this->symbols[ $traitName ] = $entry;

            foreach ( $trait['methods'] as $methodName ) {
                $methodId = $traitName . '::' . $methodName;

                $this->methods[ $methodId ] = [
                    'type'  => 'method',
                    'file'  => $path,
                    'class' => $traitName,
                    'name'  => $methodName,
                ];
            }
        }

        foreach ( $file['functions'] as $functionName ) {
            $entry = [
                'type' => 'function',
                'file' => $path,
                'name' => $functionName,
            ];

            $this->functions[ $functionName ]  = $entry;
            $this->symbols[ $functionName ]    = $entry;
        }
    }

    /**
     * @return array{type: string, file: string, methods?: list<string>}|null
     */
    public function findClass( string $name ): ?array
    {
        return $this->classes[ $name ] ?? null;
    }

    /**
     * @return array{type: string, file: string, class: string, name: string}|null
     */
    public function findMethod( string $name ): ?array
    {
        return $this->methods[ $name ] ?? null;
    }

    /**
     * @return array{type: string, file: string, name: string}|null
     */
    public function findFunction( string $name ): ?array
    {
        return $this->functions[ $name ] ?? null;
    }

    /**
     * @return array{type: string, file: string, methods: list<string>}|null
     */
    public function findInterface( string $name ): ?array
    {
        return $this->interfaces[ $name ] ?? null;
    }

    /**
     * @return array{type: string, file: string, methods: list<string>}|null
     */
    public function findTrait( string $name ): ?array
    {
        return $this->traits[ $name ] ?? null;
    }

    /**
     * @return array<string, array{type: string, file: string, methods?: list<string>}>
     */
    public function toArray(): array
    {
        return $this->symbols;
    }

    /**
     * @return array<string, array{type: string, file: string, methods: list<string>}>
     */
    public function getClasses(): array
    {
        return $this->classes;
    }

    /**
     * @return array<string, array{type: string, file: string, methods: list<string>}>
     */
    public function getInterfaces(): array
    {
        return $this->interfaces;
    }

    /**
     * @return array<string, array{type: string, file: string, methods: list<string>}>
     */
    public function getTraits(): array
    {
        return $this->traits;
    }

    /**
     * @return array<string, array{type: string, file: string, name: string}>
     */
    public function getFunctions(): array
    {
        return $this->functions;
    }

    /**
     * @return array<string, array{type: string, file: string, class: string, name: string}>
     */
    public function getMethods(): array
    {
        return $this->methods;
    }

    private static function qualifySymbolName( string $name, ?string $namespace ): string
    {
        if ( str_contains( $name, '\\' ) || null === $namespace || '' === $namespace ) {
            return $name;
        }

        return $namespace . '\\' . $name;
    }
}
