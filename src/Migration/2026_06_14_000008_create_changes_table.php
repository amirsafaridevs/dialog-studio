<?php

declare(strict_types=1);

namespace DialogStudio\Migration;

use DialogStudio\Contract\Abstract\AbstractMigration;
use DialogStudio\Core\DB;

class CreateChangesTable extends AbstractMigration
{
    public function up(): void
    {
        DB::schema()->create($this->getTableName('changes'), function ($table) {
            $table->id();
            $table->unsignedBigInteger('chat_id')->nullable();
            $table->string('type', 64);
            $table->text('from_value')->nullable();
            $table->text('to_value')->nullable();
            $table->text('details')->nullable();
            $table->timestamps();
            $table->index('chat_id');
            $table->index('created_at');
            $table->index('type');
        });
    }

    public function down(): void
    {
        DB::schema()->dropIfExists($this->getTableName('changes'));
    }
}
