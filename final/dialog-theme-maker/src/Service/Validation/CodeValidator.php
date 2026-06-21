<?php

declare(strict_types=1);

namespace DialogStudio\Service\Validation;

use DialogStudio\Exception\ThemeIndexingException;
use DialogStudio\Service\Indexing\ThemeFileScanner;
use Peast\Peast;
use Peast\Syntax\Exception as PeastSyntaxException;
use PhpParser\Error as PhpParserError;
use PhpParser\Parser;
use PhpParser\ParserFactory;
use Sabberworm\CSS\Parser as CssParser;
use Sabberworm\CSS\Parsing\SourceException as CssSourceException;
use Sabberworm\CSS\Settings as CssSettings;

/**
 * Validates PHP, CSS, SCSS, JS, and HTML files in a directory without shell access.
 */
class CodeValidator
{
    private ThemeFileScanner $fileScanner;

    private Parser $phpParser;

    public function __construct(
        ?ThemeFileScanner $fileScanner = null,
        ?Parser $phpParser = null
    ) {
        $this->fileScanner = $fileScanner ?? new ThemeFileScanner();
        $this->phpParser   = $phpParser ?? ( new ParserFactory() )->createForNewestSupportedVersion();
    }

    /**
     * Validate all supported code files under a directory.
     *
     * @return array{
     *     valid: bool,
     *     directory: string,
     *     file_count: int,
     *     issue_count: int,
     *     issues: list<array{
     *         file: string,
     *         language: string,
     *         line: int|null,
     *         column: int|null,
     *         message: string
     *     }>
     * }
     *
     * @throws ThemeIndexingException
     */
    public function validateDirectory( string $absoluteDirectory, string $relativeDirectory ): array
    {
        $absoluteDirectory  = $this->normalizePath( $absoluteDirectory );
        $relativeDirectory  = trim( str_replace( '\\', '/', $relativeDirectory ), '/' );
        $files              = $this->fileScanner->scanValidationFiles( $absoluteDirectory );
        $issues             = [];

        foreach ( $files as $relativePath ) {
            $absolutePath = $absoluteDirectory . '/' . $relativePath;
            $displayPath  = '' === $relativeDirectory ? $relativePath : $relativeDirectory . '/' . $relativePath;

            if ( ! is_readable( $absolutePath ) ) {
                $issues[] = $this->makeIssue(
                    $displayPath,
                    'unknown',
                    null,
                    null,
                    'File is not readable.'
                );
                continue;
            }

            $content = file_get_contents( $absolutePath );
            if ( false === $content ) {
                $issues[] = $this->makeIssue(
                    $displayPath,
                    'unknown',
                    null,
                    null,
                    'Could not read file contents.'
                );
                continue;
            }

            $extension = strtolower( pathinfo( $relativePath, PATHINFO_EXTENSION ) );
            $language  = $this->resolveLanguage( $extension );
            $fileIssues = $this->validateContent( $content, $language );

            foreach ( $fileIssues as $fileIssue ) {
                $issues[] = $this->makeIssue(
                    $displayPath,
                    $language,
                    $fileIssue['line'] ?? null,
                    $fileIssue['column'] ?? null,
                    $fileIssue['message']
                );
            }
        }

        return [
            'valid'        => empty( $issues ),
            'directory'    => $relativeDirectory,
            'file_count'   => count( $files ),
            'issue_count'  => count( $issues ),
            'issues'       => $issues,
        ];
    }

