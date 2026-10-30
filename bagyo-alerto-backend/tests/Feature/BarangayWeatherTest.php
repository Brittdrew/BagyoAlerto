<?php

namespace Tests\Feature;

use App\Models\Barangay;
use App\Models\TyphoonLog;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class BarangayWeatherTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();

        if (! Schema::hasTable('barangays')) {
            Schema::create('barangays', function ($table) {
                $table->increments('id');
                $table->string('name');
                $table->string('city')->nullable();
                $table->decimal('latitude', 10, 8);
                $table->decimal('longitude', 11, 8);
                $table->string('risk_level')->nullable();
            });
        }

        if (! Schema::hasTable('typhoon_logs')) {
            Schema::create('typhoon_logs', function ($table) {
                $table->increments('id');
                $table->decimal('wind_speed', 5, 2)->nullable();
                $table->decimal('rainfall', 5, 2)->nullable();
                $table->decimal('pressure', 6, 2)->nullable();
                $table->string('severity_level')->nullable();
                $table->timestamp('logged_at')->useCurrent();
            });
        }
    }

    public function test_weather_endpoint_is_read_only_and_uses_the_barangay_cache(): void
    {
        Cache::flush();
        $barangay = Barangay::create([
            'name' => 'Sabang',
            'city' => 'Surigao City',
            'latitude' => 9.7833,
            'longitude' => 125.4833,
            'risk_level' => 'low',
        ]);

        Http::fake([
            'api.open-meteo.com/*' => Http::response([
                'current' => [
                    'time' => '2026-10-30T10:00',
                    'wind_speed_10m' => 18.5,
                    'precipitation' => 2.4,
                    'surface_pressure' => 1008.2,
                    'temperature_2m' => 29.1,
                    'relative_humidity_2m' => 84,
                    'wind_gusts_10m' => 31.7,
                ],
                'hourly' => [
                    'time' => [
                        '2026-10-30T05:00', '2026-10-30T06:00', '2026-10-30T07:00',
                        '2026-10-30T08:00', '2026-10-30T09:00', '2026-10-30T10:00',
                    ],
                    'wind_speed_10m' => [10, 11, 12, 13, 14, 15],
                    'temperature_2m' => [26, 26.5, 27, 28, 28.5, 29.1],
                ],
            ], 200),
        ]);

        $first = $this->getJson("/api/barangays/{$barangay->id}/weather");
        $second = $this->getJson("/api/barangays/{$barangay->id}/weather");

        $first->assertOk()
            ->assertJsonPath('barangay_id', $barangay->id)
            ->assertJsonPath('current.wind_speed', 18.5)
            ->assertJsonPath('current.wind_gusts', 31.7)
            ->assertJsonCount(6, 'trend');
        $second->assertOk()->assertExactJson($first->json());

        Http::assertSentCount(1);
        $this->assertSame(0, TyphoonLog::query()->count());
    }
}
