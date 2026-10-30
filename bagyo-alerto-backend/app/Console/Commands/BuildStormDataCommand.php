<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Http;
use RuntimeException;
use Throwable;

class BuildStormDataCommand extends Command
{
    protected $signature = 'data:build-storms
                            {--refresh : Redownload the cached IBTrACS Western Pacific CSV}';

    protected $description = 'Build historical storms, ERA5 observations, and an empty PAGASA signal template';

    private const IBTRACS_CACHE = 'ibtracs.WP.list.v04r01.csv';

    private const HOURLY_FIELDS = [
        'wind_speed_10m',
        'wind_gusts_10m',
        'pressure_msl',
        'precipitation',
        'temperature_2m',
        'relative_humidity_2m',
    ];

    private const STORM_COLUMNS = [
        'sid',
        'local_name',
        'international_name',
        'season',
        'closest_approach_km',
        'closest_approach_time_utc',
        'max_wind_kmh',
        'max_wind_kt',
        'wind_agency',
        'wind_column',
        'wind_averaging_period',
    ];

    private const OBSERVATION_COLUMNS = [
        'storm',
        'sid',
        'local_name',
        'international_name',
        'season',
        'point',
        'area_group',
        'latitude',
        'longitude',
        'grid_latitude',
        'grid_longitude',
        'time_utc',
        'wind_speed_10m_kmh',
        'wind_gusts_10m_kmh',
        'pressure_msl_hpa',
        'precipitation_mm',
        'temperature_2m_c',
        'relative_humidity_2m_pct',
    ];

    public function handle(): int
    {
        $outputPath = rtrim((string) config('storm_points.output_path'), '\\/');
        $temporaryObservations = null;

        try {
            $this->ensureDirectory($outputPath);

            $cachePath = $outputPath.DIRECTORY_SEPARATOR.self::IBTRACS_CACHE;
            $this->downloadIbtracs($cachePath, (bool) $this->option('refresh'));

            $storms = $this->nearbyStorms($cachePath);
            if ($storms === []) {
                throw new RuntimeException('IBTrACS contained no qualifying storms.');
            }

            $localNames = $this->localNameMap();
            foreach ($storms as &$storm) {
                $storm['local_name'] = $localNames[$storm['sid']] ?? '';
            }
            unset($storm);

            $this->writeStorms($outputPath.DIRECTORY_SEPARATOR.'storms.csv', $storms);
            $this->writeHeaderOnly(
                $outputPath.DIRECTORY_SEPARATOR.'signals.csv',
                ['storm', 'area_group', 'signal', 'start_time', 'end_time'],
            );

            $points = $this->validatedPoints();
            $temporaryObservations = tempnam($outputPath, 'observations-');
            if ($temporaryObservations === false) {
                throw new RuntimeException('Unable to create the temporary observations CSV.');
            }

            $observations = fopen($temporaryObservations, 'wb');
            if ($observations === false) {
                throw new RuntimeException('Unable to open the temporary observations CSV.');
            }

            $observationRows = 0;
            try {
                fputcsv($observations, self::OBSERVATION_COLUMNS, escape: '');

                foreach ($storms as $index => $storm) {
                    $locations = $this->fetchStormWeather($storm, $points);
                    $written = $this->writeObservationRows($observations, $storm, $points, $locations);
                    $observationRows += $written;
                    $displayName = $this->displayName($storm);
                    $this->line(sprintf(
                        '  [%d/%d] %s (%s): %d rows',
                        $index + 1,
                        count($storms),
                        $displayName,
                        $storm['season'],
                        $written,
                    ));
                }
            } finally {
                fclose($observations);
            }

            $this->replaceFile(
                $temporaryObservations,
                $outputPath.DIRECTORY_SEPARATOR.'observations.csv',
            );
            $temporaryObservations = null;

            $this->writeReadme($outputPath, count($storms), count($points), $observationRows);

            $this->newLine();
            $this->info(sprintf(
                'Wrote %d storms and %d hourly observation rows across %d points.',
                count($storms),
                $observationRows,
                count($points),
            ));
            $this->line("Output: {$outputPath}");

            return self::SUCCESS;
        } catch (Throwable $exception) {
            if (is_string($temporaryObservations) && is_file($temporaryObservations)) {
                @unlink($temporaryObservations);
            }

            $this->error($exception->getMessage());

            return self::FAILURE;
        }
    }

