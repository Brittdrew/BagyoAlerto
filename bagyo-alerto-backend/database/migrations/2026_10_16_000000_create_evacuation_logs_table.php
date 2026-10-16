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
        Schema::create('evacuation_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('evacuation_center_id')->constrained('evacuation_centers_list')->cascadeOnDelete();
            $table->foreignId('origin_barangay_id')->nullable()->constrained('barangays')->nullOnDelete();
            $table->string('type', 20); // 'arrival' or 'departure'
            $table->unsignedInteger('headcount');
            $table->foreignId('recorded_by')->nullable()->constrained('admins')->nullOnDelete();
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('evacuation_logs');
    }
};
