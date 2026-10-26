<?php

namespace Tests\Feature;

use App\Models\Admin;
use App\Models\Barangay;
use App\Models\EvacuationCenter;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * Tests for PART 1: hazard_level accessor, new endpoint fields,
 * admin update validation + manual-source tagging, non-admin rejection.
 */
class HazardFieldsTest extends TestCase
{
    use DatabaseTransactions;

    // ── Schema bootstrap for SQLite in-memory ────────────────────────────────

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
                $t->string('type')->default('arrival');   // arrival | departure
                $t->integer('headcount')->default(1);
                $t->integer('household_count')->default(1);
                $t->string('status')->default('arrived');
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

    // ── Helper ────────────────────────────────────────────────────────────────

    private function makeAdmin(): Admin
    {
        return Admin::create([
            'name'     => 'Test Admin',
            'username' => 'testadmin_' . uniqid(),
            'password' => bcrypt('password'),
        ]);
    }

    // ── 1. hazard_level accessor — worst-of logic ─────────────────────────────

    public function test_hazard_level_both_null_returns_null(): void
    {
        $b = Barangay::create(['name' => 'TestB', 'flood_susceptibility' => null, 'landslide_susceptibility' => null]);
        $this->assertNull($b->hazard_level);
    }

    public function test_hazard_level_only_flood_set(): void
    {
        $b = Barangay::create(['name' => 'TestB', 'flood_susceptibility' => 'high', 'landslide_susceptibility' => null]);
        $this->assertSame('high', $b->hazard_level);
    }

    public function test_hazard_level_only_landslide_set(): void
    {
        $b = Barangay::create(['name' => 'TestB', 'flood_susceptibility' => null, 'landslide_susceptibility' => 'moderate']);
        $this->assertSame('moderate', $b->hazard_level);
    }

    public function test_hazard_level_picks_worst_very_high(): void
    {
        $b = Barangay::create(['name' => 'TestB', 'flood_susceptibility' => 'high', 'landslide_susceptibility' => 'very_high']);
        $this->assertSame('very_high', $b->hazard_level);
    }

    public function test_hazard_level_picks_worst_flood_wins(): void
    {
        $b = Barangay::create(['name' => 'TestB', 'flood_susceptibility' => 'very_high', 'landslide_susceptibility' => 'low']);
        $this->assertSame('very_high', $b->hazard_level);
    }

    public function test_hazard_level_equal_rank(): void
    {
        $b = Barangay::create(['name' => 'TestB', 'flood_susceptibility' => 'moderate', 'landslide_susceptibility' => 'moderate']);
        $this->assertSame('moderate', $b->hazard_level);
    }

    public function test_evacuation_center_hazard_level_accessor(): void
    {
        $b = Barangay::create(['name' => 'Brgy', 'latitude' => 9.78, 'longitude' => 125.49]);
        $c = EvacuationCenter::create([
            'name'                     => 'Center X',
            'barangay_id'              => $b->id,
            'latitude'                 => 9.78,
            'longitude'                => 125.49,
            'flood_susceptibility'     => 'moderate',
            'landslide_susceptibility' => 'high',
        ]);
        $this->assertSame('high', $c->hazard_level);
    }

    // ── 2. Endpoints return hazard fields ─────────────────────────────────────

    public function test_barangays_list_includes_hazard_fields(): void
    {
        Barangay::create([
            'name'                     => 'HazardBarangay',
            'flood_susceptibility'     => 'low',
            'landslide_susceptibility' => 'moderate',
            'hazard_source'            => 'GeoRisk API',
        ]);

        $response = $this->getJson('/api/barangays');
        $response->assertStatus(200);

        $data = $response->json();
        $found = collect($data)->firstWhere('name', 'HazardBarangay');
        $this->assertNotNull($found);
        $this->assertArrayHasKey('flood_susceptibility', $found);
        $this->assertArrayHasKey('landslide_susceptibility', $found);
        $this->assertArrayHasKey('hazard_level', $found);
        $this->assertArrayHasKey('hazard_source', $found);
        $this->assertArrayHasKey('hazard_checked_at', $found);
        $this->assertSame('moderate', $found['hazard_level']);
    }

    public function test_barangay_show_includes_hazard_fields(): void
    {
        $b = Barangay::create([
            'name'                     => 'ShowBarangay',
            'flood_susceptibility'     => 'very_high',
            'landslide_susceptibility' => null,
            'hazard_source'            => 'manual (admin)',
        ]);

        $response = $this->getJson("/api/barangays/{$b->id}");
        $response->assertStatus(200)
            ->assertJsonFragment(['hazard_level' => 'very_high'])
            ->assertJsonFragment(['hazard_source' => 'manual (admin)']);
    }