    private function downloadIbtracs(string $cachePath, bool $refresh): void
    {
        if (! $refresh && is_file($cachePath) && filesize($cachePath) > 0) {
            $this->line('Using cached IBTrACS CSV.');

            return;
        }

        $url = (string) config('storm_points.ibtracs_url');
        if ($url === '') {
            throw new RuntimeException('storm_points.ibtracs_url is not configured.');
        }

        $this->info('Downloading the IBTrACS Western Pacific CSV...');
        $maximumAttempts = max(1, (int) config('storm_points.max_retries', 5) + 1);

        for ($attempt = 1; $attempt <= $maximumAttempts; $attempt++) {
            $temporary = tempnam(dirname($cachePath), 'ibtracs-');
            if ($temporary === false) {
                throw new RuntimeException('Unable to create the temporary IBTrACS file.');
            }

            try {
                $response = Http::accept('text/csv')
                    ->connectTimeout(30)
                    ->timeout(600)
                    ->withOptions(['sink' => $temporary])
                    ->get($url);

                if ($response->status() === 429 && $attempt < $maximumAttempts) {
                    @unlink($temporary);
                    $this->sleepForRetry($response, $attempt);

                    continue;
                }

                $response->throw();
                if (filesize($temporary) === 0 && $response->body() !== '') {
                    file_put_contents($temporary, $response->body(), LOCK_EX);
                }
                if (filesize($temporary) === 0) {
                    throw new RuntimeException('NOAA returned an empty IBTrACS CSV.');
                }

                $this->replaceFile($temporary, $cachePath);

                return;
            } catch (Throwable $exception) {
                @unlink($temporary);
                if ($attempt >= $maximumAttempts) {
                    throw $exception;
                }

                $this->sleepForRetry(null, $attempt);
            }
        }
    }

