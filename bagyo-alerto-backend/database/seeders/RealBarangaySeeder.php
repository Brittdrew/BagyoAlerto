<?php

namespace Database\Seeders;

use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;

class RealBarangaySeeder extends Seeder
{
    /**
     * Run the database seeds.
     */
    public function run(): void
    {
        // Clear old fake data first (disable FK checks temporarily)
        \DB::statement('SET FOREIGN_KEY_CHECKS=0;');
        \App\Models\Recommendation::truncate();
        \App\Models\EvacuationCenter::truncate();
        \App\Models\Barangay::truncate();
        \DB::statement('SET FOREIGN_KEY_CHECKS=1;');

        // 10 Real Barangays in Surigao City, Surigao del Norte
        $barangays = [
            ['name' => 'Washington',  'city' => 'Surigao City', 'latitude' => 9.7843, 'longitude' => 125.4887, 'risk_level' => 'high'],
            ['name' => 'Lipata',      'city' => 'Surigao City', 'latitude' => 9.8128, 'longitude' => 125.4553, 'risk_level' => 'moderate'],
            ['name' => 'Mabua',       'city' => 'Surigao City', 'latitude' => 9.8098, 'longitude' => 125.4409, 'risk_level' => 'low'],
            ['name' => 'Taft',        'city' => 'Surigao City', 'latitude' => 9.7847, 'longitude' => 125.4975, 'risk_level' => 'high'],
            ['name' => 'Bonifacio',   'city' => 'Surigao City', 'latitude' => 9.7381, 'longitude' => 125.4960, 'risk_level' => 'moderate'],
            ['name' => 'Rizal',       'city' => 'Surigao City', 'latitude' => 9.7823, 'longitude' => 125.4633, 'risk_level' => 'high'],
            ['name' => 'Sabang',      'city' => 'Surigao City', 'latitude' => 9.7979, 'longitude' => 125.4720, 'risk_level' => 'critical'],
            ['name' => 'Day-asan',    'city' => 'Surigao City', 'latitude' => 9.7726, 'longitude' => 125.5508, 'risk_level' => 'moderate'],
            ['name' => 'Cagniog',     'city' => 'Surigao City', 'latitude' => 9.7619, 'longitude' => 125.5045, 'risk_level' => 'low'],
            ['name' => 'Togbongon',   'city' => 'Surigao City', 'latitude' => 9.7960, 'longitude' => 125.4820, 'risk_level' => 'high'],
            ['name' => 'Ipil',        'city' => 'Surigao City', 'latitude' => 9.7922, 'longitude' => 125.4396, 'risk_level' => 'moderate'],
        ];

        // Real / Known Evacuation Centers in Surigao City
        // Each center is assigned to the nearest barangay
        $evacuationCenters = [
            // Washington
            ['name' => 'Surigao City National High School',           'barangay' => 'Washington', 'address' => 'Washington St., Surigao City',            'latitude' => 9.78978, 'longitude' => 125.48419, 'capacity' => 800,  'is_active' => true],
            ['name' => 'Washington Barangay Hall',                    'barangay' => 'Washington', 'address' => 'Washington, Surigao City',                 'latitude' => 9.78430, 'longitude' => 125.48870, 'capacity' => 200,  'is_active' => true],

            // Lipata
            ['name' => 'Lipata Elementary School',                    'barangay' => 'Lipata',     'address' => 'Lipata, Surigao City',                    'latitude' => 9.81280, 'longitude' => 125.45530, 'capacity' => 400,  'is_active' => true],

            // Mabua
            ['name' => 'Mabua Elementary School',                     'barangay' => 'Mabua',      'address' => 'Mabua, Surigao City',                    'latitude' => 9.80980, 'longitude' => 125.44090, 'capacity' => 350,  'is_active' => true],

            // Taft
            ['name' => 'Saint Paul University Surigao Gymnasium',     'barangay' => 'Taft',       'address' => 'San Nicolas & Rizal St., Surigao City',    'latitude' => 9.78956, 'longitude' => 125.49414, 'capacity' => 1200, 'is_active' => true],
            ['name' => 'Taft Barangay Multipurpose Hall',             'barangay' => 'Taft',       'address' => 'Taft, Surigao City',                     'latitude' => 9.78470, 'longitude' => 125.49750, 'capacity' => 300,  'is_active' => true],

            // Bonifacio
            ['name' => 'Surigao del Norte National High School',      'barangay' => 'Bonifacio',  'address' => 'Peñaranda St., Surigao City',              'latitude' => 9.78530, 'longitude' => 125.49306, 'capacity' => 900,  'is_active' => true],

            // Rizal
            ['name' => 'Rizal Elementary School',                     'barangay' => 'Rizal',      'address' => 'Rizal, Surigao City',                    'latitude' => 9.78230, 'longitude' => 125.46330, 'capacity' => 400,  'is_active' => true],

            // Sabang
            ['name' => 'Sabang Elementary School',                    'barangay' => 'Sabang',     'address' => 'Sabang, Surigao City',                   'latitude' => 9.79700, 'longitude' => 125.47200, 'capacity' => 350,  'is_active' => true],
            ['name' => 'Surigao City Covered Court',                  'barangay' => 'Sabang',     'address' => 'Sabang, Surigao City',                   'latitude' => 9.79800, 'longitude' => 125.47250, 'capacity' => 600,  'is_active' => true],

            // Day-asan
            ['name' => 'Day-asan Barangay Hall',                      'barangay' => 'Day-asan',   'address' => 'Day-asan, Surigao City',                 'latitude' => 9.77260, 'longitude' => 125.55080, 'capacity' => 150,  'is_active' => true],

            // Cagniog
            ['name' => 'Cagniog Elementary School',                   'barangay' => 'Cagniog',    'address' => 'Cagniog, Surigao City',                  'latitude' => 9.76190, 'longitude' => 125.50450, 'capacity' => 300,  'is_active' => true],

            // Togbongon
            ['name' => 'Togbongon Barangay Covered Court',            'barangay' => 'Togbongon',  'address' => 'Togbongon, Surigao City',                'latitude' => 9.79600, 'longitude' => 125.48200, 'capacity' => 250,  'is_active' => true],

            // Ipil
            ['name' => 'Ipil Elementary School',                      'barangay' => 'Ipil',       'address' => 'Ipil, Surigao City',                     'latitude' => 9.79220, 'longitude' => 125.43960, 'capacity' => 300,  'is_active' => true],
        ];

        // Insert barangays and map name -> id
        $barangayMap = [];
        foreach ($barangays as $data) {
            $b = \App\Models\Barangay::create($data);
            $barangayMap[$b->name] = $b->id;
        }

        // Insert evacuation centers using the mapped barangay IDs
        foreach ($evacuationCenters as $center) {
            $barangayName = $center['barangay'];
            unset($center['barangay']);
            $center['barangay_id'] = $barangayMap[$barangayName];
            \App\Models\EvacuationCenter::create($center);
        }
    }
}