    public function test_evacuation_centers_list_includes_hazard_fields(): void
    {
        $b = Barangay::create(['name' => 'BrgyEC', 'latitude' => 9.78, 'longitude' => 125.49]);
        EvacuationCenter::create([
            'name'                     => 'HazardCenter',
            'barangay_id'              => $b->id,
            'latitude'                 => 9.78,
            'longitude'                => 125.49,
            'flood_susceptibility'     => 'high',
            'landslide_susceptibility' => null,
            'hazard_source'            => 'GeoRisk API',
        ]);

        $response = $this->getJson('/api/evacuation-centers');
        $response->assertStatus(200);

        $data   = $response->json();
        $found  = collect($data)->firstWhere('name', 'HazardCenter');
        $this->assertNotNull($found);
        $this->assertArrayHasKey('flood_susceptibility', $found);
        $this->assertArrayHasKey('hazard_level', $found);
        $this->assertSame('high', $found['hazard_level']);
    }

    public function test_evacuation_center_show_includes_hazard_fields(): void
    {
        $b = Barangay::create(['name' => 'BrgyShow', 'latitude' => 9.78, 'longitude' => 125.49]);
        $c = EvacuationCenter::create([
            'name'                     => 'ShowCenter',
            'barangay_id'              => $b->id,
            'latitude'                 => 9.78,
            'longitude'                => 125.49,
            'flood_susceptibility'     => 'low',
            'landslide_susceptibility' => 'very_high',
        ]);

        $response = $this->getJson("/api/evacuation-centers/{$c->id}");
        $response->assertStatus(200)
            ->assertJsonFragment(['hazard_level' => 'very_high'])
            ->assertJsonFragment(['flood_susceptibility' => 'low'])
            ->assertJsonFragment(['landslide_susceptibility' => 'very_high']);
    }

    public function test_evacuation_center_nearest_includes_hazard_fields(): void
    {
        $b = Barangay::create(['name' => 'BrgyNearest', 'latitude' => 9.78, 'longitude' => 125.49]);
        EvacuationCenter::create([
            'name'                     => 'NearCenter',
            'barangay_id'              => $b->id,
            'latitude'                 => 9.78,
            'longitude'                => 125.49,
            'capacity'                 => 100,
            'current_occupancy'        => 0,
            'is_active'                => true,
            'flood_susceptibility'     => 'moderate',
            'landslide_susceptibility' => 'low',
        ]);

        $response = $this->getJson('/api/evacuation-centers/nearest?lat=9.78&lng=125.49&limit=5');
        $response->assertStatus(200);

        $data  = $response->json();
        $found = collect($data)->firstWhere('name', 'NearCenter');
        $this->assertNotNull($found);
        $this->assertArrayHasKey('flood_susceptibility', $found);
        $this->assertArrayHasKey('landslide_susceptibility', $found);
        $this->assertArrayHasKey('hazard_level', $found);
        $this->assertArrayHasKey('hazard_source', $found);
        $this->assertArrayHasKey('hazard_checked_at', $found);
        $this->assertSame('moderate', $found['hazard_level']);
    }

    public function test_evacuation_target_includes_hazard_fields(): void
    {
        $b = Barangay::create(['name' => 'TargetBrgy', 'latitude' => 9.78, 'longitude' => 125.49]);
        EvacuationCenter::create([
            'name'                     => 'TargetCenter',
            'barangay_id'              => $b->id,
            'latitude'                 => 9.78,
            'longitude'                => 125.49,
            'capacity'                 => 50,
            'current_occupancy'        => 0,
            'is_active'                => true,
            'flood_susceptibility'     => 'high',
            'landslide_susceptibility' => 'moderate',
        ]);

        $response = $this->getJson("/api/barangays/{$b->id}/evacuation-target");
        $response->assertStatus(200)
            ->assertJsonFragment(['flood_susceptibility' => 'high'])
            ->assertJsonFragment(['hazard_level' => 'high']);
    }

    // ── 3. Admin update: validation + manual source tag ───────────────────────

    public function test_admin_barangay_update_rejects_invalid_susceptibility(): void
    {
        $b = Barangay::create([
            'name'       => 'ValidBrgy',
            'city'       => 'Surigao City',
            'latitude'   => 9.78,
            'longitude'  => 125.49,
            'risk_level' => 'low',
        ]);

        $admin = $this->makeAdmin();
        $token = $admin->createToken('test')->plainTextToken;

        $response = $this->withToken($token)->putJson("/api/admin/barangays/{$b->id}", [
            'name'                 => 'ValidBrgy',
            'city'                 => 'Surigao City',
            'latitude'             => 9.78,
            'longitude'            => 125.49,
            'risk_level'           => 'low',
            'flood_susceptibility' => 'extreme', // invalid
        ]);

        $response->assertStatus(422);
    }

