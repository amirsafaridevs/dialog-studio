<?php

declare(strict_types=1);

namespace DialogStudio\Model;

use DialogStudio\Contract\Abstract\AbstractModel;

/**
 * @property int|null $id
 * @property string $slug
 * @property string $title
 * @property string $type
 * @property string $file_path
 * @property bool $includes_header
 * @property bool $includes_footer
 * @property int $priority
 * @property array<string, mixed>|null $conditions
 * @property string $status
 * @property array<string, mixed>|null $meta
 */
class Template extends AbstractModel
{
    public const TABLE = 'templates';

    public const TYPE_HEADER = 'header';

    public const TYPE_FOOTER = 'footer';

    public const TYPE_SINGULAR = 'singular';

    public const TYPE_ARCHIVE = 'archive';

    public const TYPE_CANVAS = 'canvas';

    public const TYPE_SECTION = 'section';

    public const TYPE_WOOCOMMERCE = 'woocommerce';

    public const TYPE_FRONT_PAGE = 'front_page';

    public const TYPE_SEARCH = 'search';

    public const TYPE_404 = '404';

    public const STATUS_ACTIVE = 'active';

    public const STATUS_DRAFT = 'draft';

    public const STATUS_INACTIVE = 'inactive';

    /** @var array<int, string> */
    protected array $fillable = [
        'slug',
        'title',
        'type',
        'file_path',
        'includes_header',
        'includes_footer',
        'priority',
        'conditions',
        'status',
        'meta',
    ];

    public ?int $id = null;

    public string $slug = '';

    public string $title = '';

    public string $type = '';

    public string $file_path = '';

    public bool $includes_header = true;

    public bool $includes_footer = true;

    public int $priority = 10;

    /** @var array<string, mixed>|null */
    public ?array $conditions = null;

    public string $status = self::STATUS_ACTIVE;

    /** @var array<string, mixed>|null */
    public ?array $meta = null;

    /**
     * @param object|array<string, mixed> $row
     */
    public static function fromRow( object|array $row ): static
    {
        $data  = is_array( $row ) ? (object) $row : $row;
        $model = new static();

        $model->id              = isset( $data->id ) ? (int) $data->id : null;
        $model->slug            = (string) ( $data->slug ?? '' );
        $model->title           = (string) ( $data->title ?? '' );
        $model->type            = (string) ( $data->type ?? '' );
        $model->file_path       = (string) ( $data->file_path ?? '' );
        $model->includes_header = (bool) ( $data->includes_header ?? true );
        $model->includes_footer = (bool) ( $data->includes_footer ?? true );
        $model->priority        = (int) ( $data->priority ?? 10 );
        $model->conditions      = self::decodeJson( $data->conditions ?? null );
        $model->status          = (string) ( $data->status ?? self::STATUS_ACTIVE );
        $model->meta            = self::decodeJson( $data->meta ?? null );
        $model->exists          = $model->id !== null;

        return $model;
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return [
            'id'              => $this->id,
            'slug'            => $this->slug,
            'title'           => $this->title,
            'type'            => $this->type,
            'file_path'       => $this->file_path,
            'includes_header' => $this->includes_header,
            'includes_footer' => $this->includes_footer,
            'priority'        => $this->priority,
            'conditions'      => $this->conditions,
            'status'          => $this->status,
            'meta'            => $this->meta,
            'created_at'      => $this->getAttribute( 'created_at' ),
            'updated_at'      => $this->getAttribute( 'updated_at' ),
        ];
    }

    /**
     * @param array<string, mixed> $data
     * @return array<string, mixed>
     */
    protected function prepareCreate( array $data ): array
    {
        return parent::prepareCreate( $this->serializeForDatabase( $data ) );
    }

    /**
     * @param array<string, mixed> $data
     * @return array<string, mixed>
     */
    protected function prepareUpdate( array $data ): array
    {
        unset( $data['id'], $data['created_at'] );

        return parent::prepareUpdate( $this->serializeForDatabase( $data ) );
    }

    /**
     * @param array<string, mixed> $data
     * @return array<string, mixed>
     */
    private function serializeForDatabase( array $data ): array
    {
        if ( array_key_exists( 'conditions', $data ) ) {
            $data['conditions'] = $data['conditions'] === null
                ? null
                : wp_json_encode( $data['conditions'] );
        }

        if ( array_key_exists( 'meta', $data ) ) {
            $data['meta'] = $data['meta'] === null
                ? null
                : wp_json_encode( $data['meta'] );
        }

        if ( array_key_exists( 'includes_header', $data ) ) {
            $data['includes_header'] = $data['includes_header'] ? 1 : 0;
        }

        if ( array_key_exists( 'includes_footer', $data ) ) {
            $data['includes_footer'] = $data['includes_footer'] ? 1 : 0;
        }

        return $data;
    }

    /**
     * @return array<string, mixed>|null
     */
    private static function decodeJson( mixed $value ): ?array
    {
        if ( $value === null || $value === '' ) {
            return null;
        }

        if ( is_array( $value ) ) {
            return $value;
        }

        $decoded = json_decode( (string) $value, true );

        return is_array( $decoded ) ? $decoded : null;
    }
}
