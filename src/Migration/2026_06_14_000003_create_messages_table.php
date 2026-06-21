<?php

declare(strict_types=1);

namespace DialogStudio\Migration;

use DialogStudio\Contract\Abstract\AbstractMigration;
use DialogStudio\Core\DB;

class CreateMessagesTable extends AbstractMigration
{
    public function up(): void
    {
        DB::schema()->create($this->getTableName('messages'), function ($table) {
            $table->id();
            $table->unsignedBigInteger('chat_id');
            $table->string('thread_id', 64);
            $table->string('role', 32);
            $table->longText('content');
            $table->unsignedBigInteger('sequence');
            $table->longText('metadata')->nullable();
            $table->string('message_uid', 64)->nullable();
            $table->dateTime('created_at');
            $table->index(['chat_id', 'sequence']);
            $table->index(['thread_id', 'sequence']);
            $table->index('created_at');
            $table->unique(['chat_id', 'message_uid']);
        });
    }

    public function down(): void
    {
        DB::schema()->dropIfExists($this->getTableName('messages'));
    }
}
