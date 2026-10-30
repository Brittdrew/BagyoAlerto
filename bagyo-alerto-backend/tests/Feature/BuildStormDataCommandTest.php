<?php

namespace Tests\Feature;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Tests\TestCase;

class BuildStormDataCommandTest extends TestCase
{
    private string $outputPath;

    protected function setUp(): void
    {
        parent::setUp();

        $this->outputPath = storage_path('framework/testing/storm-data-'.Str::uuid());
        config()->set('storm_points.output_path', $this->outputPath);
        config()->set('storm_points.request_delay_ms', 0);
        config()->set('storm_points.max_retries', 3);
        config()->set('storm_points.points', [
            ['name' => 'Washington', 'latitude' => 9.7843, 'longitude' => 125.4887, 'area_group' => 'mainland'],
            ['name' => 'General Luna (Siargao)', 'latitude' => 9.7844, 'longitude' => 126.1581, 'area_group' => 'siargao_bucas'],
        ]);
    }

    protected function tearDown(): void
    {
        if (is_dir($this->outputPath)) {
            $files = new \RecursiveIteratorIterator(
                new \RecursiveDirectoryIterator($this->outputPath, \FilesystemIterator::SKIP_DOTS),
                \RecursiveIteratorIterator::CHILD_FIRST,
            );
            foreach ($files as $file) {
                $file->isDir() ? rmdir($file->getPathname()) : unlink($file->getPathname());
            }
            rmdir($this->outputPath);
        }

        parent::tearDown();
    }

    public function test_command_builds_csvs_from_mocked_noaa_and_open_meteo_responses_and_retries_429(): void
    {
        $weatherAttempts = 0;
        Http::fake(function (Request $request) use (&$weatherAttempts) {
            if (str_contains($request->url(), 'ncei.noaa.gov')) {
                return Http::response($this->ibtracsCsv(), 200, ['Content-Type' => 'text/csv']);
            }

            $this->assertStringContainsString('archive-api.open-meteo.com', $request->url());
            $this->assertSame('era5', $request['models']);
            $this->assertSame('kmh', $request['wind_speed_unit']);
            $this->assertSame('mm', $request['precipitation_unit']);
            foreach (['wind_speed_10m', 'wind_gusts_10m', 'pressure_msl', 'precipitation', 'temperature_2m', 'relative_humidity_2m'] as $field) {
                $this->assertStringContainsString($field, $request['hourly']);
            }

            $weatherAttempts++;
            if ($weatherAttempts === 1) {
                throw new ConnectionException('simulated connection timeout');
            }
            if ($weatherAttempts === 2) {
                return Http::response(['reason' => 'rate limited'], 429, ['Retry-After' => '0']);
            }
            if ($weatherAttempts === 3) {
                return Http::response('temporary non-JSON response');
            }

            return Http::response([
                $this->weatherLocation(9.75, 125.5),
                $this->weatherLocation(9.75, 126.125),
            ]);
        });

        $this->artisan('data:build-storms')
            ->expectsOutputToContain('Wrote 1 storms and 6 hourly observation rows across 2 points.')
            ->assertExitCode(0);

        $this->assertSame(4, $weatherAttempts);
        $storms = $this->csvRows($this->outputPath.'/storms.csv');
        $this->assertCount(2, $storms);
        $this->assertSame('Agaton', $storms[1][1]);
        $this->assertSame('MEGI', $storms[1][2]);
        $this->assertSame('92.6', $storms[1][6]);
        $this->assertSame('USA_WIND', $storms[1][9]);
        $this->assertSame('1-minute sustained wind', $storms[1][10]);

        $observations = $this->csvRows($this->outputPath.'/observations.csv');
        $this->assertCount(7, $observations);
        $this->assertSame('Agaton / MEGI', $observations[1][0]);
        $this->assertSame('mainland', $observations[1][6]);
        $this->assertSame('siargao_bucas', $observations[4][6]);

        $signals = $this->csvRows($this->outputPath.'/signals.csv');
        $this->assertSame([['storm', 'area_group', 'signal', 'start_time', 'end_time']], $signals);

        $readme = file_get_contents($this->outputPath.'/README.md');
        $this->assertStringContainsString('ERA5 reanalysis, not station observations', $readme);
        $this->assertStringContainsString('wind and gust peaks are smoothed', $readme);
        $this->assertFileExists($this->outputPath.'/ibtracs.WP.list.v04r01.csv');

        // Laravel does not add a request that throws a ConnectionException to
        // its recorded-response list, so this is NOAA + 429 + bad JSON + success.
        Http::assertSentCount(4);

        $this->artisan('data:build-storms')->assertExitCode(0);
        $this->assertSame(4, $weatherAttempts, 'The second run should use both local caches.');
        Http::assertSentCount(4);
    }

    private function ibtracsCsv(): string
    {
        return implode("\n", [
            'SID,SEASON,NAME,ISO_TIME,LAT,LON,USA_WIND',
            ' ,Year, , ,degrees_north,degrees_east,kts',
            '2022099N11128,2022,MEGI,2022-04-09 18:00:00,12.0,130.0,40',
            '2022099N11128,2022,MEGI,2022-04-10 00:00:00,9.7833,125.4833,50',
            '2022100N20140,2022,MALAKAS,2022-04-10 00:00:00,20.0,140.0,80',
            '',
        ]);
    }

    /** @return array<string, mixed> */
    private function weatherLocation(float $latitude, float $longitude): array
    {
        return [
            'latitude' => $latitude,
            'longitude' => $longitude,
            'hourly' => [
                'time' => ['2022-04-08T00:00', '2022-04-10T00:00', '2022-04-11T00:00'],
                'wind_speed_10m' => [20, 30, 25],
                'wind_gusts_10m' => [30, 45, 35],
                'pressure_msl' => [1005, 995, 1000],
                'precipitation' => [1, 5, 2],
                'temperature_2m' => [27, 26, 27],
                'relative_humidity_2m' => [85, 92, 88],
            ],
        ];
    }

    /** @return array<int, array<int, string>> */
    private function csvRows(string $path): array
    {
        $handle = fopen($path, 'rb');
        $rows = [];
        while (($row = fgetcsv($handle, escape: '')) !== false) {
            $rows[] = $row;
        }
        fclose($handle);

        return $rows;
    }
}
