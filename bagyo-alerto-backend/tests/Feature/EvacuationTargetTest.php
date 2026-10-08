<?php

namespace Tests\Feature;

use App\Models\Barangay;
use App\Models\EvacuationCenter;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class EvacuationTargetTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();

        if (config('database.default') === 'sqlite') {
            if (!Schema::hasTable('barangays')) {
                Schema::create('barangays', function ($table) {
                    $table->increments('id');
                    $table->string('name', 100);
                    $table->string('city', 100)->nullable();
                    $table->decimal('latitude', 10, 8);
                    $table->decimal('longitude', 11, 8);
                    $table->string('risk_level', 20)->nullable();
                    $table->timestamp('created_at')->nullable();
                });
            }

            if (!Schema::hasTable('evacuation_centers_list')) {
                Schema::create('evacuation_centers_list', function ($table) {
                    $table->increments('id');
                    $table->string('name', 150);
                    $table->integer('barangay_id');
                    $table->string('address', 255)->nullable();
                    $table->decimal('latitude', 10, 8);
                    $table->decimal('longitude', 11, 8);
                    $table->integer('capacity')->default(0);
                    $table->unsignedInteger('current_occupancy')->default(0);
                    $table->boolean('is_active')->default(1);
                    $table->timestamp('created_at')->nullable();
                });
            }
        }
    }

    public function test_returns_local_center_with_alternatives_when_available(): void
    {
        $barangay = Barangay::create([
            'name' => 'Barangay Test 1',
            'city' => 'Surigao City',
            'latitude' => 9.784000,
            'longitude' => 125.488000,
            'risk_level' => 'high',
        ]);

        // Nearer local center
        $nearerCenter = EvacuationCenter::create([
            'name' => 'Nearer Local Center',
            'barangay_id' => $barangay->id,
            'address' => 'Local St 1',
            'latitude' => 9.784200,
            'longitude' => 125.488200,
            'capacity' => 200,
            'current_occupancy' => 50,
            'is_active' => true,
        ]);

        // Farther local center with free capacity (alternative)
        $fartherCenter = EvacuationCenter::create([
            'name' => 'Farther Local Center',
            'barangay_id' => $barangay->id,
            'address' => 'Local St 2',
            'latitude' => 9.789000,
            'longitude' => 125.490000,
            'capacity' => 500,
            'current_occupancy' => 100,
            'is_active' => true,
        ]);

        $response = $this->getJson("/api/barangays/{$barangay->id}/evacuation-target");

        $response->assertStatus(200)
            ->assertJson([
                'id' => $nearerCenter->id,
                'name' => 'Nearer Local Center',
                'address' => 'Local St 1',
                'capacity' => 200,
                'current_occupancy' => 50,
                'barangay_id' => $barangay->id,
                'is_fallback' => false,
            ]);

        $data = $response->json();
        $this->assertCount(1, $data['alternatives']);
        $this->assertEquals($fartherCenter->id, $data['alternatives'][0]['id']);
        $this->assertEquals('Farther Local Center', $data['alternatives'][0]['name']);
        $this->assertFalse($data['alternatives'][0]['is_fallback']);
    }

    public function test_returns_nearest_active_city_wide_center_when_local_center_is_full(): void
    {
        $localBarangay = Barangay::create([
            'name' => 'Barangay Full Local',
            'city' => 'Surigao City',
            'latitude' => 9.784000,
            'longitude' => 125.488000,
            'risk_level' => 'moderate',
        ]);

        $neighborBarangay = Barangay::create([
            'name' => 'Neighbor Barangay',
            'city' => 'Surigao City',
            'latitude' => 9.790000,
            'longitude' => 125.495000,
            'risk_level' => 'low',
        ]);

        // Local center is at capacity
        EvacuationCenter::create([
            'name' => 'Full Local Center',
            'barangay_id' => $localBarangay->id,
            'address' => 'Full Center Rd',
            'latitude' => 9.784100,
            'longitude' => 125.488100,
            'capacity' => 100,
            'current_occupancy' => 100,
            'is_active' => true,
        ]);

        // Neighbor active center with free capacity
        $fallbackCenter = EvacuationCenter::create([
            'name' => 'Available Neighbor Center',
            'barangay_id' => $neighborBarangay->id,
            'address' => 'Neighbor Rd',
            'latitude' => 9.790500,
            'longitude' => 125.495500,
            'capacity' => 400,
            'current_occupancy' => 50,
            'is_active' => true,
        ]);

        $response = $this->getJson("/api/barangays/{$localBarangay->id}/evacuation-target");

        $response->assertStatus(200)
            ->assertJson([
                'id' => $fallbackCenter->id,
                'name' => 'Available Neighbor Center',
                'capacity' => 400,
                'current_occupancy' => 50,
                'barangay_id' => $neighborBarangay->id,
                'is_fallback' => true,
                'alternatives' => [],
            ]);
    }

    public function test_returns_nearest_active_city_wide_center_when_no_local_center_exists(): void
    {
        $bareBarangay = Barangay::create([
            'name' => 'Barangay Without Center',
            'city' => 'Surigao City',
            'latitude' => 9.780000,
            'longitude' => 125.480000,
            'risk_level' => 'high',
        ]);

        $otherBarangay = Barangay::create([
            'name' => 'Other Barangay',
            'city' => 'Surigao City',
            'latitude' => 9.783000,
            'longitude' => 125.483000,
            'risk_level' => 'low',
        ]);

        $availableCenter = EvacuationCenter::create([
            'name' => 'City-wide Safe Center',
            'barangay_id' => $otherBarangay->id,
            'address' => 'Safe Zone Ave',
            'latitude' => 9.783100,
            'longitude' => 125.483100,
            'capacity' => 300,
            'current_occupancy' => 20,
            'is_active' => true,
        ]);

        $response = $this->getJson("/api/barangays/{$bareBarangay->id}/evacuation-target");

        $response->assertStatus(200)
            ->assertJson([
                'id' => $availableCenter->id,
                'name' => 'City-wide Safe Center',
                'capacity' => 300,
                'current_occupancy' => 20,
                'is_fallback' => true,
                'alternatives' => [],
            ]);
    }

    public function test_returns_404_when_nothing_available(): void
    {
        $barangay = Barangay::create([
            'name' => 'Isolated Barangay',
            'city' => 'Surigao City',
            'latitude' => 9.770000,
            'longitude' => 125.470000,
            'risk_level' => 'critical',
        ]);

        // Inactive center
        EvacuationCenter::create([
            'name' => 'Closed Center',
            'barangay_id' => $barangay->id,
            'address' => 'Closed St',
            'latitude' => 9.771000,
            'longitude' => 125.471000,
            'capacity' => 100,
            'current_occupancy' => 0,
            'is_active' => false,
        ]);

        // Full center
        EvacuationCenter::create([
            'name' => 'Full Center',
            'barangay_id' => $barangay->id,
            'address' => 'Full St',
            'latitude' => 9.772000,
            'longitude' => 125.472000,
            'capacity' => 100,
            'current_occupancy' => 100,
            'is_active' => true,
        ]);

        // If running against an existing populated database, ensure city-wide candidates are also full/inactive
        // or check for non-existent barangay
        $response = $this->getJson("/api/barangays/{$barangay->id}/evacuation-target");

        // If there are other pre-seeded centers in MySQL, let's verify what happens or test with non-existent / all-full
        if ($response->status() !== 404) {
            // Fill all other active centers temporarily in transaction
            EvacuationCenter::query()->update(['is_active' => false]);
            $response = $this->getJson("/api/barangays/{$barangay->id}/evacuation-target");
        }

        $response->assertStatus(404)
            ->assertJsonStructure(['message']);
    }
}
