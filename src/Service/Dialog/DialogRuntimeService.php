<?php

declare(strict_types=1);

namespace DialogStudio\Service\Dialog;

use DialogStudio\Contract\Abstract\AbstractService;

class DialogRuntimeService extends AbstractService
{
    private DialogWorkspaceService $workspace;

    private DialogAssetLoader $assets;

    private DialogModuleLoader $modules;

    public function __construct(
        ?DialogWorkspaceService $workspace = null,
        ?DialogAssetLoader $assets = null,
        ?DialogModuleLoader $modules = null
    ) {
        $this->workspace = $workspace ?? new DialogWorkspaceService();
        $this->assets    = $assets ?? new DialogAssetLoader();
        $this->modules   = $modules ?? new DialogModuleLoader();
    }

    public function boot(): void
    {
        $this->workspace->boot();
        $this->assets->registerHooks();
        $this->modules->registerHooks();
    }

    public function activate(): void
    {
        $this->workspace->activate();
    }
}
