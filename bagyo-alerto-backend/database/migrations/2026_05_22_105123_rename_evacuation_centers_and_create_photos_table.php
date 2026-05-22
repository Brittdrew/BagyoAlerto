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
        // 1. Drop foreign key recommendations_ibfk_2 on recommendations table before renaming evacuation_centers
        try {
            DB::statement('ALTER TABLE recommendations DROP FOREIGN KEY recommendations_ibfk_2');
        } catch (\Exception $e) {
            // Ignore if constraint doesn't exist
        }

        // 2. Rename evacuation_centers to evacuation_centers_list
        Schema::rename('evacuation_centers', 'evacuation_centers_list');

        // 3. Re-create the foreign key constraint pointing to the renamed table
        try {
            DB::statement('ALTER TABLE recommendations ADD CONSTRAINT recommendations_ibfk_2 FOREIGN KEY (evacuation_center_id) REFERENCES evacuation_centers_list(id) ON DELETE CASCADE');
        } catch (\Exception $e) {
            // Ignore if it fails
        }

        // 4. Create the new evacuation_centers table for photo storage
        Schema::create('evacuation_centers', function (Blueprint $table) {
            $table->id();
            $table->string('barangay_name', 100)->unique();
            $table->string('image_path', 255);
            $table->timestamp('updated_at')->useCurrent()->useCurrentOnUpdate();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        // 1. Drop the new photos table
        Schema::dropIfExists('evacuation_centers');

        // 2. Drop the foreign key on evacuation_centers_list from recommendations
        try {
            DB::statement('ALTER TABLE recommendations DROP FOREIGN KEY recommendations_ibfk_2');
        } catch (\Exception $e) {
        }

        // 3. Rename evacuation_centers_list back to evacuation_centers
        Schema::rename('evacuation_centers_list', 'evacuation_centers');

        // 4. Restore the original foreign key pointing to evacuation_centers
        try {
            DB::statement('ALTER TABLE recommendations ADD CONSTRAINT recommendations_ibfk_2 FOREIGN KEY (evacuation_center_id) REFERENCES evacuation_centers(id) ON DELETE CASCADE');
        } catch (\Exception $e) {
        }
    }
};