    /** @return array<int, array<string, mixed>> */
    private function nearbyStorms(string $path): array
    {
        $handle = fopen($path, 'rb');
        if ($handle === false) {
            throw new RuntimeException('Unable to read the cached IBTrACS CSV.');
        }

        try {
            $header = fgetcsv($handle, escape: '');
            if (! is_array($header)) {
                throw new RuntimeException('IBTrACS CSV has no header.');
            }

            $indexes = array_flip($header);
            foreach (['SID', 'SEASON', 'NAME', 'ISO_TIME', 'LAT', 'LON', 'USA_WIND'] as $column) {
                if (! array_key_exists($column, $indexes)) {
                    throw new RuntimeException("IBTrACS CSV is missing {$column}.");
                }
            }

            // IBTrACS uses its second row for units.
            fgetcsv($handle, escape: '');

            $firstSeason = (int) config('storm_points.surigao_city.first_season', 2000);
            $cityLatitude = (float) config('storm_points.surigao_city.latitude', 9.7833);
            $cityLongitude = (float) config('storm_points.surigao_city.longitude', 125.4833);
            $maximumDistance = (float) config('storm_points.surigao_city.maximum_distance_km', 300);
            $storms = [];

            while (($row = fgetcsv($handle, escape: '')) !== false) {
                if (count($row) !== count($header)) {
                    continue;
                }

                $season = (int) trim((string) $row[$indexes['SEASON']]);
                if ($season < $firstSeason) {
                    continue;
                }

                $sid = trim((string) $row[$indexes['SID']]);
                if ($sid === '') {
                    continue;
                }

                if (! isset($storms[$sid])) {
                    $storms[$sid] = [
                        'sid' => $sid,
                        'local_name' => '',
                        'international_name' => $this->cleanStormName($row[$indexes['NAME']] ?? ''),
                        'season' => $season,
                        'closest_approach_km' => INF,
                        'closest_approach_time_utc' => '',
                        'max_wind_kt' => null,
                    ];
                }

                $name = $this->cleanStormName($row[$indexes['NAME']] ?? '');
                if ($name !== '' && $name !== 'UNNAMED') {
                    $storms[$sid]['international_name'] = $name;
                }

                $latitude = $this->numericValue($row[$indexes['LAT']] ?? null);
                $longitude = $this->numericValue($row[$indexes['LON']] ?? null);
                $isoTime = trim((string) ($row[$indexes['ISO_TIME']] ?? ''));
                if ($latitude !== null && $longitude !== null && $isoTime !== '') {
                    $distance = $this->haversineKm(
                        $cityLatitude,
                        $cityLongitude,
                        $latitude,
                        $longitude,
                    );
                    if ($distance < $storms[$sid]['closest_approach_km']) {
                        $storms[$sid]['closest_approach_km'] = $distance;
                        $storms[$sid]['closest_approach_time_utc'] = Carbon::parse($isoTime, 'UTC')
                            ->utc()
                            ->format('Y-m-d\TH:i:s\Z');
                    }
                }

                $wind = $this->numericValue($row[$indexes['USA_WIND']] ?? null);
                if ($wind !== null && ($storms[$sid]['max_wind_kt'] === null || $wind > $storms[$sid]['max_wind_kt'])) {
                    $storms[$sid]['max_wind_kt'] = $wind;
                }
            }
        } finally {
            fclose($handle);
        }

        $selected = array_values(array_filter(
            $storms,
            fn (array $storm): bool => $storm['closest_approach_km'] <= $maximumDistance,
        ));

        foreach ($selected as &$storm) {
            $storm['closest_approach_km'] = round($storm['closest_approach_km'], 1);
            $storm['max_wind_kmh'] = $storm['max_wind_kt'] === null
                ? null
                : round($storm['max_wind_kt'] * 1.852, 1);
        }
        unset($storm);

        usort($selected, fn (array $left, array $right): int => [
            $left['season'],
            $left['closest_approach_time_utc'],
            $left['sid'],
        ] <=> [
            $right['season'],
            $right['closest_approach_time_utc'],
            $right['sid'],
        ]);

        return $selected;
    }

    /** @return array<string, string> */
    private function localNameMap(): array
    {
        $manifestPath = database_path('data/surigao_pagasa_labels.json');
        if (! is_file($manifestPath)) {
            return [];
        }

        try {
            $manifest = json_decode(file_get_contents($manifestPath), true, flags: JSON_THROW_ON_ERROR);
        } catch (Throwable) {
            return [];
        }

        $map = [];
        foreach ($manifest['event_selection']['events'] ?? [] as $event) {
            $sid = trim((string) ($event['ibtracs_sid'] ?? ''));
            $localName = trim((string) ($event['local_name'] ?? ''));
            if ($sid !== '' && $localName !== '') {
                $map[$sid] = $localName;
            }
        }

        return $map;
    }

