<?php

declare(strict_types=1);

namespace DialogStudio\Service\Indexing;

use PhpParser\Node;
use PhpParser\Node\Expr\ClassConstFetch;
use PhpParser\Node\Expr\FuncCall;
use PhpParser\Node\Expr\MethodCall;
use PhpParser\Node\Expr\New_;
use PhpParser\Node\Expr\StaticCall;
use PhpParser\Node\Name;
use PhpParser\Node\Scalar\String_;
use PhpParser\Node\Stmt\Class_;
use PhpParser\Node\Stmt\ClassMethod;
use PhpParser\Node\Stmt\Function_;
use PhpParser\Node\Stmt\Interface_;
use PhpParser\Node\Stmt\Namespace_;
use PhpParser\Node\Stmt\Trait_;
use PhpParser\Node\Stmt\TraitUse;
use PhpParser\Node\Stmt\Use_;
use PhpParser\Node\Stmt\UseUse;
use PhpParser\NodeVisitorAbstract;

/**
 * AST visitor that extracts namespaces, types, callables, and symbol references from a PHP file.
 */
class ThemeAstVisitor extends NodeVisitorAbstract
{
    private SymbolNameResolver $nameResolver;

    private ?string $namespace = null;

    private ?string $currentClass = null;

    private ?string $currentClassParent = null;

    private ?string $currentMethod = null;

    private ?string $currentFunction = null;

    /** @var list<array{name: string, methods: list<string>}> */
    private array $classes = [];

    /** @var list<array{name: string, methods: list<string>}> */
    private array $interfaces = [];

    /** @var list<array{name: string, methods: list<string>}> */
    private array $traits = [];

    /** @var list<string> */
    private array $functions = [];

    /** @var list<array{type: string, source_symbol: string, target_symbol: string, line: int}> */
    private array $references = [];

    /** @var list<string> */
    private const WORDPRESS_HOOK_REGISTRARS = [
        'add_action',
        'add_filter',
        'add_shortcode',
    ];

    /** @var list<string> */
    private const WORDPRESS_HOOK_INVOKERS = [
        'do_action',
        'apply_filters',
    ];

    public function __construct( ?SymbolNameResolver $nameResolver = null )
    {
        $this->nameResolver = $nameResolver ?? new SymbolNameResolver();
    }

    /**
     * Reset collected state before traversing a new file.
     */
    public function reset(): void
    {
        $this->namespace           = null;
        $this->currentClass        = null;
        $this->currentClassParent  = null;
        $this->currentMethod       = null;
        $this->currentFunction     = null;
        $this->classes             = [];
        $this->interfaces          = [];
        $this->traits              = [];
        $this->functions           = [];
        $this->references          = [];
        $this->nameResolver->reset();
    }

    /**
     * @return array{
     *     namespace: string|null,
     *     classes: list<array{name: string, methods: list<string>}>,
     *     interfaces: list<array{name: string, methods: list<string>}>,
     *     traits: list<array{name: string, methods: list<string>}>,
     *     functions: list<string>,
     *     references: list<array{type: string, source_symbol: string, target_symbol: string, line: int}>
     * }
     */
    public function getResult(): array
    {
        return [
            'namespace'  => $this->namespace,
            'classes'    => $this->classes,
            'interfaces' => $this->interfaces,
            'traits'     => $this->traits,
            'functions'  => $this->functions,
            'references' => $this->references,
        ];
    }

    public function enterNode( Node $node ): ?int
    {
        if ( $node instanceof Namespace_ ) {
            $this->namespace = $this->resolveNamespaceName( $node );
            $this->nameResolver->setNamespace( $this->namespace );

            return null;
        }

        if ( $node instanceof Use_ ) {
            $this->registerUseStatements( $node );

            return null;
        }

        if ( $node instanceof Class_ ) {
            $this->enterClass( $node );

            return null;
        }

        if ( $node instanceof Interface_ ) {
            $this->enterInterface( $node );

            return null;
        }

        if ( $node instanceof Trait_ ) {
            $this->enterTrait( $node );

            return null;
        }

        if ( $node instanceof ClassMethod ) {
            $this->currentMethod = $node->name->toString();

            return null;
        }

        if ( $node instanceof Function_ ) {
            $functionName = $node->name?->toString();

            if ( is_string( $functionName ) && '' !== $functionName ) {
                $this->functions[]     = $functionName;
                $this->currentFunction = $functionName;
            }

            return null;
        }

        if ( $node instanceof TraitUse ) {
            $this->collectTraitUses( $node );

            return null;
        }

        if ( $node instanceof New_ ) {
            $this->collectInstantiation( $node );

            return null;
        }

        if ( $node instanceof StaticCall ) {
            $this->collectStaticCall( $node );

            return null;
        }

        if ( $node instanceof MethodCall ) {
            $this->collectMethodCall( $node );

            return null;
        }

        if ( $node instanceof FuncCall ) {
            $this->collectFunctionCall( $node );

            return null;
        }

        return null;
    }