    public function test_admin_barangay_update_sets_manual_source_when_susceptibility_changes(): void
    {
        $b = Barangay::create([
            'name'                     => 'SourceBrgy',
            'city'                     => 'Surigao City',
            'latitude'                 => 9.78,
            'longitude'                => 125.49,
            'risk_level'               => 'low',
            'flood_susceptibility'     => null,
            'landslide_susceptibility' => null,
        ]);

        $admin = $this->makeAdmin();
        $token = $admin->createToken('test')->plainTextToken;

        $response = $this->withToken($token)->putJson("/api/admin/barangays/{$b->id}", [
            'name'                     => 'SourceBrgy',
            'city'                     => 'Surigao City',
            'latitude'                 => 9.78,
            'longitude'                => 125.49,
            'risk_level'               => 'low',
            'flood_susceptibility'     => 'high',
            'landslide_susceptibility' => null,
        ]);

        $response->assertStatus(200);
        $b->refresh();
        $this->assertSame('high', $b->flood_susceptibility);
        $this->assertSame('manual (admin)', $b->hazard_source);
        $this->assertNotNull($b->hazard_checked_at);
    }

    public function test_admin_evacuation_center_update_sets_manual_source(): void
    {
        $b = Barangay::create([
            'name'       => 'ECBrgy',
            'city'       => 'Surigao City',
            'latitude'   => 9.78,
            'longitude'  => 125.49,
            'risk_level' => 'low',
        ]);
        $c = EvacuationCenter::create([
            'name'                     => 'ManualCenter',
            'barangay_id'              => $b->id,
            'address'                  => '123 Street',
            'latitude'                 => 9.78,
            'longitude'                => 125.49,
            'capacity'                 => 100,
            'is_active'                => true,
            'flood_susceptibility'     => null,
            'landslide_susceptibility' => null,
        ]);

        $admin = $this->makeAdmin();
        $token = $admin->createToken('test')->plainTextToken;

        $response = $this->withToken($token)->putJson("/api/admin/evacuation-centers/{$c->id}", [
            'name'                     => 'ManualCenter',
            'barangay_id'              => $b->id,
            'address'                  => '123 Street',
            'latitude'                 => 9.78,
            'longitude'                => 125.49,
            'capacity'                 => 100,
            'is_active'                => true,
            'flood_susceptibility'     => 'very_high',
            'landslide_susceptibility' => 'moderate',
        ]);

        $response->assertStatus(200);
        $c->refresh();
        $this->assertSame('very_high', $c->flood_susceptibility);
        $this->assertSame('moderate', $c->landslide_susceptibility);
        $this->assertSame('manual (admin)', $c->hazard_source);
        $this->assertNotNull($c->hazard_checked_at);
    }

    public function test_admin_update_no_change_does_not_overwrite_source(): void
    {
        $b = Barangay::create([
            'name'                     => 'NoChangeBrgy',
            'city'                     => 'Surigao City',
            'latitude'                 => 9.78,
            'longitude'                => 125.49,
            'risk_level'               => 'low',
            'flood_susceptibility'     => 'low',
            'landslide_susceptibility' => null,
            'hazard_source'            => 'GeoRisk API',
        ]);

        $admin = $this->makeAdmin();
        $token = $admin->createToken('test')->plainTextToken;

        // Send same flood_susceptibility — should NOT overwrite hazard_source
        $response = $this->withToken($token)->putJson("/api/admin/barangays/{$b->id}", [
            'name'                     => 'NoChangeBrgy',
            'city'                     => 'Surigao City',
            'latitude'                 => 9.78,
            'longitude'                => 125.49,
            'risk_level'               => 'low',
            'flood_susceptibility'     => 'low', // same value
            'landslide_susceptibility' => null,
        ]);

        $response->assertStatus(200);
        $b->refresh();
        $this->assertSame('GeoRisk API', $b->hazard_source);
    }

    // ── 4. Non-admin cannot update ────────────────────────────────────────────

    public function test_unauthenticated_cannot_update_barangay(): void
    {
        $b = Barangay::create([
            'name' => 'UnauthedBrgy', 'city' => 'City',
            'latitude' => 9.78, 'longitude' => 125.49, 'risk_level' => 'low',
        ]);

        $response = $this->putJson("/api/admin/barangays/{$b->id}", [
            'name' => 'UnauthedBrgy', 'city' => 'City',
            'latitude' => 9.78, 'longitude' => 125.49, 'risk_level' => 'low',
        ]);

        $response->assertStatus(401);
    }

    public function test_unauthenticated_cannot_update_evacuation_center(): void
    {
        $b = Barangay::create(['name' => 'BrgyEC2', 'latitude' => 9.78, 'longitude' => 125.49]);
        $c = EvacuationCenter::create([
            'name' => 'UnauthedCenter', 'barangay_id' => $b->id,
            'address' => 'Addr', 'latitude' => 9.78, 'longitude' => 125.49,
            'capacity' => 50, 'is_active' => true,
        ]);

        $response = $this->putJson("/api/admin/evacuation-centers/{$c->id}", [
            'name' => 'UnauthedCenter', 'barangay_id' => $b->id,
            'address' => 'Addr', 'latitude' => 9.78, 'longitude' => 125.49,
            'capacity' => 50, 'is_active' => true,
        ]);

        $response->assertStatus(401);
    }
}
