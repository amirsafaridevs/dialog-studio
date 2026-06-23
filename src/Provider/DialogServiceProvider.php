<?php

declare(strict_types=1);

namespace DialogStudio\Provider;

use DialogStudio\Contract\Abstract\AbstractServiceProvider;
use DialogStudio\Service\Dialog\DialogChildThemeService;
use DialogStudio\Service\Dialog\DialogRuntimeService;
use DialogStudio\Service\Dialog\DialogWorkspaceService;

class DialogServiceProvider extends AbstractServiceProvider
{
    protected function registerServices(): void
    {
        $this->container->singleton( 'dialog.workspace', DialogWorkspaceService::class );
        $this->container->singleton( 'dialog.runtime', DialogRuntimeService::class );
        $this->container->singleton( 'dialog.child_theme', DialogChildThemeService::class );
    }

    protected function bootServices(): void
    {
        $this->container->get( 'dialog.runtime' )->boot();
    }
}
