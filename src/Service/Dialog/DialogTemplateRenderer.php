<?php

declare(strict_types=1);

namespace DialogStudio\Service\Dialog;

use DialogStudio\Model\Template;

class DialogTemplateRenderer
{
    private DialogTemplateService $templates;

    private ?Template $activePageTemplate = null;

    private ?Template $activeHeaderTemplate = null;

    private ?Template $activeFooterTemplate = null;

    private bool $headerRendered = false;

    private bool $footerRendered = false;

    private static ?string $activeContentTemplate = null;

    public function __construct( ?DialogTemplateService $templates = null )
    {
        $this->templates = $templates ?? new DialogTemplateService();
    }

    public function registerHooks(): void
    {
        add_filter( 'template_include', [ $this, 'filterTemplateInclude' ], 99 );
        add_action( 'get_header', [ $this, 'maybeRenderHeader' ], 0 );
        add_action( 'get_footer', [ $this, 'maybeRenderFooter' ], 0 );
        add_filter( 'locate_template', [ $this, 'filterLocateTemplate' ], 10, 2 );
    }

    /**
     * @param string $template
     */
    public function filterTemplateInclude( $template ): string
    {
        if ( is_admin() ) {
            return (string) $template;
        }

        $this->resolveActiveTemplates();

        if ( ! $this->activePageTemplate instanceof Template ) {
            return (string) $template;
        }

        $absolute = $this->templates->getTemplateAbsolutePath( $this->activePageTemplate );

        if ( ! is_readable( $absolute ) ) {
            return (string) $template;
        }

        self::$activeContentTemplate = $absolute;

        return $this->getPageShellPath();
    }

    public static function renderActiveContent(): void
    {
        if ( self::$activeContentTemplate === null || ! is_readable( self::$activeContentTemplate ) ) {
            return;
        }

        /** @noinspection PhpIncludeInspection */
        include self::$activeContentTemplate;
    }

    /**
     * @param string|null $name
     */
    public function maybeRenderHeader( $name ): void
    {
        if ( is_admin() || $this->headerRendered ) {
            return;
        }

        $this->resolveActiveTemplates();

        if ( $this->activePageTemplate instanceof Template && ! $this->activePageTemplate->includes_header ) {
            $this->headerRendered = true;

            return;
        }

        if ( ! $this->activeHeaderTemplate instanceof Template ) {
            return;
        }

        $absolute = $this->templates->getTemplateAbsolutePath( $this->activeHeaderTemplate );

        if ( is_readable( $absolute ) ) {
            /** @noinspection PhpIncludeInspection */
            include $absolute;
            $this->headerRendered = true;
        }
    }

    /**
     * @param string|null $name
     */
    public function maybeRenderFooter( $name ): void
    {
        if ( is_admin() || $this->footerRendered ) {
            return;
        }

        $this->resolveActiveTemplates();

        if ( $this->activePageTemplate instanceof Template && ! $this->activePageTemplate->includes_footer ) {
            $this->footerRendered = true;

            return;
        }

        if ( ! $this->activeFooterTemplate instanceof Template ) {
            return;
        }

        $absolute = $this->templates->getTemplateAbsolutePath( $this->activeFooterTemplate );

        if ( is_readable( $absolute ) ) {
            /** @noinspection PhpIncludeInspection */
            include $absolute;
            $this->footerRendered = true;
        }
    }

    /**
     * @param string $template
     * @param array<int, string> $template_names
     */
    public function filterLocateTemplate( $template, $template_names ): string
    {
        if ( $this->headerRendered && $this->isTemplateName( $template_names, 'header' ) ) {
            return $this->getEmptyStubPath();
        }

        if ( $this->footerRendered && $this->isTemplateName( $template_names, 'footer' ) ) {
            return $this->getEmptyStubPath();
        }

        if (
            $this->activePageTemplate instanceof Template
            && ! $this->activePageTemplate->includes_header
            && $this->isTemplateName( $template_names, 'header' )
        ) {
            return $this->getEmptyStubPath();
        }

        if (
            $this->activePageTemplate instanceof Template
            && ! $this->activePageTemplate->includes_footer
            && $this->isTemplateName( $template_names, 'footer' )
        ) {
            return $this->getEmptyStubPath();
        }

        return $template;
    }

    /**
     * @param array<int, string> $template_names
     */
    private function isTemplateName( array $template_names, string $part ): bool
    {
        foreach ( $template_names as $name ) {
            if ( $name === $part . '.php' || str_starts_with( $name, $part . '-' ) ) {
                return true;
            }
        }

        return false;
    }

    private function getEmptyStubPath(): string
    {
        if ( defined( 'DialogStudio_PLUGIN_FILE' ) ) {
            return plugin_dir_path( DialogStudio_PLUGIN_FILE ) . 'stubs/empty.php';
        }

        return __DIR__ . '/../../../stubs/empty.php';
    }

    private function getPageShellPath(): string
    {
        if ( defined( 'DialogStudio_PLUGIN_FILE' ) ) {
            return plugin_dir_path( DialogStudio_PLUGIN_FILE ) . 'stubs/page-shell.php';
        }

        return __DIR__ . '/../../../stubs/page-shell.php';
    }

    private function resolveActiveTemplates(): void
    {
        if ( $this->activePageTemplate !== null || $this->activeHeaderTemplate !== null || $this->activeFooterTemplate !== null ) {
            return;
        }

        $pageTypes = [
            Template::TYPE_CANVAS,
            Template::TYPE_SINGULAR,
            Template::TYPE_ARCHIVE,
            Template::TYPE_FRONT_PAGE,
            Template::TYPE_SEARCH,
            Template::TYPE_404,
            Template::TYPE_WOOCOMMERCE,
        ];

        foreach ( $pageTypes as $type ) {
            $match = $this->templates->findMatchingTemplate( $type );

            if ( $match instanceof Template ) {
                $this->activePageTemplate = $match;
                break;
            }
        }

        $this->activeHeaderTemplate = $this->templates->findMatchingTemplate( Template::TYPE_HEADER );
        $this->activeFooterTemplate = $this->templates->findMatchingTemplate( Template::TYPE_FOOTER );
    }
}