    /**
     * Validate a single saved file (used after edit_file / write_file).
     *
     * @return array{
     *     valid: bool,
     *     file: string,
     *     language: string|null,
     *     skipped: bool,
     *     issue_count: int,
     *     issues: list<array{
     *         file: string,
     *         language: string,
     *         line: int|null,
     *         column: int|null,
     *         message: string
     *     }>
     * }
     */
    public function validateFile( string $absolutePath, string $displayPath ): array
    {
        $absolutePath = $this->normalizePath( $absolutePath );
        $displayPath  = trim( str_replace( '\\', '/', $displayPath ), '/' );
        $extension    = strtolower( pathinfo( $absolutePath, PATHINFO_EXTENSION ) );
        $language     = $this->resolveLanguage( $extension );

        if ( 'unknown' === $language ) {
            return [
                'valid'       => true,
                'file'        => $displayPath,
                'language'    => null,
                'skipped'     => true,
                'issue_count' => 0,
                'issues'      => [],
            ];
        }

        if ( ! is_readable( $absolutePath ) ) {
            return [
                'valid'       => false,
                'file'        => $displayPath,
                'language'    => $language,
                'skipped'     => false,
                'issue_count' => 1,
                'issues'      => [
                    $this->makeIssue(
                        $displayPath,
                        $language,
                        null,
                        null,
                        'File is not readable.'
                    ),
                ],
            ];
        }

        $content = file_get_contents( $absolutePath );
        if ( false === $content ) {
            return [
                'valid'       => false,
                'file'        => $displayPath,
                'language'    => $language,
                'skipped'     => false,
                'issue_count' => 1,
                'issues'      => [
                    $this->makeIssue(
                        $displayPath,
                        $language,
                        null,
                        null,
                        'Could not read file contents.'
                    ),
                ],
            ];
        }

        $fileIssues = $this->validateContent( $content, $language );
        $issues     = [];

        foreach ( $fileIssues as $fileIssue ) {
            $issues[] = $this->makeIssue(
                $displayPath,
                $language,
                $fileIssue['line'] ?? null,
                $fileIssue['column'] ?? null,
                $fileIssue['message']
            );
        }

        return [
            'valid'       => empty( $issues ),
            'file'        => $displayPath,
            'language'    => $language,
            'skipped'     => false,
            'issue_count' => count( $issues ),
            'issues'      => $issues,
        ];
    }

    /**
     * @return list<array{line: int|null, column: int|null, message: string}>
     */
    public function validateContent( string $content, string $language ): array
    {
        return match ( $language ) {
            'php'   => $this->validatePhp( $content ),
            'css'   => $this->validateCss( $content ),
            'scss'  => $this->validateScss( $content ),
            'js'    => $this->validateJs( $content ),
            'html'  => $this->validateHtml( $content ),
            default => [],
        };
    }

    /**
     * @return list<array{line: int|null, column: int|null, message: string}>
     */
    private function validatePhp( string $content ): array
    {
        try {
            $this->phpParser->parse( $content );
        } catch ( PhpParserError $error ) {
            $line   = $error->getStartLine();
            $column = $error->hasColumnInfo() ? $error->getStartColumn( $content ) : null;

            return [
                [
                    'line'    => $line > 0 ? $line : null,
                    'column'  => $column,
                    'message' => trim( $error->getMessage() ),
                ],
            ];
        }

        return [];
    }

    /**
     * @return list<array{line: int|null, column: int|null, message: string}>
     */
    private function validateCss( string $content ): array
    {
        try {
            $settings = CssSettings::create()->withMultibyteSupport( true );
            $parser   = new CssParser( $content, $settings );
            $parser->parse();
        } catch ( CssSourceException $exception ) {
            return [
                [
                    'line'    => $exception->getLine(),
                    'column'  => null,
                    'message' => trim( $exception->getMessage() ),
                ],
            ];
        } catch ( \Throwable $exception ) {
            return [
                [
                    'line'    => null,
                    'column'  => null,
                    'message' => trim( $exception->getMessage() ),
                ],
            ];
        }

        return $this->checkBracketBalance( $content, 'css' );
    }

    /**
     * @return list<array{line: int|null, column: int|null, message: string}>
     */
    private function validateScss( string $content ): array
    {
        // SCSS is a CSS superset; the CSS parser cannot reliably parse Sass syntax.
        return $this->checkBracketBalance( $content, 'scss' );
    }

