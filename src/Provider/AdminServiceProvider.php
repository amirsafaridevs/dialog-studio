<?php

declare(strict_types=1);

namespace DialogStudio\Provider;

use DialogStudio\Contract\Abstract\AbstractServiceProvider;
use DialogStudio\Service\Admin\ChatAdminMenu;
use DialogStudio\Service\Admin\PageApiService;

/**
 * Admin service provider — wp-admin menus and related hooks.
 */
class AdminServiceProvider extends AbstractServiceProvider
{
    protected function registerServices(): void
    {
        $this->container->singleton( 'admin.chat_menu', ChatAdminMenu::class );
        $this->container->singleton( 'admin.page_api', PageApiService::class );
    }

    protected function bootServices(): void
    {
        $this->container->get( 'admin.chat_menu' )->boot();
        $this->container->get( 'admin.page_api' )->boot();
    }
}