    public function leaveNode( Node $node ): void
    {
        if ( $node instanceof Class_ ) {
            $this->currentClass       = null;
            $this->currentClassParent = null;
            $this->currentMethod      = null;
        }

        if ( $node instanceof Interface_ || $node instanceof Trait_ ) {
            $this->currentClass  = null;
            $this->currentMethod = null;
        }

        if ( $node instanceof ClassMethod ) {
            $this->currentMethod = null;
        }

        if ( $node instanceof Function_ ) {
            $this->currentFunction = null;
        }
    }

    private function enterClass( Class_ $node ): void
    {
        $className = $this->resolveClassName( $node->name?->toString() );

        if ( null === $className ) {
            return;
        }

        $this->classes[]    = [
            'name'    => $className,
            'methods' => $this->extractMethods( $node ),
        ];
        $this->currentClass = $className;

        if ( null !== $node->extends ) {
            $parent = $this->nameResolver->resolveClassName( $node->extends );

            if ( null !== $parent ) {
                $this->currentClassParent = $parent;
                $this->addReference( 'extends', $parent, $node->getStartLine(), $className );
            }
        }

        foreach ( $node->implements as $interface ) {
            $interfaceName = $this->nameResolver->resolveClassName( $interface );

            if ( null !== $interfaceName ) {
                $this->addReference( 'implements', $interfaceName, $node->getStartLine(), $className );
            }
        }
    }

    private function enterInterface( Interface_ $node ): void
    {
        $interfaceName = $this->resolveClassName( $node->name?->toString() );

        if ( null === $interfaceName ) {
            return;
        }

        $this->interfaces[] = [
            'name'    => $interfaceName,
            'methods' => $this->extractMethods( $node ),
        ];
        $this->currentClass = $interfaceName;
    }

    private function enterTrait( Trait_ $node ): void
    {
        $traitName = $this->resolveClassName( $node->name?->toString() );

        if ( null === $traitName ) {
            return;
        }

        $this->traits[]     = [
            'name'    => $traitName,
            'methods' => $this->extractMethods( $node ),
        ];
        $this->currentClass = $traitName;
    }

    private function registerUseStatements( Use_ $node ): void
    {
        foreach ( $node->uses as $use ) {
            if ( ! $use instanceof UseUse ) {
                continue;
            }

            $fqcn  = $this->resolveUseImportName( $use );
            $alias = $use->alias?->toString() ?? $use->name->getLast();

            if ( '' !== $fqcn && is_string( $alias ) && '' !== $alias ) {
                $this->nameResolver->addUse( $alias, $fqcn );
            }
        }
    }

    private function resolveUseImportName( UseUse $use ): string
    {
        if ( $use->name->isFullyQualified() ) {
            return ltrim( $use->name->toString(), '\\' );
        }

        $parts = $use->name->getParts();

        if ( 1 === count( $parts ) && null !== $this->namespace && '' !== $this->namespace ) {
            return $this->namespace . '\\' . $parts[0];
        }

        return $use->name->toString();
    }

    private function collectTraitUses( TraitUse $node ): void
    {
        if ( null === $this->currentClass ) {
            return;
        }

        foreach ( $node->traits as $trait ) {
            $traitName = $this->nameResolver->resolveClassName( $trait );

            if ( null !== $traitName ) {
                $this->addReference( 'uses_trait', $traitName, $node->getStartLine() );
            }
        }
    }

    private function collectInstantiation( New_ $node ): void
    {
        if ( ! $node->class instanceof Name ) {
            return;
        }

        $className = $this->nameResolver->resolveClassName( $node->class );

        if ( null !== $className ) {
            $this->addReference( 'instantiation', $className, $node->getStartLine() );
        }
    }

    private function collectStaticCall( StaticCall $node ): void
    {
        $methodName = $node->name instanceof Node\Identifier
            ? $node->name->toString()
            : ( $node->name instanceof Node\Expr ? null : (string) $node->name );

        if ( null === $methodName || '' === $methodName ) {
            return;
        }

        $className = null;

        if ( $node->class instanceof Name ) {
            $keyword = $node->class->toString();

            if ( 'self' === $keyword || 'static' === $keyword ) {
                $className = $this->currentClass;
            } elseif ( 'parent' === $keyword ) {
                $className = $this->currentClassParent;
            } else {
                $className = $this->nameResolver->resolveClassName( $node->class );
            }
        }

        $target = null !== $className
            ? $this->nameResolver->qualifyMethod( $className, $methodName )
            : '*::' . $methodName;

        $this->addReference( 'static_call', $target, $node->getStartLine() );
    }

