<?php
namespace DialogStudio\App;

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

use DialogStudio\Contract\Abstract\AbstractSingleton;
use DialogStudio\Core\Application;
use DialogStudio\Provider\AdminServiceProvider;
use DialogStudio\Provider\FrontendServiceProvider;
use DialogStudio\Provider\RuntimeServiceProvider;

/**
 * App Class
 * 
 * Main application class for Easy Stock and Price Control plugin
 */
class App extends AbstractSingleton
{
    /** @var static|null */
    protected static ?self $instance = null;

    /**
     * Service registry instance
     *
     * @var 
     */
    protected  $providers = [];
    /**
     * Application instance
     *
     * @var Application
     */
    protected Application $application;

    /**
     * Get the singleton instance
     *
     * @return self
     */
    public function __construct() {
        $this->application = Application::get();
        $this->application->setProperty('basePath', plugin_dir_path(DialogStudio_PLUGIN_FILE));
        $this->application->setProperty('version', '0.0.1');
        $this->application->setProperty('prefix', 'DialogStudio');
        $this->application->setProperty('textdomain', 'DialogStudio');
        $this->application->setProperty('migration_folder', $this->application->path('src' . DIRECTORY_SEPARATOR . 'Migration'));
        $this->init();
    }

    /**
     * Initialize the application
     *
     * @return void
     */
    private function init(): void
    {
        $this->application->registerProvider( RuntimeServiceProvider::class );
        $this->application->registerProvider( FrontendServiceProvider::class );
        $this->application->registerProvider( AdminServiceProvider::class );
        $this->application->boot();
    }


}
