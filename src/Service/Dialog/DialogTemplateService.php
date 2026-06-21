<?php

declare(strict_types=1);

namespace DialogStudio\Service\Dialog;

use DialogStudio\Model\Template;
use DialogStudio\Repository\TemplateRepository;

class DialogTemplateService
{
    private TemplateRepository $repository;

    private DialogTemplateConditionMatcher $matcher;

    public function __construct(
        ?TemplateRepository $repository = null,
        ?DialogTemplateConditionMatcher $matcher = null
    ) {
        $this->repository = $repository ?? new TemplateRepository();
        $this->matcher    = $matcher ?? new DialogTemplateConditionMatcher();
    }

    /**
     * @param array<string, mixed> $payload
     * @return array{success: bool, data: array<string, mixed>|null, error: string|null}
     */
    public function create( array $payload ): array
    {
        $workspace = new DialogWorkspaceService();
        $workspace->ensureStructure();

        $title   = sanitize_text_field( (string) ( $payload['title'] ?? '' ) );
        $slug    = sanitize_title( (string) ( $payload['slug'] ?? $title ) );
        $type    = sanitize_key( (string) ( $payload['type'] ?? Template::TYPE_CANVAS ) );
        $content = (string) ( $payload['content'] ?? '' );

        if ( $title === '' || $slug === '' ) {
            return $this->error( 'title and slug are required.' );
        }

        if ( $this->repository->findBySlug( $slug ) ) {
            return $this->error( 'Template slug already exists: ' . $slug );
        }

        $fileName = $this->buildFileName( $slug, $type );
        $filePath = 'templates/' . $fileName;
        $absolute = DialogPath::resolve( $filePath );

        if ( file_exists( $absolute ) ) {
            return $this->error( 'Template file already exists: ' . $fileName );
        }

        $parent = dirname( $absolute );

        if ( ! is_dir( $parent ) && ! wp_mkdir_p( $parent ) ) {
            return $this->error( 'Failed to create templates directory.' );
        }

        if ( file_put_contents( $absolute, $content ) === false ) {
            return $this->error( 'Failed to write template file.' );
        }

        $template = new Template();
        $template->slug             = $slug;
        $template->title            = $title;
        $template->type             = $type;
        $template->file_path        = $filePath;
        $template->includes_header  = $this->boolValue( $payload['includes_header'] ?? true );
        $template->includes_footer  = $this->boolValue( $payload['includes_footer'] ?? true );
        $template->priority         = (int) ( $payload['priority'] ?? 10 );
        $template->conditions       = $this->normalizeConditions( $payload['conditions'] ?? null );
        $template->status           = sanitize_key( (string) ( $payload['status'] ?? Template::STATUS_ACTIVE ) );
        $template->meta             = is_array( $payload['meta'] ?? null ) ? $payload['meta'] : null;

        if ( ! $template->save() ) {
            unlink( $absolute ); // phpcs:ignore WordPress.WP.AlternativeFunctions.unlink_unlink

            return $this->error( 'Failed to save template record.' );
        }

        return [
            'success' => true,
            'data'    => $template->toArray(),
            'error'   => null,
        ];
    }

