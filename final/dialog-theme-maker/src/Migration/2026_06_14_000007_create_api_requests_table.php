<?php

declare(strict_types=1);

namespace DialogStudio\Migration;

use DialogStudio\Contract\Abstract\AbstractMigration;
use DialogStudio\Core\DB;

class CreateApiRequestsTable extends AbstractMigration
{
    public function up(): void
    {
        DB::schema()->create($this->getTableName('api_requests'), function ($table) {
            $table->id();
            $table->unsignedBigInteger('chat_id')->nullable();
            $table->string('url', 512);
            $table->string('title', 255)->nullable();
            $table->text('description')->nullable();
            $table->string('from_source', 255)->nullable();
            $table->text('details')->nullable();
            $table->timestamps();
            $table->index('chat_id');
            $table->index('created_at');
        });
    }

    public function down(): void
    {
        DB::schema()->dropIfExists($this->getTableName('api_requests'));
    }
}
