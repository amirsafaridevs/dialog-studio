<?php

declare(strict_types=1);

namespace DialogStudio\Repository;

use DialogStudio\Contract\Abstract\AbstractRepository;
use DialogStudio\Model\Template;

class TemplateRepository extends AbstractRepository
{
    protected function getModelClass(): string
    {
        return Template::class;
    }

    /**
     * @return list<Template>
     */
    public function allOrdered(): array
    {
        $rows = $this->query()->orderBy( 'priority', 'ASC' )->get();
        $templates = [];

        foreach ( $rows as $row ) {
            $templates[] = Template::fromRow( $row );
        }

        return $templates;
    }

    public function findBySlug( string $slug ): ?Template
    {
        $model = $this->query()->where( 'slug', $slug )->first();

        return $model instanceof Template ? $model : null;
    }

    /**
     * @return list<Template>
     */
    public function allActive(): array
    {
        $models = $this->query()
            ->where( 'status', Template::STATUS_ACTIVE )
            ->orderBy( 'priority', 'ASC' )
            ->get();

        return array_values(
            array_filter(
                $models,
                static fn ( $model ): bool => $model instanceof Template
            )
        );
    }

    /**
     * @return list<Template>
     */
    public function findByType( string $type ): array
    {
        $models = $this->query()
            ->where( 'type', $type )
            ->where( 'status', Template::STATUS_ACTIVE )
            ->orderBy( 'priority', 'ASC' )
            ->get();

        return array_values(
            array_filter(
                $models,
                static fn ( $model ): bool => $model instanceof Template
            )
        );
    }
}
