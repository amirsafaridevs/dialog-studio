<?php

declare(strict_types=1);

namespace DialogStudio\Service\Dialog;

class DialogModuleLoader
{
    /** @var list<string> */
    private array $loaded = [];

    public function registerHooks(): void
    {
        add_action( 'plugins_loaded', [ $this, 'loadModules' ], 20 );
    }

    public function loadModules(): void
    {
        $directory = DialogPath::modules();

        if ( ! is_dir( $directory ) ) {
            return;
        }

        $files = glob( $directory . '/*.php' );

        if ( ! is_array( $files ) ) {
            return;
        }

        sort( $files, SORT_STRING );

        foreach ( $files as $file ) {
            if ( ! is_readable( $file ) ) {
                continue;
            }

            /** @noinspection PhpIncludeInspection */
            require_once $file;
            $this->loaded[] = $file;
        }
    }

    /**
     * @return list<string>
     */
    public function getLoadedFiles(): array
    {
        return $this->loaded;
    }
}