    /**
     * @param  array<string, mixed>  $storm
     * @param  array<int, array<string, mixed>>  $points
     * @return array<int, array<string, mixed>>
     */
    private function fetchStormWeather(array $storm, array $points): array
    {
        $closest = Carbon::parse($storm['closest_approach_time_utc'], 'UTC')->utc();
        $query = [
            'latitude' => implode(',', array_column($points, 'latitude')),
            'longitude' => implode(',', array_column($points, 'longitude')),
            'start_date' => $closest->copy()->subDays(2)->toDateString(),
            'end_date' => $closest->copy()->addDay()->toDateString(),
            'hourly' => implode(',', self::HOURLY_FIELDS),
            'wind_speed_unit' => 'kmh',
            'precipitation_unit' => 'mm',
            'timezone' => 'GMT',
            'models' => 'era5',
        ];

        $weatherCacheDirectory = rtrim((string) config('storm_points.output_path'), '\\/')
            .DIRECTORY_SEPARATOR.'weather-cache';
        $this->ensureDirectory($weatherCacheDirectory);
        $cacheKey = substr(hash('sha256', json_encode([
            $storm['sid'],
            $points,
            $query,
        ], JSON_THROW_ON_ERROR)), 0, 16);
        $weatherCachePath = $weatherCacheDirectory.DIRECTORY_SEPARATOR
            .$storm['sid'].'-'.$cacheKey.'.json';

        $response = $this->readJsonCache($weatherCachePath);
        if ($response === null) {
            $response = $this->weatherRequest($query);
            $temporaryCache = tempnam($weatherCacheDirectory, 'weather-');
            if ($temporaryCache === false) {
                throw new RuntimeException('Unable to create a temporary weather cache file.');
            }
            file_put_contents(
                $temporaryCache,
                json_encode($response, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR),
                LOCK_EX,
            );
            $this->replaceFile($temporaryCache, $weatherCachePath);
        }

        $locations = array_is_list($response) ? $response : [$response];
        if (count($locations) !== count($points)) {
            throw new RuntimeException(sprintf(
                'Open-Meteo returned %d locations for %d configured points.',
                count($locations),
                count($points),
            ));
        }

        foreach ($locations as $location) {
            if (! isset($location['hourly']['time']) || ! is_array($location['hourly']['time'])) {
                throw new RuntimeException('Open-Meteo response is missing hourly time data.');
            }
            foreach (self::HOURLY_FIELDS as $field) {
                if (! isset($location['hourly'][$field]) || ! is_array($location['hourly'][$field])) {
                    throw new RuntimeException("Open-Meteo response is missing {$field}.");
                }
            }
        }

        return $locations;
    }

    /** @param array<string, mixed> $query */
    private function weatherRequest(array $query): array
    {
        $url = (string) config('storm_points.archive_url');
        $maximumAttempts = max(1, (int) config('storm_points.max_retries', 5) + 1);

        for ($attempt = 1; $attempt <= $maximumAttempts; $attempt++) {
            try {
                $response = Http::acceptJson()
                    ->connectTimeout(60)
                    ->timeout(180)
                    ->get($url, $query);
            } catch (Throwable $exception) {
                if ($attempt >= $maximumAttempts) {
                    throw $exception;
                }

                $this->sleepForRetry(null, $attempt);

                continue;
            }

            if ($response->status() === 429 && $attempt < $maximumAttempts) {
                $this->sleepForRetry($response, $attempt);

                continue;
            }

            try {
                $response->throw();
                $json = $response->json();
                if (! is_array($json)) {
                    throw new RuntimeException('Open-Meteo returned invalid JSON.');
                }

                $this->sleepMilliseconds((int) config('storm_points.request_delay_ms', 350));

                return $json;
            } catch (Throwable $exception) {
                $isPermanentClientError = $response->status() >= 400 && $response->status() < 500;
                if ($attempt >= $maximumAttempts || $isPermanentClientError) {
                    throw $exception;
                }

                $this->sleepForRetry($response, $attempt);
            }
        }

        throw new RuntimeException('Open-Meteo retries were exhausted.');
    }

    /** @return null|array<int|string, mixed> */
    private function readJsonCache(string $path): ?array
    {
        if (! is_file($path) || filesize($path) === 0) {
            return null;
        }

        try {
            $contents = json_decode(file_get_contents($path), true, flags: JSON_THROW_ON_ERROR);

            return is_array($contents) ? $contents : null;
        } catch (Throwable) {
            return null;
        }
    }

