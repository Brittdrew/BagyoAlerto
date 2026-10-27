<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('barangays', function (Blueprint $table) {
            $table->string('flood_point_class')->nullable()->after('landslide_susceptibility');
            $table->string('landslide_point_class')->nullable()->after('flood_point_class');
            $table->boolean('flood_mapped_nearby')->nullable()->after('landslide_point_class');
            $table->boolean('landslide_mapped_nearby')->nullable()->after('flood_mapped_nearby');
        });

        Schema::table('evacuation_centers_list', function (Blueprint $table) {
            $table->string('flood_point_class')->nullable()->after('landslide_susceptibility');
            $table->string('landslide_point_class')->nullable()->after('flood_point_class');
            $table->boolean('flood_mapped_nearby')->nullable()->after('landslide_point_class');
            $table->boolean('landslide_mapped_nearby')->nullable()->after('flood_mapped_nearby');
        });
    }

    public function down(): void
    {
        Schema::table('barangays', function (Blueprint $table) {
            $table->dropColumn([
                'flood_point_class',
                'landslide_point_class',
                'flood_mapped_nearby',
                'landslide_mapped_nearby',
            ]);
        });

        Schema::table('evacuation_centers_list', function (Blueprint $table) {
            $table->dropColumn([
                'flood_point_class',
                'landslide_point_class',
                'flood_mapped_nearby',
                'landslide_mapped_nearby',
            ]);
        });
    }
};
