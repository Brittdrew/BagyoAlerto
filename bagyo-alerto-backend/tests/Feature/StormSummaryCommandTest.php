<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Tests\TestCase;

class StormSummaryCommandTest extends TestCase
{
    private string $directory;

    protected function setUp(): void
    {
        parent::setUp();

        $this->directory = storage_path('framework/testing/storm-summary-'.Str::uuid());
        mkdir($this->directory, 0755, true);
    }

    protected function tearDown(): void
    {
        if (is_dir($this->directory)) {
            foreach (glob($this->directory.'/*') ?: [] as $file) {
                unlink($file);
            }
            rmdir($this->directory);
        }

        parent::tearDown();
    }

    public function test_command_writes_ranked_offline_summaries_without_touching_signals(): void
    {
        $this->writeCsv('storms.csv', [
            ['sid', 'local_name', 'international_name', 'season', 'closest_approach_km', 'closest_approach_time_utc', 'max_wind_kmh', 'max_wind_kt', 'wind_agency', 'wind_column', 'wind_averaging_period'],
            ['2021346N05145', '', 'RAI', '2021', '50', '2021-12-16T00:00:00Z', '240.8', '130', 'JTWC / USA', 'USA_WIND', '1-minute sustained wind'],
            ['2025305N08140', 'Tino', 'KALMAEGI', '2025', '100', '2025-11-04T00:00:00Z', '203.7', '110', 'JTWC / USA', 'USA_WIND', '1-minute sustained wind'],
        ]);
        $this->writeCsv('observations.csv', [
            ['storm', 'sid', 'local_name', 'international_name', 'season', 'point', 'area_group', 'latitude', 'longitude', 'grid_latitude', 'grid_longitude', 'time_utc', 'wind_speed_10m_kmh', 'wind_gusts_10m_kmh', 'pressure_msl_hpa', 'precipitation_mm', 'temperature_2m_c', 'relative_humidity_2m_pct'],
            ['RAI', '2021346N05145', '', 'RAI', '2021', 'Washington', 'mainland', '9.7', '125.5', '9.75', '125.5', '2021-12-15T09:00:00Z', '110', '140', '960', '12', '27', '90'],
            ['RAI', '2021346N05145', '', 'RAI', '2021', 'Mabua', 'mainland', '9.8', '125.4', '9.75', '125.5', '2021-12-15T10:00:00Z', '120', '150', '950', '20', '26', '92'],
            ['RAI', '2021346N05145', '', 'RAI', '2021', 'General Luna', 'siargao_bucas', '9.7', '126.1', '9.75', '126.1', '2021-12-15T08:00:00Z', '90', '130', '955', '18', '26', '91'],
            ['Tino / KALMAEGI', '2025305N08140', 'Tino', 'KALMAEGI', '2025', 'Washington', 'mainland', '9.7', '125.5', '9.75', '125.5', '2025-11-03T10:00:00Z', '80', '110', '975', '10', '27', '88'],
            ['Tino / KALMAEGI', '2025305N08140', 'Tino', 'KALMAEGI', '2025', 'General Luna', 'siargao_bucas', '9.7', '126.1', '9.75', '126.1', '2025-11-03T09:00:00Z', '100', '125', '965', '14', '26', '90'],
        ]);
        file_put_contents(
            $this->directory.'/signals.csv',
            "storm,area_group,signal,start_time,end_time\nRAI,mainland,4,start,end\n",
        );
        $signalsHash = hash_file('sha256', $this->directory.'/signals.csv');

        Http::preventStrayRequests();
        $queryCount = 0;
        DB::listen(function () use (&$queryCount): void {
            $queryCount++;
        });

        $this->artisan('data:storm-summary', ['--directory' => $this->directory])
            ->expectsOutputToContain('Wrote 4 storm-area summaries from 2 storms.')
            ->assertExitCode(0);

        $this->assertSame(0, $queryCount);
        $this->assertSame($signalsHash, hash_file('sha256', $this->directory.'/signals.csv'));

        $rows = $this->readAssociativeCsv($this->directory.'/storm-summary.csv');
        $this->assertCount(4, $rows);
        $this->assertSame('RAI', $rows[0]['storm']);
        $this->assertSame('mainland', $rows[0]['area_group']);
        $this->assertSame('71.33', $rows[0]['rank_score']);
        $this->assertSame('120', $rows[0]['era5_peak_wind_speed_10m_kmh']);
        $this->assertSame('150', $rows[0]['era5_peak_wind_gusts_10m_kmh']);
        $this->assertSame('950', $rows[0]['era5_lowest_pressure_msl_hpa']);
        $this->assertSame('20', $rows[0]['era5_peak_hourly_precipitation_mm']);
        $this->assertSame('2021-12-15T10:00:00Z', $rows[0]['era5_peak_wind_time_utc']);
        $this->assertSame('Signal 4', $rows[0]['equivalent_pagasa_wind_bracket']);

        $tinoMainland = collect($rows)->first(
            fn (array $row): bool => $row['local_name'] === 'Tino' && $row['area_group'] === 'mainland',
        );
        $this->assertNotNull($tinoMainland);
        $this->assertSame('KALMAEGI', $tinoMainland['international_name']);
        $this->assertSame('Signal 2', $tinoMainland['equivalent_pagasa_wind_bracket']);

        $markdown = file_get_contents($this->directory.'/storm-summary.md');
        $this->assertStringContainsString('65% ERA5 wind intensity + 35% proximity', $markdown);
        $this->assertStringContainsString('Equivalent PAGASA brackets', $markdown);
        $this->assertStringContainsString('| 1 | 71.33 | RAI |', $markdown);
    }

    /** @param array<int, array<int, string>> $rows */
    private function writeCsv(string $filename, array $rows): void
    {
        $handle = fopen($this->directory.'/'.$filename, 'wb');
        foreach ($rows as $row) {
            fputcsv($handle, $row, escape: '');
        }
        fclose($handle);
    }

    /** @return array<int, array<string, string>> */
    private function readAssociativeCsv(string $path): array
    {
        $handle = fopen($path, 'rb');
        $header = fgetcsv($handle, escape: '');
        $rows = [];
        while (($values = fgetcsv($handle, escape: '')) !== false) {
            $rows[] = array_combine($header, $values);
        }
        fclose($handle);

        return $rows;
    }
}
