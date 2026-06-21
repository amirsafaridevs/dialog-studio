<?php

declare(strict_types=1);

namespace DialogStudio\Migration;

use DialogStudio\Contract\Abstract\AbstractMigration;
use DialogStudio\Core\DB;

class CreateMigrationsTable extends AbstractMigration
{
    public function up(): void
    {
        DB::schema()->create($this->getTableName('migrations'), function ($table) {
            $table->id();
            $table->string('migration', 255);
            $table->integer('batch');
            $table->dateTime('created_at');
            $table->unique('migration');
        });
    }

    public function down(): void
    {
        DB::schema()->dropIfExists($this->getTableName('migrations'));
    }
}
