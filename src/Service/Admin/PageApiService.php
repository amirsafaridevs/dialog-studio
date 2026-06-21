<?php

declare(strict_types=1);

namespace DialogStudio\Service\Admin;

use DialogStudio\Contract\Abstract\AbstractService;
use WP_Post;

/**
 * Page create/update endpoints run after WordPress bootstrap (not muplugins_loaded).
 */
class PageApiService extends AbstractService
{
    private const API_PREFIX           = '/DialogStudio/v1';
    private const STATIC_TOKENS_OPTION = 'dtm_tokens';
    private const AGENT_TOKEN_OPTION   = 'dtm_agent_token';

    public function boot(): void
    {
        add_action( 'init', [ $this, 'handleRequest' ], 1 );
    }

    public function handleRequest(): void
    {
        $api_uri = $this->resolveApiUri();
        if ( $api_uri === null ) {
            return;
        }

        $method = strtoupper( (string) ( $_SERVER['REQUEST_METHOD'] ?? 'GET' ) );

        if ( $method === 'POST' && $api_uri === self::API_PREFIX . '/pages/create' ) {
            $this->respond( $this->handlePageCreate() );
        }

        if ( $method === 'POST' && $api_uri === self::API_PREFIX . '/pages/update' ) {
            $this->respond( $this->handlePageUpdate() );
        }
    }

    /**
     * @return array{success: bool, data: array<string, mixed>|null, error: string|null}
     */
    private function handlePageCreate(): array
    {
        $auth = $this->authenticateRequest();
        if ( $auth !== true ) {
            return [
                'success' => false,
                'data'    => null,
                'error'   => is_string( $auth ) ? $auth : 'Forbidden',
            ];
        }

        $body  = $this->getJsonBody();
        $title = sanitize_text_field( (string) ( $body['title'] ?? '' ) );
        if ( $title === '' ) {
            return [
                'success' => false,
                'data'    => null,
                'error'   => 'Title is required',
            ];
        }

        $post_data = [
            'post_type'    => 'page',
            'post_title'   => $title,
            'post_content' => wp_kses_post( (string) ( $body['content'] ?? '' ) ),
            'post_status'  => $this->sanitizePageStatus( (string) ( $body['status'] ?? 'publish' ) ),
            'post_excerpt' => sanitize_textarea_field( (string) ( $body['excerpt'] ?? '' ) ),
            'menu_order'   => (int) ( $body['menu_order'] ?? 0 ),
        ];

        if ( ! empty( $body['slug'] ) ) {
            $post_data['post_name'] = sanitize_title( (string) $body['slug'] );
        }

        if ( ! empty( $body['parent_id'] ) ) {
            $post_data['post_parent'] = absint( $body['parent_id'] );
        }

        $post_id = wp_insert_post( $post_data, true );
        if ( is_wp_error( $post_id ) ) {
            return [
                'success' => false,
                'data'    => null,
                'error'   => $post_id->get_error_message(),
            ];
        }

        $this->applyPageExtras( (int) $post_id, $body );

        return [
            'success' => true,
            'data'    => $this->formatPageResponse( (int) $post_id ),
            'error'   => null,
        ];
    }