    /**
     * @return list<array{line: int|null, column: int|null, message: string}>
     */
    private function validateJs( string $content ): array
    {
        $scriptError = $this->parseJsWithPeast( $content, Peast::SOURCE_TYPE_SCRIPT );
        if ( null !== $scriptError ) {
            $moduleError = $this->parseJsWithPeast( $content, Peast::SOURCE_TYPE_MODULE );
            if ( null !== $moduleError ) {
                return [ $scriptError ];
            }
        }

        return [];
    }

    /**
     * @return array{line: int|null, column: int|null, message: string}|null
     */
    private function parseJsWithPeast( string $content, string $sourceType ): ?array
    {
        try {
            Peast::latest(
                $content,
                [
                    'sourceType' => $sourceType,
                ]
            )->parse();
        } catch ( PeastSyntaxException $exception ) {
            $position = $exception->getPosition();

            return [
                'line'    => $position->getLine(),
                'column'  => $position->getColumn(),
                'message' => trim( $exception->getMessage() ),
            ];
        } catch ( \Throwable $exception ) {
            return [
                'line'    => null,
                'column'  => null,
                'message' => trim( $exception->getMessage() ),
            ];
        }

        return null;
    }

    /**
     * @return list<array{line: int|null, column: int|null, message: string}>
     */
    private function validateHtml( string $content ): array
    {
        $issues = [];

        if ( '' === trim( $content ) ) {
            return [];
        }

        $previousLibxmlSetting = libxml_use_internal_errors( true );
        libxml_clear_errors();

        $dom = new \DOMDocument();
        $loaded = $dom->loadHTML(
            $content,
            LIBXML_NOWARNING | LIBXML_NOERROR | LIBXML_NONET | LIBXML_COMPACT
        );

        if ( false === $loaded ) {
            $issues[] = [
                'line'    => null,
                'column'  => null,
                'message' => 'HTML document could not be parsed.',
            ];
        }

        foreach ( libxml_get_errors() as $error ) {
            if ( LIBXML_ERR_WARNING === $error->level && $this->isIgnorableHtmlWarning( $error->message ) ) {
                continue;
            }

            $issues[] = [
                'line'    => $error->line > 0 ? $error->line : null,
                'column'  => $error->column > 0 ? $error->column : null,
                'message' => trim( $error->message ),
            ];
        }

        libxml_clear_errors();
        libxml_use_internal_errors( $previousLibxmlSetting );

        return $this->deduplicateIssues( $issues );
    }

