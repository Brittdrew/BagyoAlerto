<?php

namespace Tests\Feature;

use App\Models\Admin;
use App\Models\Barangay;
use App\Models\EvacuationCenter;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * Tests for GET /api/admin/hazard-map
 *
 * Covers:
 *   1. Auth is required (unauthenticated request -> 401)
 *   2. Response has correct top-level shape: barangays[], centers[]
 *   3. Barangay fields are present and correct
 *   4. Center fields are present and correct
 *   5. Inactive centers (is_active = 0) are excluded
 *   6. current_occupancy is computed from evacuation_logs (arrivals - departures)
 */
class AdminHazardMapTest extends TestCase
{
    use DatabaseTransactions;

    // Schema bootstrap for SQLite in-memory

    private function ensureTables(): void
    {
        if (! Schema::hasTable('barangays')) {
            Schema::create('barangays', function ($t) {
                $t->increments('id');
                $t->string('name', 100);
                $t->string('city', 100)->nullable();
                $t->decimal('latitude', 10, 8)->nullable();
                $t->decimal('longitude', 11, 8)->nullable();
                $t->string('risk_level', 20)->nullable();
                $t->string('flood_susceptibility')->nullable();
                $t->string('landslide_susceptibility')->nullable();
                $t->string('flood_point_class')->nullable();
                $t->string('landslide_point_class')->nullable();
                $t->boolean('flood_mapped_nearby')->nullable();
                $t->boolean('landslide_mapped_nearby')->nullable();
                $t->string('hazard_source')->nullable();
                $t->timestamp('hazard_checked_at')->nullable();
            });
        }

        if (! Schema::hasTable('evacuation_centers_list')) {
            Schema::create('evacuation_centers_list', function ($t) {
                $t->increments('id');
                $t->string('name', 150);
                $t->integer('barangay_id')->nullable();
                $t->string('address', 255)->nullable();
                $t->decimal('latitude', 10, 8)->nullable();
                $t->decimal('longitude', 11, 8)->nullable();
                $t->integer('capacity')->default(100);
                $t->unsignedInteger('current_occupancy')->default(0);
                $t->boolean('is_active')->default(1);
                $t->string('flood_susceptibility')->nullable();
                $t->string('landslide_susceptibility')->nullable();
                $t->string('flood_point_class')->nullable();
                $t->string('landslide_point_class')->nullable();
                $t->boolean('flood_mapped_nearby')->nullable();
                $t->boolean('landslide_mapped_nearby')->nullable();
                $t->string('hazard_source')->nullable();
                $t->timestamp('hazard_checked_at')->nullable();
                $t->timestamp('created_at')->nullable();
            });
        }

        if (! Schema::hasTable('personal_access_tokens')) {
            Schema::create('personal_access_tokens', function ($t) {
                $t->id();
                $t->morphs('tokenable');
                $t->string('name');
                $t->string('token', 64)->unique();
                $t->text('abilities')->nullable();
                $t->timestamp('last_used_at')->nullable();
                $t->timestamp('expires_at')->nullable();
                $t->timestamps();
            });
        }

        if (! Schema::hasTable('admins')) {
            Schema::create('admins', function ($t) {
                $t->id();
                $t->string('name');
                $t->string('username')->unique();
                $t->string('password');
                $t->timestamps();
            });
        }

        if (! Schema::hasTable('evacuation_logs')) {
            Schema::create('evacuation_logs', function ($t) {
                $t->id();
                $t->unsignedBigInteger('evacuation_center_id')->nullable();
                $t->unsignedBigInteger('origin_barangay_id')->nullable();
                $t->string('type')->default('arrival');
                $t->integer('headcount')->default(1);
                $t->string('source')->default('admin');
                $t->string('device_id')->nullable();
                $t->unsignedBigInteger('recorded_by')->nullable();
                $t->timestamps();
            });
        }
    }

    protected function setUp(): void
    {
        parent::setUp();
        if (config('database.default') === 'sqlite') {
            $this->ensureTables();
        }
    }

    // Helper methods

    private function makeAdmin(): Admin
    {
        return Admin::create([
            'name'     => 'Test Admin',
            'username' => 'testadmin_hazmap_' . uniqid(),
            'password' => bcrypt('password'),
        ]);
    }

    private function makeBarangay(array $attrs = []): Barangay
    {
        return Barangay::create(array_merge([
            'name'                     => 'Brgy_' . uniqid(),
            'latitude'                 => 9.78,
            'longitude'                => 125.49,
            'risk_level'               => 'moderate',
            'flood_susceptibility'     => 'low',
            'landslide_susceptibility' => 'moderate',
            'hazard_source'            => 'GeoRisk API',
        ], $attrs));
    }

    private function makeCenter(int $barangayId, array $attrs = []): EvacuationCenter
    {
        return EvacuationCenter::create(array_merge([
            'name'                     => 'Center_' . uniqid(),
            'barangay_id'              => $barangayId,
            'latitude'                 => 9.78,
            'longitude'                => 125.49,
            'capacity'                 => 100,
            'is_active'                => 1,
            'flood_susceptibility'     => 'high',
            'landslide_susceptibility' => 'low',
            'hazard_source'            => 'GeoRisk API',
        ], $attrs));
    }

