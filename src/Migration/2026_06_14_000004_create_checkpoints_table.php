<?php

declare(strict_types=1);

namespace DialogStudio\Migration;

use DialogStudio\Contract\Abstract\AbstractMigration;
use DialogStudio\Core\DB;

class CreateCheckpointsTable extends AbstractMigration
{
    public function up(): void
    {
        DB::schema()->create($this->getTableName('checkpoints'), function ($table) {
            $table->id();
            $table->string('thread_id', 64);
            $table->string('checkpoint_id', 64);
            $table->string('parent_checkpoint_id', 64)->nullable();
            $table->longText('state');
            $table->longText('next_nodes')->nullable();
            $table->boolean('is_latest')->default(0);
            $table->dateTime('created_at');
            $table->unique(['thread_id', 'checkpoint_id']);
            $table->index(['thread_id', 'is_latest']);
            $table->index('created_at');
        });
    }

    public function down(): void
    {
        DB::schema()->dropIfExists($this->getTableName('checkpoints'));
    }
}
