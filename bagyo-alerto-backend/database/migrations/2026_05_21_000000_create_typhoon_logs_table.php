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
        if (!Schema::hasTable('typhoon_logs')) {
            Schema::create('typhoon_logs', function (Blueprint $table) {
                $table->increments('id');
                $table->decimal('wind_speed', 5, 2);
                $table->decimal('rainfall', 5, 2);
                $table->decimal('pressure', 6, 2);
                $table->string('severity_level', 50);
                $table->timestamp('logged_at')->useCurrent();
            });
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('typhoon_logs');
    }
};
