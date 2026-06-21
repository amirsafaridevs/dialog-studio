<?php

declare(strict_types=1);

namespace DialogStudio\Provider;

use DialogStudio\Contract\Abstract\AbstractServiceProvider;
use DialogStudio\Service\Frontend\PreviewBridgeService;

/**
 * Frontend service provider — preview iframe bridge and related hooks.
 */
class FrontendServiceProvider extends AbstractServiceProvider
{
    protected function registerServices(): void
    {
        $this->container->singleton( 'frontend.preview_bridge', PreviewBridgeService::class );
    }

    protected function bootServices(): void
    {
        $this->container->get( 'frontend.preview_bridge' )->boot();
    }
}
