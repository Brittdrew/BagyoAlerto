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
        Schema::table('evacuation_centers_list', function (Blueprint $table) {
            $table->unsignedInteger('current_occupancy')->default(0)->after('capacity');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('evacuation_centers_list', function (Blueprint $table) {
            $table->dropColumn('current_occupancy');
        });
    }
};
