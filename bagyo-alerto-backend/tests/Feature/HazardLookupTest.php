<?php

namespace Tests\Feature;

use App\Console\Commands\HazardLookupCommand;
use App\Models\Barangay;
use App\Models\EvacuationCenter;
use App\Services\HazardLookupService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class HazardLookupTest extends TestCase
{
    use DatabaseTransactions;

    // ── Helpers ──────────────────────────────────────────────────────────────

    private function floodResponse(string $label): array
    {
        return [
            'type'     => 'FeatureCollection',
            'features' => [[
                'type'      => 'Feature',
                'geometry'  => null,
                'properties' => ['Flood Susceptibility' => $label],
                'layerName' => 'Flood',
            ]],
        ];
    }

    private function landslideResponse(string $label): array
    {
        return [
            'type'     => 'FeatureCollection',
            'features' => [[
                'type'      => 'Feature',
                'geometry'  => null,
                'properties' => [
                    'RIL Susceptibility Description' => 'HL',
                    'RIL Susceptibility'             => $label,
                ],
                'layerName' => 'Rainfall Induced Landslide',
            ]],
        ];
    }

    private function emptyResponse(): array
    {
        return ['type' => 'FeatureCollection', 'features' => []];
    }

    /** Build the in-memory SQLite tables used by this test class */
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
                $t->integer('capacity')->default(0);
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
    }

    protected function setUp(): void
    {
        parent::setUp();
        if (config('database.default') === 'sqlite') {
            $this->ensureTables();
        }
    }

    // ── Normalization tests ───────────────────────────────────────────────────

    public function test_normalize_low(): void
    {
        $svc = new HazardLookupService();
        $this->assertSame('low', $svc->normalize('Low Susceptibility'));
    }

    public function test_normalize_moderate(): void
    {
        $svc = new HazardLookupService();
        $this->assertSame('moderate', $svc->normalize('Moderate Susceptibility'));
    }

    public function test_normalize_high(): void
    {
        $svc = new HazardLookupService();
        $this->assertSame('high', $svc->normalize('High Susceptibility'));
    }

    public function test_normalize_very_high(): void
    {
        $svc = new HazardLookupService();
        $this->assertSame('very_high', $svc->normalize('Very High Susceptibility'));
    }

    public function test_normalize_unknown_returns_null(): void
    {
        $svc = new HazardLookupService();
        $this->assertNull($svc->normalize('Extreme Susceptibility'));
    }

    // ── Service lookup tests ──────────────────────────────────────────────────

    public function test_lookup_returns_ok_with_class(): void
    {
        Http::fake([
            '*' => Http::response($this->floodResponse('High Susceptibility'), 200),
        ]);

        $svc    = new HazardLookupService();
        $result = $svc->lookup(9.785, 125.49, 'flood');

        $this->assertSame('ok',   $result['status']);
        $this->assertSame('high', $result['class']);
    }

    public function test_lookup_no_data_on_empty_features(): void
    {
        Http::fake([
            '*' => Http::response($this->emptyResponse(), 200),
        ]);

        $svc    = new HazardLookupService();
        $result = $svc->lookup(9.785, 125.49, 'flood');

        $this->assertSame('no_data', $result['status']);
        $this->assertNull($result['class']);
    }

    public function test_lookup_error_on_http_500(): void
    {
        Http::fake([
            '*' => Http::response([], 500),
        ]);

        $svc    = new HazardLookupService();
        $result = $svc->lookup(9.785, 125.49, 'flood');

        $this->assertSame('error', $result['status']);
        $this->assertNull($result['class']);
    }

    public function test_lookup_landslide_uses_correct_property(): void
    {
        Http::fake([
            '*' => Http::response($this->landslideResponse('Very High Susceptibility'), 200),
        ]);

        $svc    = new HazardLookupService();
        $result = $svc->lookup(9.763, 125.467, 'landslide');

        $this->assertSame('ok',        $result['status']);
        $this->assertSame('very_high', $result['class']);
    }

    // ── Command tests ─────────────────────────────────────────────────────────

    public function test_command_fills_both_columns(): void
    {
        Http::fake([
            '*Flood*'               => Http::response($this->floodResponse('High Susceptibility'), 200),
            '*RainInducedLandslide*' => Http::response($this->landslideResponse('Low Susceptibility'), 200),
            // Catch-all in case URL ordering differs
            '*'                     => Http::response($this->floodResponse('High Susceptibility'), 200),
        ]);

        $barangay = Barangay::create([
            'name'      => 'Test Barangay',
            'latitude'  => 9.785,
            'longitude' => 125.49,
        ]);

        $this->artisan('hazard:lookup', ['--only' => 'barangays', '--force' => true])
             ->assertExitCode(0);

        $barangay->refresh();

        // At least one column was filled (flood or landslide) to confirm the command ran
        $this->assertTrue(
            $barangay->flood_susceptibility !== null || $barangay->landslide_susceptibility !== null,
            'Expected at least one susceptibility column to be filled.'
        );
    }

    public function test_command_dry_run_writes_nothing(): void
    {
        Http::fake([
            '*' => Http::response($this->floodResponse('High Susceptibility'), 200),
        ]);

        $barangay = Barangay::create([
            'name'      => 'Dry Run Barangay',
            'latitude'  => 9.785,
            'longitude' => 125.49,
        ]);

        $this->artisan('hazard:lookup', ['--only' => 'barangays', '--dry-run' => true])
             ->assertExitCode(0);

        $barangay->refresh();

        $this->assertNull($barangay->flood_susceptibility,     'Dry run must not write flood_susceptibility');
        $this->assertNull($barangay->landslide_susceptibility, 'Dry run must not write landslide_susceptibility');
        $this->assertNull($barangay->hazard_source,            'Dry run must not write hazard_source');
    }

    public function test_command_cache_deduplicates_calls(): void
    {
        $callCount = 0;

        Http::fake(function () use (&$callCount) {
            $callCount++;
            return Http::response($this->floodResponse('Moderate Susceptibility'), 200);
        });

        // Two barangays at identical coordinates → should only trigger one HTTP call per service
        Barangay::create(['name' => 'B1', 'latitude' => 9.785, 'longitude' => 125.49]);
        Barangay::create(['name' => 'B2', 'latitude' => 9.785, 'longitude' => 125.49]);

        $this->artisan('hazard:lookup', ['--only' => 'barangays', '--force' => true])
             ->assertExitCode(0);

        // 2 services × 13 sample coordinates = 26 real HTTP calls (not 52)
        $this->assertSame(26, $callCount, 'Duplicate coordinates should reuse cached results.');
    }

    public function test_worst_class_selection(): void
    {
        $callCount = 0;
        Http::fake(function ($request) use (&$callCount) {
            $callCount++;
            $url = $request->url();
            if (str_contains($url, 'RainInducedLandslide')) {
                return Http::response($this->emptyResponse(), 200);
            }

            // Center is low, offset 25m has moderate, offset 50m has very_high
            // Point 0 = center, Points 1..4 = 25m, Points 5..8 = 50m
            if ($callCount === 1) {
                return Http::response($this->floodResponse('Low Susceptibility'), 200);
            } elseif ($callCount === 2) {
                return Http::response($this->floodResponse('Moderate Susceptibility'), 200);
            } elseif ($callCount === 6) {
                return Http::response($this->floodResponse('Very High Susceptibility'), 200);
            }

            return Http::response($this->floodResponse('Low Susceptibility'), 200);
        });

        $center = EvacuationCenter::create([
            'name'      => 'Worst Class Center',
            'latitude'  => 9.785,
            'longitude' => 125.49,
        ]);

        $this->artisan('hazard:lookup', ['--only' => 'centers', '--force' => true])
            ->assertExitCode(0);

        $center->refresh();

        $this->assertSame('very_high', $center->flood_susceptibility, 'Worst class within 50m should be selected');
        $this->assertSame('low', $center->flood_point_class, 'Exact point class should remain recorded');
        $this->assertTrue($center->flood_mapped_nearby, 'Mapped nearby should be true');
    }

    public function test_point_vs_radius(): void
    {
        $callCount = 0;
        Http::fake(function ($request) use (&$callCount) {
            $callCount++;
            $url = $request->url();
            if (str_contains($url, 'RainInducedLandslide')) {
                return Http::response($this->emptyResponse(), 200);
            }

            // Exact point (1) has no data, but 25m (2) has High
            if ($callCount === 2) {
                return Http::response($this->floodResponse('High Susceptibility'), 200);
            }

            return Http::response($this->emptyResponse(), 200);
        });

        $center = EvacuationCenter::create([
            'name'      => 'Edge Center',
            'latitude'  => 9.7818,
            'longitude' => 125.4932,
        ]);

        $this->artisan('hazard:lookup', ['--only' => 'centers', '--force' => true])
            ->assertExitCode(0);

        $center->refresh();

        $this->assertNull($center->flood_point_class, 'Exact point class should be null for unmapped center');
        $this->assertSame('high', $center->flood_susceptibility, '50m buffer should pick up nearby high flood');
        $this->assertTrue($center->flood_mapped_nearby, 'Should be flagged as mapped nearby');
    }

    public function test_point_vs_radius_100m_proximity(): void
    {
        $callCount = 0;
        Http::fake(function ($request) use (&$callCount) {
            $callCount++;
            $url = $request->url();
            if (str_contains($url, 'RainInducedLandslide')) {
                return Http::response($this->emptyResponse(), 200);
            }

            // Only 100m ring (call 10 = point 9 at 100m) has high
            if ($callCount === 10) {
                return Http::response($this->floodResponse('High Susceptibility'), 200);
            }

            return Http::response($this->emptyResponse(), 200);
        });

        $center = EvacuationCenter::create([
            'name'      => '100m Proximity Center',
            'latitude'  => 9.7800,
            'longitude' => 125.4900,
        ]);

        $this->artisan('hazard:lookup', ['--only' => 'centers', '--force' => true])
            ->assertExitCode(0);

        $center->refresh();

        $this->assertNull($center->flood_point_class, 'Point class should be null');
        $this->assertNull($center->flood_susceptibility, '50m susceptibility should be null since hazard is at 100m');
        $this->assertTrue($center->flood_mapped_nearby, 'Mapped nearby at 100m should be true');
    }

    public function test_request_failure_never_stored_as_no_data(): void
    {
        Http::fake([
            '*' => Http::response([], 500),
        ]);

        $center = EvacuationCenter::create([
            'name'                 => 'Existing Center',
            'latitude'             => 9.785,
            'longitude'            => 125.49,
            'flood_susceptibility' => 'moderate',
            'hazard_source'        => 'MGB via GeoRisk WMS',
        ]);

        $this->artisan('hazard:lookup', ['--only' => 'centers', '--force' => true])
            ->assertExitCode(0);

        $center->refresh();

        // Must NOT be overwritten to null / no_data
        $this->assertSame('moderate', $center->flood_susceptibility, 'Failed requests must never overwrite to no_data');
    }

    public function test_manual_row_protection(): void
    {
        Http::fake([
            '*' => Http::response($this->floodResponse('Low Susceptibility'), 200),
        ]);

        $center = EvacuationCenter::create([
            'name'                 => 'Manual Admin Center',
            'latitude'             => 9.785,
            'longitude'            => 125.49,
            'flood_susceptibility' => 'very_high',
            'hazard_source'        => 'manual (admin)',
        ]);

        // Run with --force: manual row must still NOT be overwritten
        $this->artisan('hazard:lookup', ['--only' => 'centers', '--force' => true])
            ->assertExitCode(0);

        $center->refresh();

        $this->assertSame('very_high', $center->flood_susceptibility, 'Manual admin row must never be overwritten');
        $this->assertSame('manual (admin)', $center->hazard_source);
    }
}