    /**
     * @param  resource  $handle
     * @param  array<string, mixed>  $storm
     * @param  array<int, array<string, mixed>>  $points
     * @param  array<int, array<string, mixed>>  $locations
     */
    private function writeObservationRows($handle, array $storm, array $points, array $locations): int
    {
        $closest = Carbon::parse($storm['closest_approach_time_utc'], 'UTC')->utc();
        $windowStart = $closest->copy()->subDays(2);
        $windowEnd = $closest->copy()->addDay();
        $rows = 0;

        foreach ($points as $pointIndex => $point) {
            $location = $locations[$pointIndex];
            $hourly = $location['hourly'];

            foreach ($hourly['time'] as $hourIndex => $time) {
                $timestamp = Carbon::parse((string) $time, 'UTC')->utc();
                if ($timestamp->lt($windowStart) || $timestamp->gt($windowEnd)) {
                    continue;
                }

                $values = [];
                foreach (self::HOURLY_FIELDS as $field) {
                    $value = $hourly[$field][$hourIndex] ?? null;
                    if (! is_numeric($value)) {
                        throw new RuntimeException("Open-Meteo returned no numeric {$field} value.");
                    }
                    $values[$field] = (float) $value;
                }

                fputcsv($handle, [
                    $this->displayName($storm),
                    $storm['sid'],
                    $storm['local_name'],
                    $storm['international_name'],
                    $storm['season'],
                    $point['name'],
                    $point['area_group'],
                    $point['latitude'],
                    $point['longitude'],
                    $location['latitude'] ?? '',
                    $location['longitude'] ?? '',
                    $timestamp->format('Y-m-d\TH:i:s\Z'),
                    $values['wind_speed_10m'],
                    $values['wind_gusts_10m'],
                    $values['pressure_msl'],
                    $values['precipitation'],
                    $values['temperature_2m'],
                    $values['relative_humidity_2m'],
                ], escape: '');
                $rows++;
            }
        }

        return $rows;
    }

    /** @param array<int, array<string, mixed>> $storms */
    private function writeStorms(string $path, array $storms): void
    {
        $temporary = tempnam(dirname($path), 'storms-');
        if ($temporary === false) {
            throw new RuntimeException('Unable to create the temporary storms CSV.');
        }

        $handle = fopen($temporary, 'wb');
        if ($handle === false) {
            throw new RuntimeException('Unable to open the temporary storms CSV.');
        }

        try {
            fputcsv($handle, self::STORM_COLUMNS, escape: '');
            foreach ($storms as $storm) {
                fputcsv($handle, [
                    $storm['sid'],
                    $storm['local_name'],
                    $storm['international_name'],
                    $storm['season'],
                    $storm['closest_approach_km'],
                    $storm['closest_approach_time_utc'],
                    $storm['max_wind_kmh'] ?? '',
                    $storm['max_wind_kt'] ?? '',
                    'JTWC / USA',
                    'USA_WIND',
                    '1-minute sustained wind',
                ], escape: '');
            }
        } finally {
            fclose($handle);
        }

        $this->replaceFile($temporary, $path);
    }

    /** @param array<int, string> $header */
    private function writeHeaderOnly(string $path, array $header): void
    {
        $temporary = tempnam(dirname($path), 'signals-');
        if ($temporary === false) {
            throw new RuntimeException('Unable to create the temporary signals CSV.');
        }

        $handle = fopen($temporary, 'wb');
        if ($handle === false) {
            throw new RuntimeException('Unable to open the temporary signals CSV.');
        }
        fputcsv($handle, $header, escape: '');
        fclose($handle);

        $this->replaceFile($temporary, $path);
    }

