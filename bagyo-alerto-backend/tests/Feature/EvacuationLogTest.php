<?php

namespace Tests\Feature;

use App\Models\Barangay;
use App\Models\EvacuationCenter;
use App\Models\EvacuationLog;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Schema;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class EvacuationLogTest extends TestCase
{
    use DatabaseTransactions;

    protected User $user;
    protected \App\Models\Admin $admin;
    protected Barangay $barangayA;
    protected Barangay $barangayB;
    protected EvacuationCenter $center;

    protected function setUp(): void
    {
        parent::setUp();

        if (config('database.default') === 'sqlite') {
            if (!Schema::hasTable('users')) {
                Schema::create('users', function ($table) {
                    $table->increments('id');
                    $table->string('name');
                    $table->string('email')->unique();
                    $table->timestamp('email_verified_at')->nullable();
                    $table->string('password');
                    $table->rememberToken();
                    $table->timestamps();
                });
            }

            if (!Schema::hasTable('personal_access_tokens')) {
                Schema::create('personal_access_tokens', function ($table) {
                    $table->increments('id');
                    $table->morphs('tokenable');
                    $table->string('name');
                    $table->string('token', 64)->unique();
                    $table->text('abilities')->nullable();
                    $table->timestamp('last_used_at')->nullable();
                    $table->timestamp('expires_at')->nullable();
                    $table->timestamps();
                });
            }

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

            if (!Schema::hasTable('admins')) {
                Schema::create('admins', function ($table) {
                    $table->increments('id');
                    $table->string('name');
                    $table->string('username')->unique();
                    $table->string('password');
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
                    $table->unsignedInteger('recorded_by')->nullable();
                    $table->timestamps();
                });
            }
        }

        $this->admin = \App\Models\Admin::firstOrCreate(
            ['username' => 'admin'],
            ['name' => 'Super Admin', 'password' => bcrypt('admin123')]
        );

        $this->user = User::firstOrCreate(
            ['email' => 'testuser@example.com'],
            ['name' => 'Test User', 'password' => bcrypt('password')]
        );

        $this->barangayA = Barangay::create([
            'name' => 'Barangay Alpha',
            'city' => 'Surigao City',
            'latitude' => 9.7800,
            'longitude' => 125.4800,
            'risk_level' => 'high',
        ]);

        $this->barangayB = Barangay::create([
            'name' => 'Barangay Beta',
            'city' => 'Surigao City',
            'latitude' => 9.7900,
            'longitude' => 125.4900,
            'risk_level' => 'low',
        ]);

        $this->center = EvacuationCenter::create([
            'name' => 'Alpha Gym Shelter',
            'barangay_id' => $this->barangayA->id,
            'address' => 'Alpha Street 123',
            'latitude' => 9.7805,
            'longitude' => 125.4805,
            'capacity' => 100,
            'current_occupancy' => 0,
            'is_active' => true,
        ]);
    }

    public function test_unauthenticated_requests_are_rejected(): void
    {
        $response = $this->getJson("/api/evacuation-centers/{$this->center->id}/occupancy");
        $response->assertStatus(401);

        $response = $this->getJson("/api/barangays/{$this->barangayA->id}/evacuees");
        $response->assertStatus(401);

        $response = $this->postJson("/api/evacuation-centers/{$this->center->id}/logs", [
            'type' => 'arrival',
            'headcount' => 10,
        ]);
        $response->assertStatus(401);
    }

    public function test_store_validates_headcount_min_one(): void
    {
        Sanctum::actingAs($this->user);

        $response = $this->postJson("/api/evacuation-centers/{$this->center->id}/logs", [
            'type' => 'arrival',
            'headcount' => 0,
        ]);
        $response->assertStatus(422)
            ->assertJsonValidationErrors('headcount');
    }

    public function test_store_rejects_departure_making_occupancy_negative(): void
    {
        Sanctum::actingAs($this->user);

        // Center currently has 0 occupancy
        $response = $this->postJson("/api/evacuation-centers/{$this->center->id}/logs", [
            'type' => 'departure',
            'headcount' => 5,
        ]);

        $response->assertStatus(422);
        $this->assertStringContainsString('negative', strtolower($response->json('message') ?? ''));
    }

    public function test_store_records_arrivals_and_departures_correctly(): void
    {
        Sanctum::actingAs($this->user);

        // Arrival of 50 evacuees
        $response = $this->postJson("/api/evacuation-centers/{$this->center->id}/logs", [
            'type' => 'arrival',
            'headcount' => 50,
            'origin_barangay_id' => $this->barangayB->id,
        ]);

        $response->assertStatus(201)
            ->assertJson([
                'evacuation_center_id' => $this->center->id,
                'type' => 'arrival',
                'headcount' => 50,
                'origin_barangay_id' => $this->barangayB->id,
            ]);

        // Departure of 20 evacuees
        $response = $this->postJson("/api/evacuation-centers/{$this->center->id}/logs", [
            'type' => 'departure',
            'headcount' => 20,
        ]);

        $response->assertStatus(201)
            ->assertJson([
                'evacuation_center_id' => $this->center->id,
                'type' => 'departure',
                'headcount' => 20,
            ]);

        // Current occupancy should now be 30
        $occResponse = $this->getJson("/api/evacuation-centers/{$this->center->id}/occupancy");
        $occResponse->assertStatus(200)
            ->assertJson([
                'current' => 30,
                'capacity' => 100,
                'free_space' => 70,
                'status' => 'available',
            ]);
    }

    public function test_index_per_center_filtered_and_newest_first(): void
    {
        Sanctum::actingAs($this->user);

        $log1 = EvacuationLog::create([
            'evacuation_center_id' => $this->center->id,
            'origin_barangay_id' => $this->barangayA->id,
            'type' => 'arrival',
            'headcount' => 10,
            'recorded_by' => $this->user->id,
        ]);

        $log2 = EvacuationLog::create([
            'evacuation_center_id' => $this->center->id,
            'origin_barangay_id' => $this->barangayB->id,
            'type' => 'arrival',
            'headcount' => 20,
            'recorded_by' => $this->user->id,
        ]);

        $log3 = EvacuationLog::create([
            'evacuation_center_id' => $this->center->id,
            'origin_barangay_id' => null,
            'type' => 'departure',
            'headcount' => 5,
            'recorded_by' => $this->user->id,
        ]);

        // Query all logs for center
        $response = $this->getJson("/api/evacuation-centers/{$this->center->id}/logs");
        $response->assertStatus(200);
        $data = $response->json();
        $this->assertCount(3, $data);
        $this->assertEquals($log3->id, $data[0]['id']); // newest first
        $this->assertEquals($log2->id, $data[1]['id']);
        $this->assertEquals($log1->id, $data[2]['id']);

        // Filter by type=departure
        $filterType = $this->getJson("/api/evacuation-centers/{$this->center->id}/logs?type=departure");
        $filterType->assertStatus(200);
        $data = $filterType->json();
        $this->assertCount(1, $data);
        $this->assertEquals('departure', $data[0]['type']);

        // Filter by origin_barangay_id
        $filterOrigin = $this->getJson("/api/evacuation-centers/{$this->center->id}/logs?origin_barangay_id={$this->barangayB->id}");
        $filterOrigin->assertStatus(200);
        $data = $filterOrigin->json();
        $this->assertCount(1, $data);
        $this->assertEquals($this->barangayB->id, $data[0]['origin_barangay_id']);
    }

    public function test_destroy_allows_only_most_recent_log_entry(): void
    {
        Sanctum::actingAs($this->user);

        $log1 = EvacuationLog::create([
            'evacuation_center_id' => $this->center->id,
            'origin_barangay_id' => $this->barangayA->id,
            'type' => 'arrival',
            'headcount' => 15,
            'recorded_by' => $this->user->id,
        ]);

        $log2 = EvacuationLog::create([
            'evacuation_center_id' => $this->center->id,
            'origin_barangay_id' => $this->barangayA->id,
            'type' => 'arrival',
            'headcount' => 25,
            'recorded_by' => $this->user->id,
        ]);

        // Attempting to delete older log1 should fail
        $response = $this->deleteJson("/api/evacuation-logs/{$log1->id}");
        $response->assertStatus(422);
        $this->assertDatabaseHas('evacuation_logs', ['id' => $log1->id]);

        // Deleting the most recent log2 should succeed
        $response = $this->deleteJson("/api/evacuation-logs/{$log2->id}");
        $response->assertStatus(200);
        $this->assertDatabaseMissing('evacuation_logs', ['id' => $log2->id]);

        // Now log1 is the most recent log, so it can now be deleted
        $response = $this->deleteJson("/api/evacuation-logs/{$log1->id}");
        $response->assertStatus(200);
        $this->assertDatabaseMissing('evacuation_logs', ['id' => $log1->id]);
    }

    public function test_occupancy_statuses_and_threshold(): void
    {
        Sanctum::actingAs($this->user);

        // Center capacity is 100
        // Under 70%: available (e.g., 69)
        EvacuationLog::create([
            'evacuation_center_id' => $this->center->id,
            'type' => 'arrival',
            'headcount' => 69,
            'recorded_by' => $this->user->id,
        ]);

        $res = $this->getJson("/api/evacuation-centers/{$this->center->id}/occupancy");
        $res->assertStatus(200)
            ->assertJson([
                'current' => 69,
                'capacity' => 100,
                'free_space' => 31,
                'status' => 'available',
            ]);

        // 70% to 99%: almost_full (e.g., 70)
        EvacuationLog::create([
            'evacuation_center_id' => $this->center->id,
            'type' => 'arrival',
            'headcount' => 1,
            'recorded_by' => $this->user->id,
        ]);

        $res = $this->getJson("/api/evacuation-centers/{$this->center->id}/occupancy");
        $res->assertStatus(200)
            ->assertJson([
                'current' => 70,
                'capacity' => 100,
                'free_space' => 30,
                'status' => 'almost_full',
            ]);

        // 100%+: full (e.g., 100)
        EvacuationLog::create([
            'evacuation_center_id' => $this->center->id,
            'type' => 'arrival',
            'headcount' => 30,
            'recorded_by' => $this->user->id,
        ]);

        $res = $this->getJson("/api/evacuation-centers/{$this->center->id}/occupancy");
        $res->assertStatus(200)
            ->assertJson([
                'current' => 100,
                'capacity' => 100,
                'free_space' => 0,
                'status' => 'full',
            ]);
    }

    public function test_barangay_evacuees_endpoint(): void
    {
        Sanctum::actingAs($this->user);

        // Arrivals from Barangay A
        EvacuationLog::create([
            'evacuation_center_id' => $this->center->id,
            'origin_barangay_id' => $this->barangayA->id,
            'type' => 'arrival',
            'headcount' => 25,
            'recorded_by' => $this->user->id,
        ]);

        // Arrivals from Barangay B
        EvacuationLog::create([
            'evacuation_center_id' => $this->center->id,
            'origin_barangay_id' => $this->barangayB->id,
            'type' => 'arrival',
            'headcount' => 35,
            'recorded_by' => $this->user->id,
        ]);

        // Departures should not affect arrival grouping count
        EvacuationLog::create([
            'evacuation_center_id' => $this->center->id,
            'origin_barangay_id' => $this->barangayB->id,
            'type' => 'departure',
            'headcount' => 10,
            'recorded_by' => $this->user->id,
        ]);

        $response = $this->getJson("/api/barangays/{$this->barangayA->id}/evacuees");
        $response->assertStatus(200);

        $data = $response->json();
        $this->assertArrayHasKey('centers', $data);
        $this->assertArrayHasKey('arrivals_by_origin', $data);

        // Center occupancy check: 60 arrivals - 10 departures = 50 current
        $centerData = collect($data['centers'])->firstWhere('id', $this->center->id);
        $this->assertNotNull($centerData);
        $this->assertEquals(50, $centerData['current']);
        $this->assertEquals(50, $centerData['free_space']);
        $this->assertEquals('available', $centerData['status']);

        // Grouped arrivals check
        $origins = collect($data['arrivals_by_origin']);
        $originB = $origins->firstWhere('origin_barangay_id', $this->barangayB->id);
        $this->assertNotNull($originB);
        $this->assertEquals(35, $originB['headcount']);

        $originA = $origins->firstWhere('origin_barangay_id', $this->barangayA->id);
        $this->assertNotNull($originA);
        $this->assertEquals(25, $originA['headcount']);
    }

    public function test_post_logs_works_with_real_super_admin_token_and_saves_recorded_by(): void
    {
        // Issue a real Sanctum token for the super admin
        $token = $this->admin->createToken('admin-token')->plainTextToken;

        $response = $this->withHeader('Authorization', "Bearer {$token}")
            ->postJson("/api/evacuation-centers/{$this->center->id}/logs", [
                'type' => 'arrival',
                'headcount' => 15,
                'origin_barangay_id' => $this->barangayA->id,
            ]);

        $response->assertStatus(201)
            ->assertJson([
                'evacuation_center_id' => $this->center->id,
                'type' => 'arrival',
                'headcount' => 15,
                'recorded_by' => $this->admin->id,
            ]);

        $this->assertDatabaseHas('evacuation_logs', [
            'evacuation_center_id' => $this->center->id,
            'headcount' => 15,
            'recorded_by' => $this->admin->id,
        ]);
    }

    public function test_occupancy_card_with_capacity_200_and_arrival_of_50(): void
    {
        Sanctum::actingAs($this->admin);

        $center200 = EvacuationCenter::create([
            'name' => 'Washington Barangay Hall',
            'barangay_id' => $this->barangayA->id,
            'address' => 'Washington, Surigao City',
            'latitude' => 9.78549300,
            'longitude' => 125.48793500,
            'capacity' => 200,
            'current_occupancy' => 0,
            'is_active' => true,
        ]);

        EvacuationLog::create([
            'evacuation_center_id' => $center200->id,
            'type' => 'arrival',
            'headcount' => 50,
            'recorded_by' => $this->admin->id,
        ]);

        $response = $this->getJson("/api/evacuation-centers/{$center200->id}/occupancy");

        $response->assertStatus(200)
            ->assertJson([
                'current' => 50,
                'capacity' => 200,
                'free_space' => 150,
                'status' => 'available',
            ]);
    }

    public function test_occupancy_over_capacity_flag_when_arrivals_exceed_capacity(): void
    {
        Sanctum::actingAs($this->admin);

        // Create a center with capacity 200
        $center200 = EvacuationCenter::create([
            'name'              => 'Over Capacity Test Center',
            'barangay_id'       => $this->barangayA->id,
            'address'           => 'Test Street',
            'latitude'          => 9.7800,
            'longitude'         => 125.4800,
            'capacity'          => 200,
            'current_occupancy' => 0,
            'is_active'         => true,
        ]);

        // Record arrivals totalling 201 (1 over capacity)
        EvacuationLog::create([
            'evacuation_center_id' => $center200->id,
            'type'                 => 'arrival',
            'headcount'            => 200,
            'recorded_by'          => $this->admin->id,
        ]);
        EvacuationLog::create([
            'evacuation_center_id' => $center200->id,
            'type'                 => 'arrival',
            'headcount'            => 1,
            'recorded_by'          => $this->admin->id,
        ]);

        $response = $this->getJson("/api/evacuation-centers/{$center200->id}/occupancy");

        $response->assertStatus(200)
            ->assertJson([
                'current'       => 201,
                'capacity'      => 200,
                'free_space'    => 0,
                'status'        => 'full',
                'over_capacity' => true,
                'over_by'       => 1,
            ]);
    }

    public function test_occupancy_not_over_capacity_when_exactly_at_capacity(): void
    {
        Sanctum::actingAs($this->admin);

        // Create a center with capacity 200
        $center200 = EvacuationCenter::create([
            'name'              => 'Exactly Full Test Center',
            'barangay_id'       => $this->barangayA->id,
            'address'           => 'Test Street 2',
            'latitude'          => 9.7801,
            'longitude'         => 125.4801,
            'capacity'          => 200,
            'current_occupancy' => 0,
            'is_active'         => true,
        ]);

        // Record arrivals totalling exactly 200
        EvacuationLog::create([
            'evacuation_center_id' => $center200->id,
            'type'                 => 'arrival',
            'headcount'            => 200,
            'recorded_by'          => $this->admin->id,
        ]);

        $response = $this->getJson("/api/evacuation-centers/{$center200->id}/occupancy");

        $response->assertStatus(200)
            ->assertJson([
                'current'       => 200,
                'capacity'      => 200,
                'free_space'    => 0,
                'status'        => 'full',
                'over_capacity' => false,
                'over_by'       => 0,
            ]);
    }
}