    /**
     * @return array{success: bool, data: array<string, mixed>|null, error: string|null}
     */
    private function handlePageUpdate(): array
    {
        $auth = $this->authenticateRequest();
        if ( $auth !== true ) {
            return [
                'success' => false,
                'data'    => null,
                'error'   => is_string( $auth ) ? $auth : 'Forbidden',
            ];
        }

        $body    = $this->getJsonBody();
        $page_id = $this->resolvePageId( $body );
        if ( $page_id <= 0 ) {
            return [
                'success' => false,
                'data'    => null,
                'error'   => 'Valid page id or slug is required',
            ];
        }

        $post = get_post( $page_id );
        if ( ! $post || $post->post_type !== 'page' ) {
            return [
                'success' => false,
                'data'    => null,
                'error'   => 'Page not found',
            ];
        }

        $post_data = [ 'ID' => $page_id ];

        if ( array_key_exists( 'title', $body ) ) {
            $post_data['post_title'] = sanitize_text_field( (string) $body['title'] );
        }
        if ( array_key_exists( 'content', $body ) ) {
            $post_data['post_content'] = wp_kses_post( (string) $body['content'] );
        }
        if ( array_key_exists( 'status', $body ) ) {
            $post_data['post_status'] = $this->sanitizePageStatus( (string) $body['status'] );
        }
        if ( array_key_exists( 'excerpt', $body ) ) {
            $post_data['post_excerpt'] = sanitize_textarea_field( (string) $body['excerpt'] );
        }
        if ( array_key_exists( 'new_slug', $body ) ) {
            $post_data['post_name'] = sanitize_title( (string) $body['new_slug'] );
        }
        if ( array_key_exists( 'parent_id', $body ) ) {
            $post_data['post_parent'] = absint( $body['parent_id'] );
        }
        if ( array_key_exists( 'menu_order', $body ) ) {
            $post_data['menu_order'] = (int) $body['menu_order'];
        }

        $updated = wp_update_post( $post_data, true );
        if ( is_wp_error( $updated ) ) {
            return [
                'success' => false,
                'data'    => null,
                'error'   => $updated->get_error_message(),
            ];
        }

        $this->applyPageExtras( $page_id, $body );

        return [
            'success' => true,
            'data'    => $this->formatPageResponse( $page_id ),
            'error'   => null,
        ];
    }

    /**
     * @return bool|string
     */
    private function authenticateRequest()
    {
        $auth_header = $_SERVER['HTTP_AUTHORIZATION']
            ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION']
            ?? '';

        if ( ! empty( $auth_header ) ) {
            if ( ! preg_match( '/^Bearer\s+(.+)$/i', (string) $auth_header, $matches ) ) {
                return 'Invalid Authorization format — must be Bearer token';
            }

            $token = $matches[1];

            $active_token = get_option( self::AGENT_TOKEN_OPTION, '' );
            if ( ! empty( $active_token ) && hash_equals( (string) $active_token, $token ) ) {
                return true;
            }

            $static_tokens = get_option( self::STATIC_TOKENS_OPTION, [] );
            if ( is_array( $static_tokens ) ) {
                foreach ( $static_tokens as $stored ) {
                    if ( is_array( $stored ) && ! empty( $stored['is_active'] ) && hash_equals( (string) $stored['token'], $token ) ) {
                        return true;
                    }
                }
            }

            return 'Invalid or expired token';
        }

        if ( ! is_user_logged_in() || ! $this->currentUserCanAccessChat() ) {
            return 'Unauthorized';
        }

        $nonce = $_SERVER['HTTP_X_DTM_NONCE'] ?? '';
        if ( ! is_string( $nonce ) || ! $this->verifySettingsNonce( $nonce ) ) {
            return 'Invalid or missing nonce';
        }

        return true;
    }

    private function currentUserCanAccessChat(): bool
    {
        $user = wp_get_current_user();
        if ( ! $user->exists() ) {
            return false;
        }

        return in_array( 'administrator', (array) $user->roles, true )
            || current_user_can( 'edit_theme_options' );
    }

    private function verifySettingsNonce( string $nonce ): bool
    {
        $user_id = get_current_user_id();
        $tick    = wp_nonce_tick();
        $action  = 'dtm_settings';

        $expected = substr( wp_hash( $tick . '|' . $action . '|' . $user_id, 'nonce' ), -12, 10 );
        if ( hash_equals( $expected, $nonce ) ) {
            return true;
        }

        $expected = substr( wp_hash( ( $tick - 1 ) . '|' . $action . '|' . $user_id, 'nonce' ), -12, 10 );

        return hash_equals( $expected, $nonce );
    }

    private function sanitizePageStatus( string $status ): string
    {
        $allowed = [ 'publish', 'draft', 'pending', 'private', 'future' ];
        $status  = sanitize_key( $status );

        return in_array( $status, $allowed, true ) ? $status : 'publish';
    }

