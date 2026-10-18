<?php

namespace Tests\Feature;

use App\Models\Barangay;
use App\Models\EvacuationCenter;
use App\Models\EvacuationLog;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class NearestEvacuationCenterTest extends TestCase
{
    use DatabaseTransactions;

    protected Barangay $barangay;

    protected function setUp(): void
    {
        parent::setUp();

        if (config('database.default') === 'sqlite') {
            if (!Schema::hasTable('barangays')) {
                Schema::create('barangays', function ($table) {
                    $table->increments('id');
                    $table->string('name', 100);
                    $table->string('city', 100)->nullable();
                    $table->decimal('latitude', 10, 8)->nullable();
                    $table->decimal('longitude', 11, 8)->nullable();
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
                    $table->decimal('latitude', 10, 8)->nullable();
                    $table->decimal('longitude', 11, 8)->nullable();
                    $table->integer('capacity')->default(0);
                    $table->unsignedInteger('current_occupancy')->default(0);
                    $table->boolean('is_active')->default(1);
                    $table->timestamp('created_at')->nullable();
                });
            }

            if (!Schema::hasTable('evacuation_logs')) {
                Schema::create('evacuation_logs', function ($table) {
                    $table->increments('id');
                    $table->unsignedInteger('evacuation_center_id');
                    $table->unsignedInteger('origin_barangay_id')->nullable();
                    $table->string('type', 20);
                    $table->unsignedInteger('headcount');
                    $table->string('source', 20)->default('admin');
                    $table->string('device_id', 255)->nullable();
                    $table->unsignedInteger('recorded_by')->nullable();
                    $table->timestamps();
                });
            }
        }

        $this->barangay = Barangay::create([
            'name' => 'Barangay Test',
            'city' => 'Surigao City',
            'latitude' => 9.7800,
            'longitude' => 125.4800,
            'risk_level' => 'medium',
        ]);
    }

    /**
     * Test centers are returned sorted by distance ascending.
     */
    public function test_returns_centers_sorted_by_distance(): void
    {
        // Reference point: 9.7800, 125.4800
        // Near center: ~0.2 km away
        $centerNear = EvacuationCenter::create([
            'name' => 'Near Center',
            'barangay_id' => $this->barangay->id,
            'latitude' => 9.7815,
            'longitude' => 125.4815,
            'capacity' => 100,
            'current_occupancy' => 0,
            'is_active' => true,
        ]);

        // Mid center: ~1.5 km away
        $centerMid = EvacuationCenter::create([
            'name' => 'Mid Center',
            'barangay_id' => $this->barangay->id,
            'latitude' => 9.7900,
            'longitude' => 125.4900,
            'capacity' => 100,
            'current_occupancy' => 0,
            'is_active' => true,
        ]);

        // Far center: ~4.5 km away
        $centerFar = EvacuationCenter::create([
            'name' => 'Far Center',
            'barangay_id' => $this->barangay->id,
            'latitude' => 9.8100,
            'longitude' => 125.5100,
            'capacity' => 100,
            'current_occupancy' => 0,
            'is_active' => true,
        ]);

        // Add 20 arrivals to centerNear
        EvacuationLog::create([
            'evacuation_center_id' => $centerNear->id,
            'type' => 'arrival',
            'headcount' => 20,
        ]);

        $response = $this->getJson('/api/evacuation-centers/nearest?lat=9.7800&lng=125.4800&limit=3');

        $response->assertStatus(200);

        $data = $response->json();
        $this->assertCount(3, $data);

        // Center near should be first, then mid, then far
        $this->assertEquals($centerNear->id, $data[0]['id']);
        $this->assertEquals('Near Center', $data[0]['name']);
        $this->assertEquals($this->barangay->id, $data[0]['barangay_id']);
        $this->assertEquals(100, $data[0]['capacity']);
        $this->assertEquals(20, $data[0]['occupancy']);
        $this->assertEquals(80, $data[0]['free_space']);
        $this->assertFalse($data[0]['is_full']);
        $this->assertIsFloat($data[0]['distance_km']);
        $this->assertGreaterThan(0, $data[0]['distance_km']);

        $this->assertEquals($centerMid->id, $data[1]['id']);
        $this->assertFalse($data[1]['is_full']);

        $this->assertEquals($centerFar->id, $data[2]['id']);
        $this->assertFalse($data[2]['is_full']);

        // Assert distance ordering: data[0] <= data[1] <= data[2]
        $this->assertLessThanOrEqual($data[1]['distance_km'], $data[0]['distance_km']);
        $this->assertLessThanOrEqual($data[2]['distance_km'], $data[1]['distance_km']);
    }

    /**
     * Test full centers are flagged is_full=true and sorted last (after non-full centers).
     */
    public function test_full_centers_are_flagged_and_sorted_last(): void
    {
        // Reference point: 9.7800, 125.4800

        // Nearest center (very close, ~0.2 km), but FULL (capacity 50, arrivals 50)
        $nearFullCenter = EvacuationCenter::create([
            'name' => 'Near Full Center',
            'barangay_id' => $this->barangay->id,
            'latitude' => 9.7810,
            'longitude' => 125.4810,
            'capacity' => 50,
            'current_occupancy' => 0,
            'is_active' => true,
        ]);
        EvacuationLog::create([
            'evacuation_center_id' => $nearFullCenter->id,
            'type' => 'arrival',
            'headcount' => 50,
        ]);

        // Mid center (~1.5 km), OVER CAPACITY (capacity 20, arrivals 25 -> free_space = -5)
        $midOverCenter = EvacuationCenter::create([
            'name' => 'Mid Over-Capacity Center',
            'barangay_id' => $this->barangay->id,
            'latitude' => 9.7900,
            'longitude' => 125.4900,
            'capacity' => 20,
            'current_occupancy' => 0,
            'is_active' => true,
        ]);
        EvacuationLog::create([
            'evacuation_center_id' => $midOverCenter->id,
            'type' => 'arrival',
            'headcount' => 25,
        ]);

        // Far center (~3.0 km), NOT FULL (capacity 100, arrivals 10, departures 5 -> occupancy 5, free_space 95)
        $farAvailableCenter = EvacuationCenter::create([
            'name' => 'Far Available Center',
            'barangay_id' => $this->barangay->id,
            'latitude' => 9.8000,
            'longitude' => 125.5000,
            'capacity' => 100,
            'current_occupancy' => 0,
            'is_active' => true,
        ]);
        EvacuationLog::create([
            'evacuation_center_id' => $farAvailableCenter->id,
            'type' => 'arrival',
            'headcount' => 10,
        ]);
        EvacuationLog::create([
            'evacuation_center_id' => $farAvailableCenter->id,
            'type' => 'departure',
            'headcount' => 5,
        ]);

        // Farther center (~5.0 km), NOT FULL (capacity 200, occupancy 0)
        $fartherAvailableCenter = EvacuationCenter::create([
            'name' => 'Farther Available Center',
            'barangay_id' => $this->barangay->id,
            'latitude' => 9.8200,
            'longitude' => 125.5200,
            'capacity' => 200,
            'current_occupancy' => 0,
            'is_active' => true,
        ]);

        $response = $this->getJson('/api/evacuation-centers/nearest?lat=9.7800&lng=125.4800&limit=5');

        $response->assertStatus(200);

        $data = $response->json();
        $this->assertCount(4, $data);

        // First 2 should be non-full centers, sorted by distance
        $this->assertEquals($farAvailableCenter->id, $data[0]['id']);
        $this->assertFalse($data[0]['is_full']);
        $this->assertEquals(5, $data[0]['occupancy']);
        $this->assertEquals(95, $data[0]['free_space']);

        $this->assertEquals($fartherAvailableCenter->id, $data[1]['id']);
        $this->assertFalse($data[1]['is_full']);
        $this->assertEquals(0, $data[1]['occupancy']);
        $this->assertEquals(200, $data[1]['free_space']);

        // Last 2 should be full centers, sorted by distance among themselves
        $this->assertEquals($nearFullCenter->id, $data[2]['id']);
        $this->assertTrue($data[2]['is_full']);
        $this->assertEquals(50, $data[2]['occupancy']);
        $this->assertEquals(0, $data[2]['free_space']);

        $this->assertEquals($midOverCenter->id, $data[3]['id']);
        $this->assertTrue($data[3]['is_full']);
        $this->assertEquals(25, $data[3]['occupancy']);
        $this->assertEquals(-5, $data[3]['free_space']);
    }

    /**
     * Test invalid lat/lng inputs return 422.
     */
    public function test_invalid_lat_lng_returns_422(): void
    {
        // Missing lat
        $this->getJson('/api/evacuation-centers/nearest?lng=125.4800')
            ->assertStatus(422)
            ->assertJsonValidationErrors(['lat']);

        // Missing lng
        $this->getJson('/api/evacuation-centers/nearest?lat=9.7800')
            ->assertStatus(422)
            ->assertJsonValidationErrors(['lng']);

        // Latitude > 90
        $this->getJson('/api/evacuation-centers/nearest?lat=90.1&lng=125.4800')
            ->assertStatus(422)
            ->assertJsonValidationErrors(['lat']);

        // Latitude < -90
        $this->getJson('/api/evacuation-centers/nearest?lat=-90.01&lng=125.4800')
            ->assertStatus(422)
            ->assertJsonValidationErrors(['lat']);

        // Longitude > 180
        $this->getJson('/api/evacuation-centers/nearest?lat=9.7800&lng=180.5')
            ->assertStatus(422)
            ->assertJsonValidationErrors(['lng']);

        // Longitude < -180
        $this->getJson('/api/evacuation-centers/nearest?lat=9.7800&lng=-180.05')
            ->assertStatus(422)
            ->assertJsonValidationErrors(['lng']);

        // Non-numeric lat
        $this->getJson('/api/evacuation-centers/nearest?lat=invalid&lng=125.4800')
            ->assertStatus(422)
            ->assertJsonValidationErrors(['lat']);
    }

    /**
     * Test limit is respected and capped at 5 (default is 3).
     */
    public function test_limit_is_respected_and_capped_at_5(): void
    {
        // Create 6 centers
        for ($i = 1; $i <= 6; $i++) {
            EvacuationCenter::create([
                'name' => "Center {$i}",
                'barangay_id' => $this->barangay->id,
                'latitude' => 9.7800 + ($i * 0.01),
                'longitude' => 125.4800 + ($i * 0.01),
                'capacity' => 100,
                'current_occupancy' => 0,
                'is_active' => true,
            ]);
        }

        // 1. Default limit when omitted: should return 3
        $resDefault = $this->getJson('/api/evacuation-centers/nearest?lat=9.7800&lng=125.4800');
        $resDefault->assertStatus(200);
        $this->assertCount(3, $resDefault->json());

        // 2. Explicit limit = 2: should return 2
        $resTwo = $this->getJson('/api/evacuation-centers/nearest?lat=9.7800&lng=125.4800&limit=2');
        $resTwo->assertStatus(200);
        $this->assertCount(2, $resTwo->json());

        // 3. Explicit limit = 4: should return 4
        $resFour = $this->getJson('/api/evacuation-centers/nearest?lat=9.7800&lng=125.4800&limit=4');
        $resFour->assertStatus(200);
        $this->assertCount(4, $resFour->json());

        // 4. Limit > 5 (e.g. limit=10): should be capped at 5
        $resCapped = $this->getJson('/api/evacuation-centers/nearest?lat=9.7800&lng=125.4800&limit=10');
        $resCapped->assertStatus(200);
        $this->assertCount(5, $resCapped->json());
    }

    /**
     * Test execution takes at most 2 DB queries total (centers + occupancy counts).
     */
    public function test_executes_at_most_two_db_queries(): void
    {
        for ($i = 1; $i <= 5; $i++) {
            $c = EvacuationCenter::create([
                'name' => "Center Query Test {$i}",
                'barangay_id' => $this->barangay->id,
                'latitude' => 9.7800 + ($i * 0.005),
                'longitude' => 125.4800 + ($i * 0.005),
                'capacity' => 100,
                'current_occupancy' => 0,
                'is_active' => true,
            ]);

            EvacuationLog::create([
                'evacuation_center_id' => $c->id,
                'type' => 'arrival',
                'headcount' => 10 * $i,
            ]);
        }

        DB::flushQueryLog();
        DB::enableQueryLog();

        $response = $this->getJson('/api/evacuation-centers/nearest?lat=9.7800&lng=125.4800&limit=5');
        $response->assertStatus(200);

        $queries = DB::getQueryLog();
        $this->assertLessThanOrEqual(2, count($queries), 'Expected at most 2 DB queries to prevent N+1.');
    }
}
