<?php

namespace Tests\Feature;

use App\Models\Admin;
use App\Models\Barangay;
use App\Models\EvacuationCenter;
use App\Models\EvacuationLog;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Schema;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Tests for:
 *  1. GET /api/evacuation-centers/overview matches /occupancy for each center,
 *     including a center that is over capacity.
 *  2. Cache is cleared when a center is edited via the admin API.
 */
class EvacuationOverviewTest extends TestCase
{
    use DatabaseTransactions;

    protected Admin $admin;
    protected Barangay $barangay;
    protected EvacuationCenter $centerA;
    protected EvacuationCenter $centerB;
    protected EvacuationCenter $centerOver;

    protected function setUp(): void
    {
        parent::setUp();

        // ── Bootstrap in-memory SQLite tables identical to EvacuationLogTest ─
        if (config('database.default') === 'sqlite') {
            foreach ([
                'users', 'personal_access_tokens', 'barangays',
                'evacuation_centers_list', 'admins', 'evacuation_logs',
            ] as $table) {
                if (!Schema::hasTable($table)) {
                    $this->createSqliteTable($table);
                }
            }

            if (!Schema::hasColumn('evacuation_logs', 'source')) {
                Schema::table('evacuation_logs', function ($t) {
                    $t->string('source', 20)->default('admin');
                    $t->string('device_id', 255)->nullable();
                });
            }
        }

        $this->admin = Admin::firstOrCreate(
            ['username' => 'overview_test_admin'],
            ['name' => 'Overview Test Admin', 'password' => bcrypt('secret')]
        );

        $this->barangay = Barangay::create([
            'name'       => 'Barangay Overview',
            'city'       => 'Surigao City',
            'latitude'   => 9.78,
            'longitude'  => 125.48,
            'risk_level' => 'high',
        ]);

        // Center A: partially filled (available)
        $this->centerA = EvacuationCenter::create([
            'name'              => 'Overview Center A',
            'barangay_id'       => $this->barangay->id,
            'address'           => 'St A',
            'latitude'          => 9.781,
            'longitude'         => 125.481,
            'capacity'          => 100,
            'current_occupancy' => 0,
            'is_active'         => true,
        ]);

        // Center B: 70 % full (almost_full threshold)
        $this->centerB = EvacuationCenter::create([
            'name'              => 'Overview Center B',
            'barangay_id'       => $this->barangay->id,
            'address'           => 'St B',
            'latitude'          => 9.782,
            'longitude'         => 125.482,
            'capacity'          => 100,
            'current_occupancy' => 0,
            'is_active'         => true,
        ]);

        // Center Over: will receive logs that push it past capacity
        $this->centerOver = EvacuationCenter::create([
            'name'              => 'Overview Center Over',
            'barangay_id'       => $this->barangay->id,
            'address'           => 'St Over',
            'latitude'          => 9.783,
            'longitude'         => 125.483,
            'capacity'          => 10,
            'current_occupancy' => 0,
            'is_active'         => true,
        ]);

        // ── Seed logs ────────────────────────────────────────────────────────
        // Center A: 30 arrivals, 5 departures => current = 25
        $this->seedLog($this->centerA, 'arrival',   30);
        $this->seedLog($this->centerA, 'departure',  5);

        // Center B: 70 arrivals => current = 70 (70 %)
        $this->seedLog($this->centerB, 'arrival', 70);

        // Center Over: 15 arrivals on capacity 10 => over capacity by 5
        $this->seedLog($this->centerOver, 'arrival', 15);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private function seedLog(EvacuationCenter $center, string $type, int $headcount): void
    {
        EvacuationLog::create([
            'evacuation_center_id' => $center->id,
            'type'                 => $type,
            'headcount'            => $headcount,
            'source'               => 'admin',
            'recorded_by'          => null,
        ]);
    }

    private function authHeaders(): array
    {
        Sanctum::actingAs($this->admin, [], 'admin');
        return [];
    }

    /** Fetch /occupancy for a specific center. */
    private function fetchOccupancy(EvacuationCenter $center): array
    {
        $this->authHeaders();
        $res = $this->getJson("/api/evacuation-centers/{$center->id}/occupancy");
        $res->assertStatus(200);
        return $res->json();
    }

    /** Find the overview row for a specific center. */
    private function overviewRow(array $overview, EvacuationCenter $center): ?array
    {
        foreach ($overview as $row) {
            if ((int) $row['id'] === (int) $center->id) {
                return $row;
            }
        }
        return null;
    }

    // ── Tests ─────────────────────────────────────────────────────────────────

    /** Overview returns 200 and is an array. */
    public function test_overview_returns_200(): void
    {
        $this->authHeaders();
        $res = $this->getJson('/api/evacuation-centers/overview');
        $res->assertStatus(200);
        $this->assertIsArray($res->json());
    }

    /** Overview requires auth. */
    public function test_overview_requires_auth(): void
    {
        $res = $this->getJson('/api/evacuation-centers/overview');
        $res->assertStatus(401);
    }

    /**
     * For Center A (25 current, 100 capacity, available):
     * overview.current == occupancy.current, same status, same free_space.
     */
    public function test_overview_matches_occupancy_for_available_center(): void
    {
        $occ = $this->fetchOccupancy($this->centerA);

        $this->authHeaders();
        $overviewRes = $this->getJson('/api/evacuation-centers/overview');
        $overviewRes->assertStatus(200);

        $row = $this->overviewRow($overviewRes->json(), $this->centerA);
        $this->assertNotNull($row, 'Center A not found in overview');

        $this->assertSame((int) $occ['current'],    (int) $row['current'],    'current mismatch');
        $this->assertSame((int) $occ['capacity'],   (int) $row['capacity'],   'capacity mismatch');
        $this->assertSame((int) $occ['free_space'], (int) $row['free_space'], 'free_space mismatch');
        $this->assertSame($occ['status'],            $row['status'],           'status mismatch');
        $this->assertSame((bool) $occ['over_capacity'], (bool) $row['over_capacity'], 'over_capacity mismatch');
        $this->assertSame(25, (int) $row['current']);
        $this->assertSame('available', $row['status']);
    }

    /**
     * For Center B (70 current, 100 capacity, almost_full):
     * overview matches occupancy exactly.
     */
    public function test_overview_matches_occupancy_for_almost_full_center(): void
    {
        $occ = $this->fetchOccupancy($this->centerB);

        $this->authHeaders();
        $overviewRes = $this->getJson('/api/evacuation-centers/overview');
        $overviewRes->assertStatus(200);

        $row = $this->overviewRow($overviewRes->json(), $this->centerB);
        $this->assertNotNull($row, 'Center B not found in overview');

        $this->assertSame((int) $occ['current'],    (int) $row['current']);
        $this->assertSame((int) $occ['capacity'],   (int) $row['capacity']);
        $this->assertSame((int) $occ['free_space'], (int) $row['free_space']);
        $this->assertSame($occ['status'],            $row['status']);
        $this->assertSame(70, (int) $row['current']);
        $this->assertSame('almost_full', $row['status']);
    }

    /**
     * For Center Over (15 current, 10 capacity, over_capacity):
     * overview matches occupancy, over_capacity = true, over_by = 5.
     */
    public function test_overview_matches_occupancy_for_over_capacity_center(): void
    {
        $occ = $this->fetchOccupancy($this->centerOver);

        $this->authHeaders();
        $overviewRes = $this->getJson('/api/evacuation-centers/overview');
        $overviewRes->assertStatus(200);

        $row = $this->overviewRow($overviewRes->json(), $this->centerOver);
        $this->assertNotNull($row, 'Over-capacity center not found in overview');

        $this->assertSame((int) $occ['current'],       (int) $row['current'],       'current mismatch');
        $this->assertSame((int) $occ['capacity'],      (int) $row['capacity'],      'capacity mismatch');
        $this->assertSame((int) $occ['free_space'],    (int) $row['free_space'],    'free_space mismatch');
        $this->assertSame($occ['status'],               $row['status'],              'status mismatch');
        $this->assertSame((bool) $occ['over_capacity'], (bool) $row['over_capacity'], 'over_capacity mismatch');
        $this->assertSame((int) $occ['over_by'],       (int) $row['over_by'],       'over_by mismatch');

        // Concrete values
        $this->assertSame(15, (int) $row['current']);
        $this->assertSame(0,  (int) $row['free_space']);
        $this->assertTrue((bool) $row['over_capacity']);
        $this->assertSame(5, (int) $row['over_by']);
        $this->assertSame('full', $row['status']);
    }

    /**
     * Overview response includes barangay_name field populated from the eager load.
     */
    public function test_overview_includes_barangay_name(): void
    {
        $this->authHeaders();
        $res = $this->getJson('/api/evacuation-centers/overview');
        $res->assertStatus(200);

        $row = $this->overviewRow($res->json(), $this->centerA);
        $this->assertNotNull($row);
        $this->assertArrayHasKey('barangay_name', $row);
        $this->assertSame($this->barangay->name, $row['barangay_name']);
    }

    /**
     * The public evacuation-centers list cache is cleared after an admin PUT
     * (update) — the next request returns fresh data.
     */
    public function test_cache_clears_after_center_edit(): void
    {
        $cacheKey = \App\Http\Controllers\EvacuationCenterController::CACHE_KEY;

        // Prime the cache by hitting the public endpoint.
        $this->getJson('/api/evacuation-centers')->assertStatus(200);
        $this->assertTrue(Cache::has($cacheKey), 'Cache should be set after list request');

        // Admin updates the center.
        Sanctum::actingAs($this->admin, [], 'admin');
        $this->putJson("/api/admin/evacuation-centers/{$this->centerA->id}", [
            'name'       => 'Updated Name',
            'barangay_id' => $this->barangay->id,
            'address'    => 'Updated Address',
            'latitude'   => 9.781,
            'longitude'  => 125.481,
            'capacity'   => 100,
            'is_active'  => true,
        ])->assertStatus(200);

        // Cache should now be gone.
        $this->assertFalse(Cache::has($cacheKey), 'Cache should be cleared after center edit');
    }

    // ── SQLite table bootstrap (identical to EvacuationLogTest) ──────────────

    private function createSqliteTable(string $table): void
    {
        match ($table) {
            'users' => Schema::create('users', function ($t) {
                $t->increments('id');
                $t->string('name');
                $t->string('email')->unique();
                $t->timestamp('email_verified_at')->nullable();
                $t->string('password');
                $t->rememberToken();
                $t->timestamps();
            }),
            'personal_access_tokens' => Schema::create('personal_access_tokens', function ($t) {
                $t->increments('id');
                $t->morphs('tokenable');
                $t->string('name');
                $t->string('token', 64)->unique();
                $t->text('abilities')->nullable();
                $t->timestamp('last_used_at')->nullable();
                $t->timestamp('expires_at')->nullable();
                $t->timestamps();
            }),
            'barangays' => Schema::create('barangays', function ($t) {
                $t->increments('id');
                $t->string('name', 100);
                $t->string('city', 100)->nullable();
                $t->decimal('latitude', 10, 8)->nullable();
                $t->decimal('longitude', 11, 8)->nullable();
                $t->string('risk_level', 20)->nullable();
                $t->timestamp('created_at')->nullable();
            }),
            'evacuation_centers_list' => Schema::create('evacuation_centers_list', function ($t) {
                $t->increments('id');
                $t->string('name', 150);
                $t->integer('barangay_id');
                $t->string('address', 255)->nullable();
                $t->decimal('latitude', 10, 8)->nullable();
                $t->decimal('longitude', 11, 8)->nullable();
                $t->integer('capacity')->default(0);
                $t->unsignedInteger('current_occupancy')->default(0);
                $t->boolean('is_active')->default(1);
                $t->timestamp('created_at')->nullable();
            }),
            'admins' => Schema::create('admins', function ($t) {
                $t->increments('id');
                $t->string('name');
                $t->string('username')->unique();
                $t->string('password');
                $t->timestamp('created_at')->nullable();
            }),
            'evacuation_logs' => Schema::create('evacuation_logs', function ($t) {
                $t->increments('id');
                $t->unsignedInteger('evacuation_center_id');
                $t->unsignedInteger('origin_barangay_id')->nullable();
                $t->string('type', 20);
                $t->unsignedInteger('headcount');
                $t->string('source', 20)->default('admin');
                $t->string('device_id', 255)->nullable();
                $t->unsignedInteger('recorded_by')->nullable();
                $t->timestamps();
            }),
            default => null,
        };
    }
}
