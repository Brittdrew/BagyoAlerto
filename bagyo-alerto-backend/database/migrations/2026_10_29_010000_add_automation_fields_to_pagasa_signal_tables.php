<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('pagasa_signals', function (Blueprint $table) {
            $table->string('source', 10)->default('manual')->after('set_by');
        });

        Schema::table('pagasa_detected_signals', function (Blueprint $table) {
            $table->timestamp('applied_at')->nullable()->after('raw_excerpt');
        });
    }

    public function down(): void
    {
        Schema::table('pagasa_detected_signals', function (Blueprint $table) {
            $table->dropColumn('applied_at');
        });

        Schema::table('pagasa_signals', function (Blueprint $table) {
            $table->dropColumn('source');
        });
    }
};
