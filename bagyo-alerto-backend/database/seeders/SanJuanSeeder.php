<?php

namespace Database\Seeders;

use App\Models\Barangay;
use App\Models\EvacuationCenter;
use Illuminate\Database\Seeder;

/**
 * Idempotent seeder for Barangay San Juan and its evacuation center.
 *
 * Safe to run multiple times: uses updateOrCreate keyed on name.
 * Never overwrites rows whose hazard_source = 'manual (admin)'.
 *
 * Usage:
 *   php artisan db:seed --class=SanJuanSeeder
 */
class SanJuanSeeder extends Seeder
{
    public function run(): void
    {
        // ── 1. Upsert the barangay ────────────────────────────────────────────
        $barangay = Barangay::updateOrCreate(
            ['name' => 'San Juan'],
            [
                'city'      => 'Surigao City',
                'latitude'  => 9.7904,
                'longitude' => 125.4839,
                // risk_level: no pipeline-derived mapping exists in the codebase;
                // using 'moderate' as conservative baseline (see judgment calls).
                'risk_level' => 'moderate',
            ]
        );

        $this->command?->info("Barangay San Juan: id={$barangay->id} (" . ($barangay->wasRecentlyCreated ? 'created' : 'updated') . ")");

        // ── 2. Upsert the evacuation center ──────────────────────────────────
        // Key on name. If the existing "Surigao City National High School" row
        // is found it will be re-linked to San Juan; a new row is created only
        // when the name does not exist yet.
        $centerData = [
            'barangay_id' => $barangay->id,
            'address'     => 'San Juan, Surigao City',
            'latitude'    => 9.789919,
            'longitude'   => 125.484667,
            'capacity'    => 600,
            'is_active'   => 1,
        ];

        // Never overwrite hazard_source = 'manual (admin)' — check first.
        $existing = EvacuationCenter::where('name', 'San Juan Evacuation Center (Surigao City National High School)')->first();
        if ($existing && $existing->hazard_source === 'manual (admin)') {
            $this->command?->warn("Center '{$existing->name}' has hazard_source='manual (admin)' — skipping hazard fields, updating coordinates/barangay only.");
            $existing->update(array_diff_key($centerData, array_flip([
                'flood_susceptibility', 'landslide_susceptibility',
                'flood_point_class', 'landslide_point_class',
                'flood_mapped_nearby', 'landslide_mapped_nearby',
                'hazard_source', 'hazard_checked_at',
            ])));
            $center = $existing;
        } else {
            $center = EvacuationCenter::updateOrCreate(
                ['name' => 'San Juan Evacuation Center (Surigao City National High School)'],
                $centerData
            );
        }

        $this->command?->info("Center '{$center->name}': id={$center->id} (" . ($center->wasRecentlyCreated ? 'created' : 'updated') . ")");
    }
}

