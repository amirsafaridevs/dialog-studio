<?php

declare(strict_types=1);

namespace DialogStudio\Service\Dialog;

class DialogTemplateConditionMatcher
{
    /**
     * @param array<string, mixed>|null $conditions
     */
    public function matches( ?array $conditions ): bool
    {
        if ( empty( $conditions ) ) {
            return true;
        }

        $rules = $conditions['rules'] ?? $conditions['include'] ?? [];

        if ( ! is_array( $rules ) || $rules === [] ) {
            return true;
        }

        foreach ( $rules as $rule ) {
            if ( ! is_array( $rule ) ) {
                continue;
            }

            if ( $this->matchRule( $rule ) ) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param array<string, mixed> $rule
     */
    private function matchRule( array $rule ): bool
    {
        $type = (string) ( $rule['type'] ?? '' );

        return match ( $type ) {
            'front_page'  => is_front_page(),
            'home'        => is_home(),
            'singular'    => $this->matchSingular( $rule ),
            'archive'     => $this->matchArchive( $rule ),
            'search'      => is_search(),
            '404'         => is_404(),
            'url'         => $this->matchUrl( $rule ),
            'woocommerce' => $this->matchWooCommerce( $rule ),
            'admin'       => $this->matchAdmin( $rule ),
            'taxonomy'    => $this->matchTaxonomy( $rule ),
            default       => false,
        };
    }

    /**
     * @param array<string, mixed> $rule
     */
    private function matchSingular( array $rule ): bool
    {
        if ( ! is_singular() ) {
            return false;
        }

        if ( isset( $rule['post_id'] ) && (int) get_queried_object_id() !== (int) $rule['post_id'] ) {
            return false;
        }

        if ( isset( $rule['post_type'] ) && get_post_type() !== (string) $rule['post_type'] ) {
            return false;
        }

        if ( isset( $rule['slug'] ) ) {
            $post = get_queried_object();

            if ( ! $post instanceof \WP_Post || $post->post_name !== (string) $rule['slug'] ) {
                return false;
            }
        }

        return true;
    }

    /**
     * @param array<string, mixed> $rule
     */
    private function matchArchive( array $rule ): bool
    {
        if ( ! is_archive() && ! is_post_type_archive() ) {
            return false;
        }

        if ( isset( $rule['post_type'] ) && ! is_post_type_archive( (string) $rule['post_type'] ) ) {
            return false;
        }

        return true;
    }

    /**
     * @param array<string, mixed> $rule
     */
    private function matchTaxonomy( array $rule ): bool
    {
        if ( ! is_tax() && ! is_category() && ! is_tag() ) {
            return false;
        }

        if ( isset( $rule['taxonomy'] ) ) {
            $object = get_queried_object();

            if ( ! $object instanceof \WP_Term || $object->taxonomy !== (string) $rule['taxonomy'] ) {
                return false;
            }
        }

        if ( isset( $rule['term_id'] ) && (int) get_queried_object_id() !== (int) $rule['term_id'] ) {
            return false;
        }

        return true;
    }

    /**
     * @param array<string, mixed> $rule
     */
    private function matchUrl( array $rule ): bool
    {
        $pattern = (string) ( $rule['pattern'] ?? $rule['url'] ?? '' );

        if ( $pattern === '' ) {
            return false;
        }

        $requestPath = wp_parse_url( $_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH );
        $requestPath = is_string( $requestPath ) ? $requestPath : '/';
        $requestPath = untrailingslashit( $requestPath ) ?: '/';

        $pattern = untrailingslashit( $pattern ) ?: '/';

        if ( str_contains( $pattern, '*' ) ) {
            $regex = '#^' . str_replace( '\*', '.*', preg_quote( $pattern, '#' ) ) . '$#i';

            return (bool) preg_match( $regex, $requestPath );
        }

        return strcasecmp( $requestPath, $pattern ) === 0;
    }

    /**
     * @param array<string, mixed> $rule
     */
    private function matchWooCommerce( array $rule ): bool
    {
        if ( ! function_exists( 'is_woocommerce' ) ) {
            return false;
        }

        $endpoint = (string) ( $rule['endpoint'] ?? '' );

        if ( $endpoint === '' ) {
            return is_woocommerce();
        }

        if ( function_exists( 'is_wc_endpoint_url' ) && is_wc_endpoint_url( $endpoint ) ) {
            return true;
        }

        if ( function_exists( 'is_account_page' ) && $endpoint === 'account' && is_account_page() ) {
            return true;
        }

        return false;
    }

    /**
     * @param array<string, mixed> $rule
     */
    private function matchAdmin( array $rule ): bool
    {
        if ( ! is_admin() ) {
            return false;
        }

        $page = (string) ( $rule['page'] ?? $rule['screen'] ?? '' );

        if ( $page === '' ) {
            return true;
        }

        global $pagenow;

        if ( isset( $pagenow ) && $pagenow === $page ) {
            return true;
        }

        // phpcs:ignore WordPress.Security.NonceVerification.Recommended
        return isset( $_GET['page'] ) && sanitize_text_field( wp_unslash( $_GET['page'] ) ) === $page;
    }
}