    private function writeReadme(string $outputPath, int $stormCount, int $pointCount, int $observationRows): void
    {
        $contents = <<<MARKDOWN
# Surigao storm data

Generated by `php artisan data:build-storms`.

## Files

- `storms.csv`: {$stormCount} IBTrACS Western Pacific storms since 2000 whose track passed within 300 km of Surigao City.
- `observations.csv`: {$observationRows} hourly rows across {$pointCount} configured points, from 48 hours before through 24 hours after each closest approach.
- `signals.csv`: header-only template for manually transcribed PAGASA bulletin intervals. Signals are intentionally never inferred.
- `ibtracs.WP.list.v04r01.csv`: locally cached NOAA IBTrACS source file.

## Sources and limitations

Storm tracks come from NOAA IBTrACS v04r01. Maximum wind uses `USA_WIND`, the JTWC/USA one-minute sustained wind estimate in knots, converted to km/h with 1 kt = 1.852 km/h.

International names come from the IBTrACS `NAME` column. PAGASA local names are filled only when a verified SID mapping exists in `database/data/surigao_pagasa_labels.json`; otherwise `local_name` is blank rather than guessed.

Hourly weather comes from the Open-Meteo Historical Weather API with `models=era5`. This is ERA5 reanalysis, not station observations. It represents a model grid cell, so wind and gust peaks are smoothed and may be lower than short-lived measurements at a weather station. Precipitation is the preceding-hour sum; other included fields are hourly values supplied by Open-Meteo.

All timestamps are UTC. `signals.csv` must be completed from official PAGASA bulletins before it is used for signal-labelled analysis.
MARKDOWN;

        file_put_contents($outputPath.DIRECTORY_SEPARATOR.'README.md', $contents.PHP_EOL, LOCK_EX);
    }

    /** @return array<int, array{name: string, latitude: float, longitude: float, area_group: string}> */
    private function validatedPoints(): array
    {
        $points = config('storm_points.points', []);
        if (! is_array($points) || $points === []) {
            throw new RuntimeException('No storm observation points are configured.');
        }

        $validated = [];
        foreach ($points as $index => $point) {
            if (
                ! is_array($point)
                || trim((string) ($point['name'] ?? '')) === ''
                || ! is_numeric($point['latitude'] ?? null)
                || ! is_numeric($point['longitude'] ?? null)
                || ! in_array($point['area_group'] ?? null, ['mainland', 'siargao_bucas'], true)
            ) {
                throw new RuntimeException("Invalid storm point at index {$index}.");
            }

            $validated[] = [
                'name' => trim((string) $point['name']),
                'latitude' => (float) $point['latitude'],
                'longitude' => (float) $point['longitude'],
                'area_group' => (string) $point['area_group'],
            ];
        }

        return $validated;
    }

    private function displayName(array $storm): string
    {
        if ($storm['local_name'] !== '' && $storm['international_name'] !== '') {
            return $storm['local_name'].' / '.$storm['international_name'];
        }

        return $storm['local_name'] ?: ($storm['international_name'] ?: $storm['sid']);
    }

    private function cleanStormName(mixed $value): string
    {
        return strtoupper(trim((string) $value));
    }

    private function numericValue(mixed $value): ?float
    {
        $value = trim((string) $value);

        return $value !== '' && is_numeric($value) ? (float) $value : null;
    }

    private function haversineKm(float $lat1, float $lon1, float $lat2, float $lon2): float
    {
        $earthRadiusKm = 6371.0088;
        $latitudeDelta = deg2rad($lat2 - $lat1);
        $longitudeDelta = deg2rad($lon2 - $lon1);
        $a = sin($latitudeDelta / 2) ** 2
            + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($longitudeDelta / 2) ** 2;

        return $earthRadiusKm * 2 * atan2(sqrt($a), sqrt(1 - $a));
    }

    private function sleepForRetry(?Response $response, int $attempt): void
    {
        $retryAfterSeconds = $response?->header('Retry-After');
        $milliseconds = is_numeric($retryAfterSeconds)
            ? (int) $retryAfterSeconds * 1000
            : min(30_000, 500 * (2 ** max(0, $attempt - 1)));

        $this->sleepMilliseconds($milliseconds);
    }

    private function sleepMilliseconds(int $milliseconds): void
    {
        if ($milliseconds > 0) {
            usleep($milliseconds * 1000);
        }
    }

    private function ensureDirectory(string $path): void
    {
        if ($path === '') {
            throw new RuntimeException('storm_points.output_path is not configured.');
        }
        if (! is_dir($path) && ! mkdir($path, 0755, true) && ! is_dir($path)) {
            throw new RuntimeException("Unable to create output directory {$path}.");
        }
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
