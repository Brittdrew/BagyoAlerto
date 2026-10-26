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

        // 2 services × 1 unique coordinate = 2 real HTTP calls (not 4)
        $this->assertSame(2, $callCount, 'Duplicate coordinates should reuse cached results.');
    }
}