    // Test 1: Unauthenticated request returns 401

    public function test_unauthenticated_request_returns_401(): void
    {
        $response = $this->getJson('/api/admin/hazard-map');
        $response->assertStatus(401);
    }

    // Test 2: Authenticated request returns 200 with correct shape

    public function test_authenticated_request_returns_200_with_shape(): void
    {
        $admin    = $this->makeAdmin();
        $token    = $admin->createToken('test')->plainTextToken;
        $barangay = $this->makeBarangay();
        $this->makeCenter($barangay->id);

        $response = $this->withToken($token)->getJson('/api/admin/hazard-map');

        $response->assertStatus(200);
        $response->assertJsonStructure([
            'barangays' => [['id', 'name', 'lat', 'lng', 'risk_level', 'flood_class', 'landslide_class']],
            'centers'   => [['id', 'name', 'barangay_id', 'lat', 'lng', 'capacity',
                              'current_occupancy', 'flood_class', 'landslide_class', 'hazard_source']],
        ]);
    }

    // Test 3: Barangay fields contain the expected values

    public function test_barangay_fields_are_correct(): void
    {
        $admin    = $this->makeAdmin();
        $token    = $admin->createToken('test')->plainTextToken;
        $barangay = $this->makeBarangay([
            'name'                     => 'HazardBrgy_' . uniqid(),
            'risk_level'               => 'high',
            'flood_susceptibility'     => 'high',
            'landslide_susceptibility' => 'moderate',
        ]);

        $response = $this->withToken($token)->getJson('/api/admin/hazard-map');
        $response->assertStatus(200);

        $found = collect($response->json('barangays'))->firstWhere('id', $barangay->id);
        $this->assertNotNull($found, 'Barangay must appear in response');
        $this->assertSame((float) $barangay->latitude,  $found['lat']);
        $this->assertSame((float) $barangay->longitude, $found['lng']);
        $this->assertSame('high',     $found['risk_level']);
        $this->assertSame('high',     $found['flood_class']);
        $this->assertSame('moderate', $found['landslide_class']);
    }

    // Test 4: Center fields contain the expected values

    public function test_center_fields_are_correct(): void
    {
        $admin    = $this->makeAdmin();
        $token    = $admin->createToken('test')->plainTextToken;
        $barangay = $this->makeBarangay();
        $center   = $this->makeCenter($barangay->id, [
            'capacity'                 => 200,
            'flood_susceptibility'     => 'high',
            'landslide_susceptibility' => 'low',
            'hazard_source'            => 'GeoRisk API',
        ]);

        $response = $this->withToken($token)->getJson('/api/admin/hazard-map');
        $response->assertStatus(200);

        $found = collect($response->json('centers'))->firstWhere('id', $center->id);
        $this->assertNotNull($found, 'Active center must appear in response');
        $this->assertSame($barangay->id,  $found['barangay_id']);
        $this->assertSame(200,            $found['capacity']);
        $this->assertSame(0,              $found['current_occupancy']);
        $this->assertSame('high',         $found['flood_class']);
        $this->assertSame('low',          $found['landslide_class']);
        $this->assertSame('GeoRisk API',  $found['hazard_source']);
    }

    // Test 5: Inactive centers are excluded

    public function test_inactive_centers_are_excluded(): void
    {
        $admin    = $this->makeAdmin();
        $token    = $admin->createToken('test')->plainTextToken;
        $barangay = $this->makeBarangay();

        $activeCenter   = $this->makeCenter($barangay->id, ['is_active' => 1]);
        $inactiveCenter = $this->makeCenter($barangay->id, ['is_active' => 0]);

        $response = $this->withToken($token)->getJson('/api/admin/hazard-map');
        $response->assertStatus(200);

        $centerIds = collect($response->json('centers'))->pluck('id')->toArray();
        $this->assertContains($activeCenter->id,     $centerIds, 'Active center must appear');
        $this->assertNotContains($inactiveCenter->id, $centerIds, 'Inactive center must not appear');
    }

    // Test 6: current_occupancy is derived from logs

    public function test_current_occupancy_computed_from_logs(): void
    {
        $admin    = $this->makeAdmin();
        $token    = $admin->createToken('test')->plainTextToken;
        $barangay = $this->makeBarangay();
        $center   = $this->makeCenter($barangay->id, ['capacity' => 50]);

        DB::table('evacuation_logs')->insert([
            ['evacuation_center_id' => $center->id, 'type' => 'arrival',   'headcount' => 30, 'source' => 'admin', 'created_at' => now(), 'updated_at' => now()],
            ['evacuation_center_id' => $center->id, 'type' => 'arrival',   'headcount' => 10, 'source' => 'admin', 'created_at' => now(), 'updated_at' => now()],
            ['evacuation_center_id' => $center->id, 'type' => 'departure', 'headcount' =>  5, 'source' => 'admin', 'created_at' => now(), 'updated_at' => now()],
        ]);

        // Expected: 30 + 10 - 5 = 35
        $response = $this->withToken($token)->getJson('/api/admin/hazard-map');
        $response->assertStatus(200);

        $found = collect($response->json('centers'))->firstWhere('id', $center->id);
        $this->assertNotNull($found);
        $this->assertSame(35, $found['current_occupancy']);
    }
}
