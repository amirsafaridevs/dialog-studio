<?php

declare(strict_types=1);

namespace DialogStudio\Service\Admin;

use DialogStudio\Contract\Abstract\AbstractService;

/**
 * Adds a top-level wp-admin menu item that opens the Dialog Theme Maker chat UI.
 */
class ChatAdminMenu extends AbstractService
{
    private const MENU_SLUG       = 'dtm-chat';
    private const CHAT_PATH       = 'DialogStudio/v1/chat';
    private const ICON_RELATIVE   = 'assets/admin/menu-icon.svg';
    private const ICON_CSS_REL    = 'assets/admin/menu-icon.css';

    public function boot(): void
    {
        add_action( 'admin_menu', [ $this, 'registerMenu' ] );
        add_action( 'admin_enqueue_scripts', [ $this, 'enqueueAssets' ] );
    }

    public function registerMenu(): void
    {
        add_menu_page(
            __( 'Dialog Theme Maker', 'DialogStudio' ),
            __( 'Dialog', 'DialogStudio' ),
            'manage_options',
            self::MENU_SLUG,
            [ $this, 'renderMenuPage' ],
            $this->getMenuIcon(),
            3
        );

        $this->setMenuHref( $this->getChatUrl() );
    }

    public function enqueueAssets( string $hook_suffix ): void
    {
        unset( $hook_suffix );

        if ( ! defined( 'DialogStudio_PLUGIN_FILE' ) ) {
            return;
        }

        $css_path = plugin_dir_path( DialogStudio_PLUGIN_FILE ) . self::ICON_CSS_REL;

        if ( ! is_readable( $css_path ) ) {
            return;
        }

        wp_enqueue_style(
            'dtm-admin-menu-icon',
            plugins_url( self::ICON_CSS_REL, DialogStudio_PLUGIN_FILE ),
            [],
            (string) filemtime( $css_path )
        );
    }

    public function renderMenuPage(): void
    {
        wp_safe_redirect( $this->getChatUrl() );
        exit;
    }

    private function getChatUrl(): string
    {
        return untrailingslashit( home_url( '/' . self::CHAT_PATH ) );
    }

    private function setMenuHref( string $url ): void
    {
        global $menu;

        foreach ( $menu as $index => $item ) {
            if ( ! is_array( $item ) || ! isset( $item[2] ) ) {
                continue;
            }

            if ( self::MENU_SLUG === $item[2] ) {
                $menu[ $index ][2] = $url;
                break;
            }
        }
    }

    private function getMenuIcon(): string
    {
        if ( ! defined( 'DialogStudio_PLUGIN_FILE' ) ) {
            return 'dashicons-format-chat';
        }

        $icon_path = plugin_dir_path( DialogStudio_PLUGIN_FILE ) . self::ICON_RELATIVE;

        if ( ! is_readable( $icon_path ) ) {
            return 'dashicons-format-chat';
        }

        return plugins_url( self::ICON_RELATIVE, DialogStudio_PLUGIN_FILE );
    }
}
