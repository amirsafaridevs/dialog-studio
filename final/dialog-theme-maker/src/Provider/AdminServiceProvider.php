<?php

declare(strict_types=1);

namespace DialogStudio\Provider;

use DialogStudio\Contract\Abstract\AbstractServiceProvider;
use DialogStudio\Service\Admin\ChatAdminMenu;

/**
 * Admin service provider — wp-admin menus and related hooks.
 */
class AdminServiceProvider extends AbstractServiceProvider
{
    protected function registerServices(): void
    {
        $this->container->singleton( 'admin.chat_menu', ChatAdminMenu::class );
    }

    protected function bootServices(): void
    {
        $this->container->get( 'admin.chat_menu' )->boot();
    }
}