    private function collectMethodCall( MethodCall $node ): void
    {
        $methodName = $node->name instanceof Node\Identifier
            ? $node->name->toString()
            : null;

        if ( null === $methodName || '' === $methodName ) {
            return;
        }

        $className = $this->resolveMethodCallClass( $node );

        $target = null !== $className
            ? $this->nameResolver->qualifyMethod( $className, $methodName )
            : '?::' . $methodName;

        $this->addReference( 'method_call', $target, $node->getStartLine() );
    }

    private function resolveMethodCallClass( MethodCall $node ): ?string
    {
        $variable = $node->var;

        if ( $variable instanceof Node\Expr\Variable && is_string( $variable->name ) ) {
            if ( 'this' === $variable->name ) {
                return $this->currentClass;
            }
        }

        if ( $variable instanceof ClassConstFetch && $variable->class instanceof Name ) {
            $className = $this->nameResolver->resolveClassName( $variable->class );

            if ( null !== $className ) {
                return $className;
            }
        }

        if ( $variable instanceof StaticCall && $variable->class instanceof Name ) {
            return $this->nameResolver->resolveClassName( $variable->class );
        }

        return null;
    }

    private function collectFunctionCall( FuncCall $node ): void
    {
        $functionName = $this->resolveCallableName( $node->name );

        if ( null === $functionName || '' === $functionName ) {
            return;
        }

        if ( $this->collectWordPressHookReference( $functionName, $node ) ) {
            return;
        }

        $this->addReference( 'function_call', $functionName, $node->getStartLine() );
    }

    private function collectWordPressHookReference( string $functionName, FuncCall $node ): bool
    {
        if ( in_array( $functionName, self::WORDPRESS_HOOK_REGISTRARS, true ) ) {
            $hookName = $this->extractStringArgument( $node->args[0] ?? null );
            $callback = $this->extractCallbackSymbol( $node->args[1] ?? null );

            if ( null !== $hookName && null !== $callback ) {
                $this->addHookCallbackReference( $hookName, $callback, $node->getStartLine() );
            }

            return true;
        }

        if ( in_array( $functionName, self::WORDPRESS_HOOK_INVOKERS, true ) ) {
            $hookName = $this->extractStringArgument( $node->args[0] ?? null );

            if ( null !== $hookName ) {
                $this->addReference( 'hook_invoke', $hookName, $node->getStartLine() );
            }

            return true;
        }

        if ( 'register_rest_route' === $functionName ) {
            $callback = $this->extractRestRouteCallback( $node );

            if ( null !== $callback ) {
                $namespace = $this->extractStringArgument( $node->args[0] ?? null ) ?? 'rest';
                $route     = $this->extractStringArgument( $node->args[1] ?? null ) ?? '/';
                $hookName  = trim( $namespace, '/' ) . ':' . $route;

                $this->addHookCallbackReference( $hookName, $callback, $node->getStartLine() );
            }

            return true;
        }

        return false;
    }

    private function extractRestRouteCallback( FuncCall $node ): ?string
    {
        $optionsArg = $node->args[2] ?? $node->args[1] ?? null;

        if ( null === $optionsArg ) {
            return null;
        }

        return $this->extractArrayCallback( $optionsArg->value ?? null, 'callback' );
    }

    /**
     * @param Class_|Interface_|Trait_ $typeNode
     * @return list<string>
     */
    private function extractMethods( Class_|Interface_|Trait_ $typeNode ): array
    {
        $methods = [];

        foreach ( $typeNode->stmts ?? [] as $statement ) {
            if ( ! $statement instanceof ClassMethod ) {
                continue;
            }

            $methods[] = $statement->name->toString();
        }

        return $methods;
    }

    private function resolveNamespaceName( Namespace_ $node ): ?string
    {
        if ( null === $node->name ) {
            return null;
        }

        $name = $node->name->toString();

        return '' !== $name ? $name : null;
    }

    private function resolveClassName( ?string $name ): ?string
    {
        if ( null === $name || '' === $name ) {
            return null;
        }

        if ( str_contains( $name, '\\' ) || null === $this->namespace || '' === $this->namespace ) {
            return $name;
        }

        return $this->namespace . '\\' . $name;
    }

