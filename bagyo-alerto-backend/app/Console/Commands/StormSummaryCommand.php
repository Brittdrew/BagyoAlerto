<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use RuntimeException;
use Throwable;

class StormSummaryCommand extends Command
{
    protected $signature = 'data:storm-summary
                            {--directory= : Directory containing storms.csv and observations.csv}';

    protected $description = 'Summarize storm proximity and ERA5 peaks by mainland and Siargao/Bucas Grande';

    private const AREA_GROUPS = ['mainland', 'siargao_bucas'];

    private const CSV_COLUMNS = [
        'rank',
        'rank_score',
        'storm',
        'sid',
        'season',
        'local_name',
        'international_name',
        'area_group',
        'closest_approach_km',
        'closest_approach_time_utc',
        'ibtracs_max_wind_kmh',
        'ibtracs_wind_column',
        'era5_peak_wind_speed_10m_kmh',
        'era5_peak_wind_gusts_10m_kmh',
        'era5_lowest_pressure_msl_hpa',
        'era5_peak_hourly_precipitation_mm',
        'era5_peak_wind_time_utc',
        'equivalent_pagasa_wind_bracket',
    ];

    public function handle(): int
    {
        $directory = rtrim(
            (string) ($this->option('directory') ?: storage_path('app/storm-data')),
            '\\/',
        );

        try {
            $storms = $this->readStorms($directory.DIRECTORY_SEPARATOR.'storms.csv');
            $summaries = $this->summarizeObservations(
                $directory.DIRECTORY_SEPARATOR.'observations.csv',
                $storms,
            );
            $this->rank($summaries);

            $csvPath = $directory.DIRECTORY_SEPARATOR.'storm-summary.csv';
            $markdownPath = $directory.DIRECTORY_SEPARATOR.'storm-summary.md';
            $this->writeCsv($csvPath, $summaries);
            $this->writeMarkdown($markdownPath, $summaries);

            $this->info(sprintf(
                'Wrote %d storm-area summaries from %d storms.',
                count($summaries),
                count($storms),
            ));
            $this->line("CSV: {$csvPath}");
            $this->line("Markdown: {$markdownPath}");

            return self::SUCCESS;
        } catch (Throwable $exception) {
            $this->error($exception->getMessage());

            return self::FAILURE;
        }
    }

    /** @return array<string, array<string, mixed>> */
    private function readStorms(string $path): array
    {
        $required = [
            'sid',
            'local_name',
            'international_name',
            'season',
            'closest_approach_km',
            'closest_approach_time_utc',
            'max_wind_kmh',
            'wind_column',
        ];
        $storms = [];

        $this->readCsv($path, $required, function (array $row) use (&$storms): void {
            $sid = trim($row['sid']);
            if ($sid === '') {
                throw new RuntimeException('storms.csv contains a blank SID.');
            }
            if (isset($storms[$sid])) {
                throw new RuntimeException("storms.csv contains duplicate SID {$sid}.");
            }

            $closestDistance = $this->requiredNumber($row, 'closest_approach_km', 'storms.csv');
            $storms[$sid] = [
                'sid' => $sid,
                'local_name' => trim($row['local_name']),
                'international_name' => trim($row['international_name']),
                'season' => (int) $this->requiredNumber($row, 'season', 'storms.csv'),
                'closest_approach_km' => $closestDistance,
                'closest_approach_time_utc' => trim($row['closest_approach_time_utc']),
                'ibtracs_max_wind_kmh' => $this->optionalNumber($row['max_wind_kmh']),
                'ibtracs_wind_column' => trim($row['wind_column']),
            ];
        });

        if ($storms === []) {
            throw new RuntimeException('storms.csv contains no storm rows.');
        }

        return $storms;
    }

