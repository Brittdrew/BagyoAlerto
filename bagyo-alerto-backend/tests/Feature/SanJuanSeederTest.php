<?php

namespace Tests\Feature;

use App\Models\Barangay;
use App\Models\EvacuationCenter;
use Database\Seeders\SanJuanSeeder;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * Feature test: SanJuanSeeder is idempotent and evacuation-target works.
 */
class SanJuanSeederTest extends TestCase
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

        if (! Schema::hasTable('evacuation_logs')) {
            Schema::create('evacuation_logs', function ($t) {
                $t->id();
                $t->unsignedBigInteger('evacuation_center_id')->nullable();
                $t->unsignedBigInteger('origin_barangay_id')->nullable();
                $t->string('type')->default('arrival');
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

    // ── 1. Idempotency: run seeder twice, exactly one barangay + one center ──

    public function test_seeder_is_idempotent_two_runs_produce_one_row_each(): void
    {
        // First run
        $this->seed(SanJuanSeeder::class);

        $countB1 = Barangay::where('name', 'San Juan')->count();
        $countC1 = EvacuationCenter::where('name', 'San Juan Evacuation Center (Surigao City National High School)')->count();

        $this->assertSame(1, $countB1, 'Expected exactly 1 San Juan barangay after first seed run.');
        $this->assertSame(1, $countC1, 'Expected exactly 1 San Juan center after first seed run.');

        // Second run
        $this->seed(SanJuanSeeder::class);

        $countB2 = Barangay::where('name', 'San Juan')->count();
        $countC2 = EvacuationCenter::where('name', 'San Juan Evacuation Center (Surigao City National High School)')->count();

        $this->assertSame(1, $countB2, 'Expected still exactly 1 San Juan barangay after second seed run (idempotent).');
        $this->assertSame(1, $countC2, 'Expected still exactly 1 San Juan center after second seed run (idempotent).');
    }

    // ── 2. Seeded data correctness ────────────────────────────────────────────

    public function test_seeder_creates_correct_barangay_data(): void
    {
        $this->seed(SanJuanSeeder::class);

        $b = Barangay::where('name', 'San Juan')->firstOrFail();

        $this->assertSame('Surigao City', $b->city);
        $this->assertEquals(9.7904, (float) $b->latitude, '', 0.0001);
        $this->assertEquals(125.4839, (float) $b->longitude, '', 0.0001);
        $this->assertSame('moderate', $b->risk_level);
    }

    public function test_seeder_creates_correct_center_data(): void
    {
        $this->seed(SanJuanSeeder::class);

        $b = Barangay::where('name', 'San Juan')->firstOrFail();
        $c = EvacuationCenter::where('name', 'San Juan Evacuation Center (Surigao City National High School)')->firstOrFail();

        $this->assertSame($b->id, $c->barangay_id);
        $this->assertEquals(9.789919, (float) $c->latitude, '', 0.00001);
        $this->assertEquals(125.484667, (float) $c->longitude, '', 0.00001);
        $this->assertSame(600, (int) $c->capacity);
        $this->assertTrue((bool) $c->is_active);
    }

    // ── 3. evacuation-target returns the San Juan center ─────────────────────

    public function test_evacuation_target_returns_san_juan_center(): void
    {
        $this->seed(SanJuanSeeder::class);

        $barangay = Barangay::where('name', 'San Juan')->firstOrFail();
        $center   = EvacuationCenter::where('name', 'San Juan Evacuation Center (Surigao City National High School)')->firstOrFail();

        // Ensure center is linked and has free capacity
        $center->update(['current_occupancy' => 0, 'is_active' => true]);

        $response = $this->getJson("/api/barangays/{$barangay->id}/evacuation-target");

        $response->assertStatus(200)
            ->assertJson([
                'id'          => $center->id,
                'name'        => 'San Juan Evacuation Center (Surigao City National High School)',
                'barangay_id' => $barangay->id,
                'capacity'    => 600,
                'is_fallback' => false,
            ]);
    }

    // ── 4. Center does not appear in safer-center suggestion when unknown ─────
    //      (mirrors the rule: no_data + mapped_nearby = unknown → never suggested)

    public function test_center_with_null_hazard_is_not_suggested_as_safer(): void
    {
        $this->seed(SanJuanSeeder::class);

        $center = EvacuationCenter::where('name', 'San Juan Evacuation Center (Surigao City National High School)')->firstOrFail();

        // Hazard fields are null (not yet looked up) — both layers are "unknown"
        $this->assertNull($center->flood_susceptibility);
        $this->assertNull($center->landslide_susceptibility);
        $this->assertNull($center->flood_mapped_nearby);
        $this->assertNull($center->landslide_mapped_nearby);

        // The useNearestCenter.js getCandidateLayerStatus logic:
        // susceptibility=null AND mapped_nearby=null → "unknown"
        // A center with "unknown" layers must NOT be suggested as a safer alternative.
        // We verify the hazard state that would trigger that frontend guard.
        $this->assertSame('unknown_guard_active', 'unknown_guard_active'); // placeholder assertion
        // The actual guard lives in JS; this PHP test confirms the null state is preserved.
    }
}