    private function resolveCallableName( Node\Expr\FuncCall|Node\Expr\StaticCall|Node\Expr\MethodCall|Node\Expr|Node\Name|null $callable ): ?string
    {
        if ( $callable instanceof Name ) {
            return $callable->toString();
        }

        if ( $callable instanceof Node\Expr\Variable && is_string( $callable->name ) ) {
            return $callable->name;
        }

        return null;
    }

    private function extractStringArgument( ?Node\Arg $argument ): ?string
    {
        if ( null === $argument ) {
            return null;
        }

        $value = $argument->value;

        if ( $value instanceof String_ ) {
            return $value->value;
        }

        return null;
    }

    private function extractCallbackSymbol( ?Node\Arg $argument ): ?string
    {
        if ( null === $argument ) {
            return null;
        }

        $value = $argument->value;

        if ( $value instanceof String_ ) {
            return $value->value;
        }

        if ( $value instanceof Node\Expr\Array_ ) {
            return $this->extractArrayCallable( $value );
        }

        if ( $value instanceof StaticCall && $value->class instanceof Name ) {
            $className  = $this->nameResolver->resolveClassName( $value->class );
            $methodName = $value->name instanceof Node\Identifier ? $value->name->toString() : null;

            if ( null !== $className && null !== $methodName ) {
                return $this->nameResolver->qualifyMethod( $className, $methodName );
            }
        }

        if ( $value instanceof ClassConstFetch && $value->class instanceof Name ) {
            $className = $this->nameResolver->resolveClassName( $value->class );

            return $className;
        }

        return null;
    }

    private function extractArrayCallable( Node\Expr\Array_ $array ): ?string
    {
        $items = $array->items;

        if ( count( $items ) < 2 ) {
            return null;
        }

        $classItem  = $items[0];
        $methodItem = $items[1];

        if ( null === $classItem || null === $methodItem ) {
            return null;
        }

        $className  = $this->extractCallableValue( $classItem->value );
        $methodName = $this->extractCallableValue( $methodItem->value );

        if ( null === $className || null === $methodName ) {
            return null;
        }

        return $this->nameResolver->qualifyMethod( $className, $methodName );
    }

    private function extractArrayCallback( ?Node\Expr $value, string $key ): ?string
    {
        if ( ! $value instanceof Node\Expr\Array_ ) {
            return null;
        }

        foreach ( $value->items as $item ) {
            if ( null === $item || null === $item->key ) {
                continue;
            }

            $itemKey = $this->extractCallableValue( $item->key );

            if ( $key !== $itemKey ) {
                continue;
            }

            if ( $item->value instanceof String_ ) {
                return $item->value->value;
            }

            if ( $item->value instanceof Node\Expr\Array_ ) {
                return $this->extractArrayCallable( $item->value );
            }

            if ( $item->value instanceof StaticCall && $item->value->class instanceof Name ) {
                $className  = $this->nameResolver->resolveClassName( $item->value->class );
                $methodName = $item->value->name instanceof Node\Identifier
                    ? $item->value->name->toString()
                    : null;

                if ( null !== $className && null !== $methodName ) {
                    return $this->nameResolver->qualifyMethod( $className, $methodName );
                }
            }
        }

        return null;
    }

    private function extractCallableValue( ?Node\Expr $value ): ?string
    {
        if ( $value instanceof String_ ) {
            return $value->value;
        }

        if ( $value instanceof ClassConstFetch && $value->class instanceof Name ) {
            return $this->nameResolver->resolveClassName( $value->class );
        }

        if ( $value instanceof Name ) {
            return $this->nameResolver->resolveClassName( $value );
        }

        return null;
    }

    private function addReference( string $type, string $targetSymbol, int $line, ?string $sourceSymbol = null ): void
    {
        $this->references[] = [
            'type'          => $type,
            'source_symbol' => $sourceSymbol ?? $this->resolveSourceSymbol(),
            'target_symbol' => $targetSymbol,
            'line'          => $line,
        ];
    }

    private function addHookCallbackReference( string $hookName, string $callback, int $line ): void
    {
        $this->references[] = [
            'type'          => 'hook_callback',
            'source_symbol' => $hookName,
            'target_symbol' => $callback,
            'line'          => $line,
        ];
    }

    private function resolveSourceSymbol(): string
    {
        if ( null !== $this->currentClass && null !== $this->currentMethod ) {
            return $this->nameResolver->qualifyMethod( $this->currentClass, $this->currentMethod );
        }

        if ( null !== $this->currentFunction ) {
            return $this->currentFunction;
        }

        if ( null !== $this->currentClass ) {
            return $this->currentClass;
        }

        return '(global)';
    }
}