    /**
     * @param  array<string, array<string, mixed>>  $storms
     * @return array<int, array<string, mixed>>
     */
    private function summarizeObservations(string $path, array $storms): array
    {
        $required = [
            'sid',
            'storm',
            'area_group',
            'time_utc',
            'wind_speed_10m_kmh',
            'wind_gusts_10m_kmh',
            'pressure_msl_hpa',
            'precipitation_mm',
        ];
        $groups = [];

        foreach ($storms as $sid => $storm) {
            foreach (self::AREA_GROUPS as $areaGroup) {
                $key = $sid.'|'.$areaGroup;
                $groups[$key] = [
                    ...$storm,
                    'storm' => $this->displayName($storm),
                    'area_group' => $areaGroup,
                    'era5_peak_wind_speed_10m_kmh' => null,
                    'era5_peak_wind_gusts_10m_kmh' => null,
                    'era5_lowest_pressure_msl_hpa' => null,
                    'era5_peak_hourly_precipitation_mm' => null,
                    'era5_peak_wind_time_utc' => '',
                ];
            }
        }

        $this->readCsv($path, $required, function (array $row) use (&$groups, $storms): void {
            $sid = trim($row['sid']);
            if (! isset($storms[$sid])) {
                throw new RuntimeException("observations.csv references unknown SID {$sid}.");
            }

            $areaGroup = trim($row['area_group']);
            if (! in_array($areaGroup, self::AREA_GROUPS, true)) {
                throw new RuntimeException("observations.csv contains unsupported area_group {$areaGroup}.");
            }

            $key = $sid.'|'.$areaGroup;
            $wind = $this->requiredNumber($row, 'wind_speed_10m_kmh', 'observations.csv');
            $gust = $this->requiredNumber($row, 'wind_gusts_10m_kmh', 'observations.csv');
            $pressure = $this->requiredNumber($row, 'pressure_msl_hpa', 'observations.csv');
            $precipitation = $this->requiredNumber($row, 'precipitation_mm', 'observations.csv');
            $time = trim($row['time_utc']);

            $currentWind = $groups[$key]['era5_peak_wind_speed_10m_kmh'];
            $currentTime = $groups[$key]['era5_peak_wind_time_utc'];
            if (
                $currentWind === null
                || $wind > $currentWind
                || ($wind === $currentWind && ($currentTime === '' || $time < $currentTime))
            ) {
                $groups[$key]['era5_peak_wind_speed_10m_kmh'] = $wind;
                $groups[$key]['era5_peak_wind_time_utc'] = $time;
            }

            $groups[$key]['era5_peak_wind_gusts_10m_kmh'] = $this->maximum(
                $groups[$key]['era5_peak_wind_gusts_10m_kmh'],
                $gust,
            );
            $groups[$key]['era5_lowest_pressure_msl_hpa'] = $this->minimum(
                $groups[$key]['era5_lowest_pressure_msl_hpa'],
                $pressure,
            );
            $groups[$key]['era5_peak_hourly_precipitation_mm'] = $this->maximum(
                $groups[$key]['era5_peak_hourly_precipitation_mm'],
                $precipitation,
            );
        });

        foreach ($groups as $key => &$group) {
            if ($group['era5_peak_wind_speed_10m_kmh'] === null) {
                throw new RuntimeException("No observations found for {$key}.");
            }

            $group['equivalent_pagasa_wind_bracket'] = $this->windBracket(
                $group['era5_peak_wind_speed_10m_kmh'],
            );
            $group['rank_score'] = $this->rankScore(
                $group['closest_approach_km'],
                $group['era5_peak_wind_speed_10m_kmh'],
            );
        }
        unset($group);

        return array_values($groups);
    }

    /** @param array<int, array<string, mixed>> $summaries */
    private function rank(array &$summaries): void
    {
        usort($summaries, function (array $left, array $right): int {
            return $right['rank_score'] <=> $left['rank_score']
                ?: $right['era5_peak_wind_speed_10m_kmh'] <=> $left['era5_peak_wind_speed_10m_kmh']
                ?: $left['closest_approach_km'] <=> $right['closest_approach_km']
                ?: [$left['season'], $left['storm'], $left['sid'], $left['area_group']]
                    <=> [$right['season'], $right['storm'], $right['sid'], $right['area_group']];
        });

        foreach ($summaries as $index => &$summary) {
            $summary['rank'] = $index + 1;
        }
        unset($summary);
    }

    /** @param array<int, array<string, mixed>> $summaries */
    private function writeCsv(string $path, array $summaries): void
    {
        $temporary = $this->temporaryFile(dirname($path), 'storm-summary-');
        $handle = fopen($temporary, 'wb');
        if ($handle === false) {
            throw new RuntimeException('Unable to open the temporary summary CSV.');
        }

        try {
            fputcsv($handle, self::CSV_COLUMNS, escape: '');
            foreach ($summaries as $summary) {
                fputcsv($handle, array_map(
                    fn (string $column): mixed => $summary[$column] ?? '',
                    self::CSV_COLUMNS,
                ), escape: '');
            }
        } finally {
            fclose($handle);
        }

        $this->replaceFile($temporary, $path);
    }

