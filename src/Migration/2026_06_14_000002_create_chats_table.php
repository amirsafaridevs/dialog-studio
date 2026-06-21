<?php

declare(strict_types=1);

namespace DialogStudio\Migration;

use DialogStudio\Contract\Abstract\AbstractMigration;
use DialogStudio\Core\DB;

class CreateChatsTable extends AbstractMigration
{
    public function up(): void
    {
        DB::schema()->create($this->getTableName('chats'), function ($table) {
            $table->id();
            $table->string('thread_id', 64);
            $table->unsignedBigInteger('user_id');
            $table->string('title', 255)->nullable();
            $table->string('status', 32)->default('active');
            $table->longText('meta')->nullable();
            $table->timestamps();
            $table->unique('thread_id');
            $table->index('user_id');
            $table->index('created_at');
        });
    }

    public function down(): void
    {
        DB::schema()->dropIfExists($this->getTableName('chats'));
    }
}
