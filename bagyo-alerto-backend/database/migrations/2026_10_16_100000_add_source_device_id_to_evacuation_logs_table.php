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
        Schema::table('evacuation_logs', function (Blueprint $table) {
            // 'admin' = recorded by an admin user, 'gps' = self-reported via GPS
            $table->string('source', 20)->default('admin')->after('headcount');
            $table->string('device_id', 255)->nullable()->index()->after('source');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('evacuation_logs', function (Blueprint $table) {
            $table->dropIndex(['device_id']);
            $table->dropColumn(['source', 'device_id']);
        });
    }
};
