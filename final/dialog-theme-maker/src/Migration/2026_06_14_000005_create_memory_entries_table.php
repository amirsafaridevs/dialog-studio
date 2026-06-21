<?php

declare(strict_types=1);

namespace DialogStudio\Migration;

use DialogStudio\Contract\Abstract\AbstractMigration;
use DialogStudio\Core\DB;

class CreateMemoryEntriesTable extends AbstractMigration
{
    public function up(): void
    {
        DB::schema()->create($this->getTableName('memory_entries'), function ($table) {
            $table->id();
            $table->unsignedBigInteger('user_id');
            $table->string('thread_id', 64)->nullable();
            $table->string('type', 32);
            $table->string('slug', 128)->nullable();
            $table->longText('payload');
            $table->timestamps();
            $table->index(['user_id', 'type']);
            $table->index(['thread_id', 'type']);
            $table->index('created_at');
        });
    }

    public function down(): void
    {
        DB::schema()->dropIfExists($this->getTableName('memory_entries'));
    }
}
