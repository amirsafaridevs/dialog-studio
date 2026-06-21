<?php

declare(strict_types=1);

namespace DialogStudio\Provider;

use DialogStudio\Contract\Abstract\AbstractServiceProvider;
use DialogStudio\Service\Runtime\MuPluginService;

/**
 * Runtime service provider — mu-plugin deployment and agent bootstrap helpers.
 */
class RuntimeServiceProvider extends AbstractServiceProvider
{
    protected function registerServices(): void
    {
        $this->container->singleton( 'runtime.mu_plugin', MuPluginService::class );
    }

    protected function bootServices(): void
    {
        $this->container->get( 'runtime.mu_plugin' )->boot();
    }
}