    /**
     * @param array<string, mixed> $body
     */
    private function resolvePageId( array $body ): int
    {
        if ( ! empty( $body['id'] ) ) {
            return absint( $body['id'] );
        }

        if ( ! empty( $body['slug'] ) ) {
            $page = get_page_by_path( sanitize_title( (string) $body['slug'] ) );
            if ( $page instanceof WP_Post ) {
                return (int) $page->ID;
            }
        }

        return 0;
    }

    /**
     * @param array<string, mixed> $body
     */
    private function applyPageExtras( int $page_id, array $body ): void
    {
        if ( array_key_exists( 'template', $body ) ) {
            $template = sanitize_text_field( (string) $body['template'] );
            update_post_meta( $page_id, '_wp_page_template', $template === 'default' ? '' : $template );
        }

        if ( is_array( $body['meta'] ?? null ) ) {
            foreach ( $body['meta'] as $key => $value ) {
                $meta_key = sanitize_key( (string) $key );
                if ( $meta_key === '' ) {
                    continue;
                }

                if ( is_scalar( $value ) || $value === null ) {
                    update_post_meta( $page_id, $meta_key, $value );
                } else {
                    update_post_meta( $page_id, $meta_key, wp_json_encode( $value ) );
                }
            }
        }

        if ( array_key_exists( 'featured_image_id', $body ) ) {
            $image_id = absint( $body['featured_image_id'] );
            if ( $image_id > 0 ) {
                set_post_thumbnail( $page_id, $image_id );
            } else {
                delete_post_thumbnail( $page_id );
            }
        }
    }

    /**
     * @return array<string, mixed>
     */
    private function formatPageResponse( int $page_id ): array
    {
        $post = get_post( $page_id );
        if ( ! $post ) {
            return [ 'id' => $page_id ];
        }

        $meta      = get_post_meta( $page_id );
        $meta_flat = [];
        foreach ( $meta as $key => $values ) {
            if ( str_starts_with( $key, '_' ) && $key !== '_wp_page_template' ) {
                continue;
            }
            $meta_flat[ $key ] = count( $values ) === 1 ? maybe_unserialize( $values[0] ) : array_map( 'maybe_unserialize', $values );
        }

        return [
            'id'                => $page_id,
            'title'             => get_the_title( $post ),
            'slug'              => $post->post_name,
            'status'            => $post->post_status,
            'content'           => $post->post_content,
            'excerpt'           => $post->post_excerpt,
            'parent_id'         => (int) $post->post_parent,
            'menu_order'        => (int) $post->menu_order,
            'template'          => (string) get_page_template_slug( $page_id ),
            'featured_image_id' => (int) get_post_thumbnail_id( $page_id ),
            'url'               => get_permalink( $page_id ),
            'edit_url'          => get_edit_post_link( $page_id, 'raw' ),
            'meta'              => $meta_flat,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function getJsonBody(): array
    {
        $raw = file_get_contents( 'php://input' );
        if ( ! is_string( $raw ) || $raw === '' ) {
            return [];
        }

        $data = json_decode( $raw, true );

        return is_array( $data ) ? $data : [];
    }

    private function resolveApiUri(): ?string
    {
        $request_uri = $_SERVER['REQUEST_URI'] ?? '';
        $uri         = parse_url( $request_uri, PHP_URL_PATH );

        if ( ! is_string( $uri ) ) {
            return null;
        }

        $prefix_pos = stripos( $uri, self::API_PREFIX );
        if ( $prefix_pos === false ) {
            return null;
        }

        return untrailingslashit( substr( $uri, $prefix_pos ) );
    }

    /**
     * @param array{success: bool, data: array<string, mixed>|null, error: string|null} $payload
     */
    private function respond( array $payload ): void
    {
        $status = 200;
        if ( $payload['success'] === false ) {
            $error = (string) ( $payload['error'] ?? '' );
            if ( $error === 'Unauthorized' || $error === 'Invalid or missing nonce' || $error === 'Forbidden' ) {
                $status = 403;
            } elseif ( str_contains( $error, 'Authorization' ) || str_contains( $error, 'token' ) ) {
                $status = 401;
            }
        }

        status_header( $status );
        header( 'Content-Type: application/json; charset=utf-8' );
        header( 'X-DialogStudio: true' );
        echo wp_json_encode( $payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES );
        exit;
    }
}
