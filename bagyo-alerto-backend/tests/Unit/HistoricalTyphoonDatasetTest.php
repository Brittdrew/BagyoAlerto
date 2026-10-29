<?php

namespace Tests\Unit;

use App\Models\Barangay;
use App\Services\HistoricalTyphoonDataset;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use RuntimeException;
use Tests\TestCase;

class HistoricalTyphoonDatasetTest extends TestCase
{
    /** @var list<string> */
    private array $tempFiles = [];

    protected function setUp(): void
    {
        parent::setUp();

        if (! Schema::hasTable('barangays')) {
            Schema::create('barangays', function (Blueprint $table): void {
                $table->increments('id');
                $table->string('name');
                $table->string('city')->nullable();
                $table->decimal('latitude', 10, 7)->nullable();
                $table->decimal('longitude', 11, 7)->nullable();
            });
        }

        Barangay::query()->delete();
    }

    protected function tearDown(): void
    {
        foreach ($this->tempFiles as $file) {
            if (is_file($file)) {
                unlink($file);
            }
        }

        parent::tearDown();
    }

    public function test_build_uses_only_current_surigao_city_barangays(): void
    {
        Barangay::create([
            'name' => 'Washington',
            'city' => 'Surigao City',
            'latitude' => 9.7843,
            'longitude' => 125.4887,
        ]);
        Barangay::create([
            'name' => 'Lipata',
            'city' => 'Surigao City',
            'latitude' => 9.8128,
            'longitude' => 125.4553,
        ]);
        Barangay::create([
            'name' => 'Outside Scope',
            'city' => 'Butuan City',
            'latitude' => 8.9475,
            'longitude' => 125.5406,
        ]);

        Http::fake([
            'archive-api.open-meteo.com/*' => Http::response([
                $this->weatherLocation(9.73, 125.49, 20.0),
                $this->weatherLocation(9.73, 125.41, 22.0),
            ]),
        ]);

        $service = new HistoricalTyphoonDataset($this->manifestPath(), $this->tempPath('history.csv'));
        $summary = $service->build();
        $records = $service->records(deduplicateGrid: false);

        $this->assertSame(2, $summary['barangays']);
        $this->assertSame(2, $summary['rows']);
        $this->assertSame(['Lipata', 'Washington'], collect($records)->pluck('barangay_name')->sort()->values()->all());
        $this->assertSame(['Signal 1'], array_values(array_unique(array_column($records, 'label'))));

        Http::assertSent(function ($request): bool {
            return str_starts_with($request->url(), 'https://archive-api.open-meteo.com/v1/archive?')
                && $request['models'] === 'ecmwf_ifs'
                && substr_count($request['latitude'], ',') === 1;
        });
    }

    public function test_records_can_remove_duplicate_weather_grid_cells(): void
    {
        Barangay::create([
            'name' => 'One',
            'city' => 'Surigao City',
            'latitude' => 9.78,
            'longitude' => 125.48,
        ]);
        Barangay::create([
            'name' => 'Two',
            'city' => 'Surigao City',
            'latitude' => 9.79,
            'longitude' => 125.49,
        ]);

        Http::fake([
            'archive-api.open-meteo.com/*' => Http::response([
                $this->weatherLocation(9.73, 125.49, 20.0),
                $this->weatherLocation(9.73, 125.49, 20.0),
            ]),
        ]);

        $service = new HistoricalTyphoonDataset($this->manifestPath(), $this->tempPath('history.csv'));
        $service->build();

        $this->assertCount(2, $service->records(deduplicateGrid: false));
        $this->assertCount(1, $service->records(deduplicateGrid: true));
    }

    public function test_records_rejects_a_missing_dataset(): void
    {
        $service = new HistoricalTyphoonDataset($this->manifestPath(), $this->tempPath('missing.csv'));

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('Run `php artisan ml:build-history`');

        $service->records();
    }

    /** @return array<string, mixed> */
    private function weatherLocation(float $latitude, float $longitude, float $wind): array
    {
        return [
            'latitude' => $latitude,
            'longitude' => $longitude,
            'hourly' => [
                'time' => ['2024-05-24T03:00'],
                'temperature_2m' => [27.0],
                'relative_humidity_2m' => [90],
                'precipitation' => [3.5],
                'surface_pressure' => [1002.0],
                'wind_speed_10m' => [$wind],
            ],
        ];
    }

    private function manifestPath(): string
    {
        $path = $this->tempPath('manifest.json');
        file_put_contents($path, json_encode([
            'schema_version' => 1,
            'bulletins' => [[
                'event_id' => 'pagasa-24-TC01',
                'storm_name' => 'Aghon',
                'bulletin_number' => 1,
                'issued_at' => '2024-05-24T03:00:00Z',
                'expires_at' => '2024-05-24T06:00:00Z',
                'signal' => 1,
                'resolution' => 'province-whole',
                'source_url' => 'https://example.test/bulletin.pdf',
                'source_sha256' => str_repeat('a', 64),
            ]],
        ], JSON_THROW_ON_ERROR));

        return $path;
    }

    private function tempPath(string $name): string
    {
        $path = sys_get_temp_dir().DIRECTORY_SEPARATOR.bin2hex(random_bytes(8)).'-'.$name;
        $this->tempFiles[] = $path;

        return $path;
    }
}