    /** @param array<int, array<string, mixed>> $summaries */
    private function writeMarkdown(string $path, array $summaries): void
    {
        $lines = [
            '# Storm Summary',
            '',
            'One row per storm and area group, calculated from `storms.csv` and `observations.csv`.',
            '',
            'The rank score is **65% ERA5 wind intensity + 35% proximity**:',
            '',
            '- Wind component: `min(ERA5 peak wind / 185 km/h, 1) × 100`',
            '- Proximity component: `max(300 km − closest approach, 0) / 300 km × 100`',
            '',
            'Equivalent PAGASA brackets are comparisons to the requested wind thresholds, not official PAGASA signals.',
            '',
            '| Rank | Score | Storm | Season | Area | Closest km | Closest time | IBTrACS max km/h | ERA5 peak wind | ERA5 peak gust | Lowest pressure | Peak hourly rain | Peak wind hour | Wind bracket |',
            '|---:|---:|---|---:|---|---:|---|---:|---:|---:|---:|---:|---|---|',
        ];

        foreach ($summaries as $summary) {
            $lines[] = sprintf(
                '| %d | %.2f | %s | %d | %s | %.1f | %s | %s | %.1f | %.1f | %.1f | %.1f | %s | %s |',
                $summary['rank'],
                $summary['rank_score'],
                $this->escapeMarkdown($summary['storm']),
                $summary['season'],
                $summary['area_group'],
                $summary['closest_approach_km'],
                $summary['closest_approach_time_utc'],
                $summary['ibtracs_max_wind_kmh'] === null
                    ? 'N/A'
                    : number_format($summary['ibtracs_max_wind_kmh'], 1, '.', ''),
                $summary['era5_peak_wind_speed_10m_kmh'],
                $summary['era5_peak_wind_gusts_10m_kmh'],
                $summary['era5_lowest_pressure_msl_hpa'],
                $summary['era5_peak_hourly_precipitation_mm'],
                $summary['era5_peak_wind_time_utc'],
                $summary['equivalent_pagasa_wind_bracket'],
            );
        }

        $temporary = $this->temporaryFile(dirname($path), 'storm-summary-');
        file_put_contents($temporary, implode(PHP_EOL, $lines).PHP_EOL, LOCK_EX);
        $this->replaceFile($temporary, $path);
    }

    private function rankScore(float $closestApproachKm, float $peakWindKmh): float
    {
        $windComponent = min(max($peakWindKmh / 185, 0), 1) * 100;
        $proximityComponent = min(max((300 - $closestApproachKm) / 300, 0), 1) * 100;

        return round(($windComponent * 0.65) + ($proximityComponent * 0.35), 2);
    }

    private function windBracket(float $windKmh): string
    {
        return match (true) {
            $windKmh < 39 => 'None',
            $windKmh <= 61 => 'Signal 1',
            $windKmh <= 88 => 'Signal 2',
            $windKmh <= 117 => 'Signal 3',
            $windKmh <= 184 => 'Signal 4',
            default => 'Signal 5',
        };
    }

    private function displayName(array $storm): string
    {
        if ($storm['local_name'] !== '' && $storm['international_name'] !== '') {
            return $storm['local_name'].' / '.$storm['international_name'];
        }

        return $storm['local_name'] ?: ($storm['international_name'] ?: $storm['sid']);
    }

    private function maximum(?float $current, float $candidate): float
    {
        return $current === null ? $candidate : max($current, $candidate);
    }

    private function minimum(?float $current, float $candidate): float
    {
        return $current === null ? $candidate : min($current, $candidate);
    }

    private function requiredNumber(array $row, string $column, string $source): float
    {
        $value = $row[$column] ?? null;
        if ($value === null || trim((string) $value) === '' || ! is_numeric($value)) {
            throw new RuntimeException("{$source} contains a non-numeric {$column} value.");
        }

        return (float) $value;
    }

    private function optionalNumber(mixed $value): ?float
    {
        $value = trim((string) $value);

        return $value !== '' && is_numeric($value) ? (float) $value : null;
    }

    /** @param array<int, string> $requiredColumns */
    private function readCsv(string $path, array $requiredColumns, callable $consume): void
    {
        if (! is_file($path)) {
            throw new RuntimeException("Required input file not found: {$path}");
        }

        $handle = fopen($path, 'rb');
        if ($handle === false) {
            throw new RuntimeException("Unable to read {$path}.");
        }

        try {
            $header = fgetcsv($handle, escape: '');
            if (! is_array($header)) {
                throw new RuntimeException("{$path} has no CSV header.");
            }
            foreach ($requiredColumns as $column) {
                if (! in_array($column, $header, true)) {
                    throw new RuntimeException("{$path} is missing required column {$column}.");
                }
            }

            while (($values = fgetcsv($handle, escape: '')) !== false) {
                if (count($values) !== count($header)) {
                    throw new RuntimeException("{$path} contains a malformed CSV row.");
                }
                $consume(array_combine($header, $values));
            }
        } finally {
            fclose($handle);
        }
    }

    private function escapeMarkdown(string $value): string
    {
        return str_replace('|', '\\|', $value);
    }

    private function temporaryFile(string $directory, string $prefix): string
    {
        if (! is_dir($directory)) {
            throw new RuntimeException("Summary directory does not exist: {$directory}");
        }

        $path = tempnam($directory, $prefix);
        if ($path === false) {
            throw new RuntimeException('Unable to create a temporary summary file.');
        }

        return $path;
    }

    private function replaceFile(string $source, string $destination): void
    {
        if (is_file($destination) && ! @unlink($destination)) {
            throw new RuntimeException("Unable to replace {$destination}.");
        }
        if (! @rename($source, $destination)) {
            if (! @copy($source, $destination)) {
                throw new RuntimeException("Unable to write {$destination}.");
            }
            @unlink($source);
        }
    }
}