    /**
     * @param array<string, mixed> $payload
     * @return array{success: bool, data: array<string, mixed>|null, error: string|null}
     */
    public function update( array $payload ): array
    {
        $id   = (int) ( $payload['id'] ?? 0 );
        $slug = sanitize_title( (string) ( $payload['slug'] ?? '' ) );

        $template = $id > 0
            ? Template::find( $id )
            : ( $slug !== '' ? $this->repository->findBySlug( $slug ) : null );

        if ( ! $template instanceof Template ) {
            return $this->error( 'Template not found.' );
        }

        if ( isset( $payload['title'] ) ) {
            $template->title = sanitize_text_field( (string) $payload['title'] );
        }

        if ( isset( $payload['type'] ) ) {
            $template->type = sanitize_key( (string) $payload['type'] );
        }

        if ( array_key_exists( 'includes_header', $payload ) ) {
            $template->includes_header = $this->boolValue( $payload['includes_header'] );
        }

        if ( array_key_exists( 'includes_footer', $payload ) ) {
            $template->includes_footer = $this->boolValue( $payload['includes_footer'] );
        }

        if ( isset( $payload['priority'] ) ) {
            $template->priority = (int) $payload['priority'];
        }

        if ( array_key_exists( 'conditions', $payload ) ) {
            $template->conditions = $this->normalizeConditions( $payload['conditions'] );
        }

        if ( isset( $payload['status'] ) ) {
            $template->status = sanitize_key( (string) $payload['status'] );
        }

        if ( array_key_exists( 'meta', $payload ) && is_array( $payload['meta'] ) ) {
            $template->meta = $payload['meta'];
        }

        if ( isset( $payload['content'] ) ) {
            $absolute = DialogPath::resolve( $template->file_path );

            if ( file_put_contents( $absolute, (string) $payload['content'] ) === false ) {
                return $this->error( 'Failed to update template file.' );
            }
        }

        if ( ! $template->save() ) {
            return $this->error( 'Failed to update template record.' );
        }

        return [
            'success' => true,
            'data'    => $template->toArray(),
            'error'   => null,
        ];
    }

    /**
     * @return array{success: bool, data: array<string, mixed>|null, error: string|null}
     */
    public function delete( int $id, string $slug = '' ): array
    {
        $template = $id > 0
            ? Template::find( $id )
            : ( $slug !== '' ? $this->repository->findBySlug( $slug ) : null );

        if ( ! $template instanceof Template ) {
            return $this->error( 'Template not found.' );
        }

        $absolute = DialogPath::resolve( $template->file_path );

        if ( is_file( $absolute ) ) {
            unlink( $absolute ); // phpcs:ignore WordPress.WP.AlternativeFunctions.unlink_unlink
        }

        $template->delete();

        return [
            'success' => true,
            'data'    => [ 'deleted' => true, 'id' => $template->id ],
            'error'   => null,
        ];
    }

    /**
     * @return array{success: bool, data: list<array<string, mixed>>, error: string|null}
     */
    public function listAll(): array
    {
        $items = array_map(
            static fn ( Template $template ): array => $template->toArray(),
            $this->repository->allOrdered()
        );

        return [
            'success' => true,
            'data'    => $items,
            'error'   => null,
        ];
    }

    public function findMatchingTemplate( string $type ): ?Template
    {
        $best_match = null;
        $best_specificity = -1;

        foreach ( $this->repository->findByType( $type ) as $template ) {
            $result = $this->matcher->findBestMatch( $template->conditions );

            if ( $result['matched'] && $result['specificity'] > $best_specificity ) {
                $best_match = $template;
                $best_specificity = $result['specificity'];
            }
        }

        return $best_match;
    }

    public function getTemplateAbsolutePath( Template $template ): string
    {
        return DialogPath::resolve( $template->file_path );
    }

    private function buildFileName( string $slug, string $type ): string
    {
        return sanitize_file_name( $type . '-' . $slug . '.php' );
    }

    /**
     * @return array<string, mixed>|null
     */
    private function normalizeConditions( mixed $conditions ): ?array
    {
        if ( $conditions === null ) {
            return null;
        }

        if ( is_string( $conditions ) ) {
            $decoded = json_decode( $conditions, true );

            return is_array( $decoded ) ? $decoded : null;
        }

        return is_array( $conditions ) ? $conditions : null;
    }

    private function boolValue( mixed $value ): bool
    {
        if ( is_bool( $value ) ) {
            return $value;
        }

        if ( is_string( $value ) ) {
            return in_array( strtolower( $value ), [ '1', 'true', 'yes', 'on' ], true );
        }

        return (bool) $value;
    }

    /**
     * @return array{success: bool, data: null, error: string}
     */
    private function error( string $message ): array
    {
        return [
            'success' => false,
            'data'    => null,
            'error'   => $message,
        ];
    }
}