    /**
     * @return list<array{line: int|null, column: int|null, message: string}>
     */
    private function checkBracketBalance( string $content, string $language ): array
    {
        $pairs   = [ '(' => ')', '[' => ']', '{' => '}' ];
        $closing = array_flip( $pairs );
        $stack   = [];
        $issues  = [];

        $length         = strlen( $content );
        $line           = 1;
        $inString       = null;
        $inBlockComment = false;
        $inLineComment  = false;

        for ( $index = 0; $index < $length; $index++ ) {
            $char = $content[ $index ];
            $next = $index + 1 < $length ? $content[ $index + 1 ] : '';

            if ( "\n" === $char ) {
                ++$line;
                $inLineComment = false;
                continue;
            }

            if ( $inLineComment ) {
                continue;
            }

            if ( $inBlockComment ) {
                if ( '*' === $char && '/' === $next ) {
                    $inBlockComment = false;
                    ++$index;
                }
                continue;
            }

            if ( null !== $inString ) {
                if ( '\\' === $char ) {
                    ++$index;
                    continue;
                }

                if ( $char === $inString ) {
                    $inString = null;
                }

                continue;
            }

            if ( '/' === $char && '/' === $next ) {
                $inLineComment = true;
                ++$index;
                continue;
            }

            if ( '/' === $char && '*' === $next ) {
                $inBlockComment = true;
                ++$index;
                continue;
            }

            if ( 'scss' === $language && '#' === $char ) {
                $inLineComment = true;
                continue;
            }

            if ( 'html' === $language && '<' === $char && $index + 3 < $length && '<!--' === substr( $content, $index, 4 ) ) {
                $commentEnd = strpos( $content, '-->', $index + 4 );
                if ( false === $commentEnd ) {
                    $issues[] = [
                        'line'    => $line,
                        'column'  => null,
                        'message' => 'Unclosed HTML comment.',
                    ];
                    break;
                }

                $index = $commentEnd + 2;
                continue;
            }

            if ( in_array( $char, [ '"', "'", '`' ], true ) ) {
                $inString = $char;
                continue;
            }

            if ( isset( $pairs[ $char ] ) ) {
                $stack[] = [
                    'char' => $char,
                    'line' => $line,
                ];
                continue;
            }

            if ( ! isset( $closing[ $char ] ) ) {
                continue;
            }

            if ( empty( $stack ) ) {
                $issues[] = [
                    'line'    => $line,
                    'column'  => null,
                    'message' => sprintf( 'Unexpected closing bracket "%s".', $char ),
                ];
                continue;
            }

            $open = array_pop( $stack );
            if ( $pairs[ $open['char'] ] !== $char ) {
                $issues[] = [
                    'line'    => $line,
                    'column'  => null,
                    'message' => sprintf(
                        'Mismatched bracket: expected "%s" but found "%s" (opened on line %d).',
                        $pairs[ $open['char'] ],
                        $char,
                        $open['line']
                    ),
                ];
            }
        }

        if ( null !== $inString ) {
            $issues[] = [
                'line'    => $line,
                'column'  => null,
                'message' => sprintf( 'Unclosed string delimiter "%s".', $inString ),
            ];
        }

        if ( $inBlockComment ) {
            $issues[] = [
                'line'    => $line,
                'column'  => null,
                'message' => 'Unclosed block comment.',
            ];
        }

        foreach ( $stack as $open ) {
            $issues[] = [
                'line'    => $open['line'],
                'column'  => null,
                'message' => sprintf( 'Unclosed bracket "%s".', $open['char'] ),
            ];
        }

        return $issues;
    }

    private function resolveLanguage( string $extension ): string
    {
        return match ( $extension ) {
            'php'           => 'php',
            'css'           => 'css',
            'scss'          => 'scss',
            'js'            => 'js',
            'html', 'htm'   => 'html',
            default         => 'unknown',
        };
    }

    /**
     * @return array{
     *     file: string,
     *     language: string,
     *     line: int|null,
     *     column: int|null,
     *     message: string
     * }
     */
    private function makeIssue(
        string $file,
        string $language,
        ?int $line,
        ?int $column,
        string $message
    ): array {
        return [
            'file'     => $file,
            'language' => $language,
            'line'     => $line,
            'column'   => $column,
            'message'  => $message,
        ];
    }

    /**
     * @param list<array{line: int|null, column: int|null, message: string}> $issues
     * @return list<array{line: int|null, column: int|null, message: string}>
     */
    private function deduplicateIssues( array $issues ): array
    {
        $unique = [];
        $seen   = [];

        foreach ( $issues as $issue ) {
            $key = sprintf(
                '%s:%s:%s',
                $issue['line'] ?? 'null',
                $issue['column'] ?? 'null',
                $issue['message']
            );

            if ( isset( $seen[ $key ] ) ) {
                continue;
            }

            $seen[ $key ] = true;
            $unique[]     = $issue;
        }

        return $unique;
    }

    private function isIgnorableHtmlWarning( string $message ): bool
    {
        $message = strtolower( $message );

        return str_contains( $message, 'html5' )
            || str_contains( $message, 'already defined' )
            || str_contains( $message, 'tag omitted' );
    }

    private function normalizePath( string $path ): string
    {
        if ( function_exists( 'wp_normalize_path' ) ) {
            return wp_normalize_path( $path );
        }

        return str_replace( '\\', '/', $path );
    }
}
