<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('pagasa_detected_signals', function (Blueprint $table) {
            $table->id();
            $table->string('status', 32)->index();
            $table->string('storm_name', 100)->nullable();
            $table->string('bulletin_no', 20)->nullable();
            $table->timestamp('issued_at')->nullable();
            $table->unsignedTinyInteger('sdn_signal')->nullable();
            $table->unsignedTinyInteger('siargao_signal')->nullable();
            $table->unsignedTinyInteger('bucas_grande_signal')->nullable();
            $table->text('source_url')->nullable();
            $table->timestamp('fetched_at')->index();
            $table->text('raw_excerpt')->nullable();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('pagasa_detected_signals');
    }
};
