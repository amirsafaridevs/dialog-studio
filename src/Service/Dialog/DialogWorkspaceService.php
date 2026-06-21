<?php

declare(strict_types=1);

namespace DialogStudio\Service\Dialog;

use DialogStudio\Contract\Abstract\AbstractService;

class DialogWorkspaceService extends AbstractService
{
    public function boot(): void
    {
        add_action( 'init', [ $this, 'ensureStructure' ], 1 );
    }

    public function activate(): void
    {
        $this->ensureStructure();
    }

    public function ensureStructure(): bool
    {
        $root = DialogPath::root();

        if ( ! wp_mkdir_p( $root ) ) {
            return false;
        }

        $directories = array_merge(
            [
                DialogPath::assets( 'admin' ),
                DialogPath::assets( 'front' ),
                DialogPath::modules(),
                DialogPath::templates(),
            ],
            array_map(
                static fn ( string $sub ): string => DialogPath::assets( $sub ),
                DialogPath::assetSubdirectories()
            )
        );

        foreach ( $directories as $directory ) {
            if ( ! is_dir( $directory ) ) {
                wp_mkdir_p( $directory );
            }
        }

        $this->maybeWriteGitkeep( DialogPath::modules() );
        $this->maybeWriteGitkeep( DialogPath::templates() );

        return is_dir( $root ) && is_writable( $root );
    }

    /**
     * @return array{ready: bool, path: string, writable: bool, exists: bool}
     */
    public function getStatus(): array
    {
        $path = DialogPath::root();

        return [
            'ready'    => is_dir( $path ) && is_writable( $path ),
            'path'     => $path,
            'writable' => is_dir( $path ) && is_writable( $path ),
            'exists'   => is_dir( $path ),
        ];
    }

    private function maybeWriteGitkeep( string $directory ): void
    {
        $gitkeep = $directory . '/.gitkeep';

        if ( is_dir( $directory ) && ! file_exists( $gitkeep ) ) {
            file_put_contents( $gitkeep, '' );
        }
    }
}
