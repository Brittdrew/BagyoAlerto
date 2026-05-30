<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('chat_logs', function (Blueprint $table) {
            $table->id();
            $table->string('barangay_name')->nullable();
            $table->text('question');
            $table->text('answer');
            $table->string('severity')->nullable();
            $table->float('wind')->nullable();
            $table->float('rainfall')->nullable();
            $table->float('pressure')->nullable();
            $table->float('temperature')->nullable();
            $table->float('humidity')->nullable();
            $table->string('asked_by')->default('admin'); // 'admin' or 'resident'
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('chat_logs');
    }
};
