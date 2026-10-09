<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        if (DB::getDriverName() === 'mysql') {
            try {
                DB::statement("ALTER TABLE typhoon_logs MODIFY COLUMN severity_level VARCHAR(50) NOT NULL");
            } catch (\Throwable $e) {
                // Ignore if unable or already modified
            }
        }

        Schema::table('typhoon_logs', function (Blueprint $table) {
            $table->integer('score')->nullable()->after('severity_level');
            $table->string('classification')->nullable()->after('score');
            $table->string('ml_prediction')->nullable()->after('classification');
            $table->integer('barangay_id')->nullable()->after('ml_prediction');

            if (Schema::hasTable('barangays')) {
                try {
                    $table->foreign('barangay_id')->references('id')->on('barangays')->nullOnDelete();
                } catch (\Throwable $e) {
                    // Ignore constraint error if unsupported
                }
            }
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('typhoon_logs', function (Blueprint $table) {
            try {
                $table->dropForeign(['barangay_id']);
            } catch (\Throwable $e) {
            }
            $table->dropColumn(['score', 'classification', 'ml_prediction', 'barangay_id']);
        });
    }
};
