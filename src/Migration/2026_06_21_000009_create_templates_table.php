<?php

declare(strict_types=1);

namespace DialogStudio\Migration;

use DialogStudio\Contract\Abstract\AbstractMigration;
use DialogStudio\Core\DB;

class CreateTemplatesTable extends AbstractMigration
{
    public function up(): void
    {
        DB::schema()->create( $this->getTableName( 'templates' ), function ( $table ) {
            $table->id();
            $table->string( 'slug', 191 );
            $table->string( 'title', 255 );
            $table->string( 'type', 64 );
            $table->string( 'file_path', 255 );
            $table->boolean( 'includes_header' )->default( true );
            $table->boolean( 'includes_footer' )->default( true );
            $table->integer( 'priority' )->default( 10 );
            $table->longText( 'conditions' )->nullable();
            $table->string( 'status', 32 )->default( 'active' );
            $table->longText( 'meta' )->nullable();
            $table->timestamps();
            $table->unique( 'slug' );
            $table->index( 'type' );
            $table->index( 'status' );
            $table->index( 'priority' );
        } );
    }

    public function down(): void
    {
        DB::schema()->dropIfExists( $this->getTableName( 'templates' ) );
    }
}
