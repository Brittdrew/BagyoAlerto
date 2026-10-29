<?php

namespace App\Services;

use App\Models\Barangay;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Http;
use RuntimeException;

class HistoricalTyphoonDataset
{
    public const WEATHER_SOURCE = 'Open-Meteo ECMWF IFS';

    private const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';

    private const COLUMNS = [
        'event_id',
        'storm_name',
        'bulletin_number',
        'issued_at',
        'barangay_id',
        'barangay_name',
        'latitude',
        'longitude',
        'grid_latitude',
        'grid_longitude',
        'wind_kmh',
        'rainfall_mm',
        'pressure_hpa',
        'temperature_c',
        'humidity_pct',
        'label',
        'signal',
        'label_resolution',
        'label_source_url',
        'label_source_sha256',
        'weather_source',
    ];

    public function __construct(
        private ?string $manifestPath = null,
        private ?string $datasetPath = null,
    ) {
        $this->manifestPath ??= database_path('data/surigao_pagasa_labels.json');
        $this->datasetPath ??= database_path('data/surigao_typhoon_history.csv');
    }

    /**
     * Build the historical dataset for every Surigao City barangay currently
     * stored in the database.
     *
     * @return array{barangays: int, bulletins: int, rows: int, events: int, labels: array<string, int>, path: string}
     */
    public function build(?callable $progress = null): array
    {
        $manifest = $this->readManifest();
        $barangays = Barangay::query()
            ->whereRaw('LOWER(city) = ?', ['surigao city'])
            ->whereNotNull('latitude')
            ->whereNotNull('longitude')
            ->orderBy('id')
            ->get(['id', 'name', 'latitude', 'longitude']);

        if ($barangays->isEmpty()) {
            throw new RuntimeException('No Surigao City barangays with coordinates were found.');
        }

        $bulletins = collect($manifest['bulletins']);
        $rows = [];

        foreach ($bulletins->groupBy('event_id') as $eventId => $eventBulletins) {
            $weather = $this->fetchEventWeather($barangays, $eventBulletins);

            foreach ($eventBulletins as $bulletin) {
                $issuedAt = Carbon::parse($bulletin['issued_at'])->utc();
                $weatherKey = $issuedAt->format('Y-m-d\TH:00');

                foreach ($barangays as $index => $barangay) {
                    $location = $weather[$index] ?? null;
                    if ($location === null) {
                        throw new RuntimeException("Open-Meteo omitted barangay index {$index} for {$eventId}.");
                    }

                    $hourIndex = $location['time_index'][$weatherKey] ?? null;
                    if ($hourIndex === null) {
                        throw new RuntimeException("Open-Meteo omitted {$weatherKey} for {$eventId} / {$barangay->name}.");
                    }

                    $hourly = $location['hourly'];
                    $rows[] = [
                        $bulletin['event_id'],
                        $bulletin['storm_name'],
                        $bulletin['bulletin_number'],
                        $issuedAt->toIso8601ZuluString(),
                        $barangay->id,
                        $barangay->name,
                        (float) $barangay->latitude,
                        (float) $barangay->longitude,
                        (float) $location['latitude'],
                        (float) $location['longitude'],
                        $this->hourlyValue($hourly, 'wind_speed_10m', $hourIndex),
                        $this->hourlyValue($hourly, 'precipitation', $hourIndex),
                        $this->hourlyValue($hourly, 'surface_pressure', $hourIndex),
                        $this->hourlyValue($hourly, 'temperature_2m', $hourIndex),
                        $this->hourlyValue($hourly, 'relative_humidity_2m', $hourIndex),
                        $this->labelForSignal((int) $bulletin['signal']),
                        (int) $bulletin['signal'],
                        $bulletin['resolution'],
                        $bulletin['source_url'],
                        $bulletin['source_sha256'],
                        self::WEATHER_SOURCE,
                    ];
                }
            }

            if ($progress !== null) {
                $progress((string) $eventId, $eventBulletins->count(), $barangays->count());
            }
        }

        $this->writeCsv($rows);

        $labels = array_count_values(array_column($rows, 15));
        ksort($labels);

        return [
            'barangays' => $barangays->count(),
            'bulletins' => $bulletins->count(),
            'rows' => count($rows),
            'events' => $bulletins->pluck('event_id')->unique()->count(),
            'labels' => $labels,
            'path' => $this->datasetPath,
        ];
    }

    /**
     * Read dataset records. Duplicate Open-Meteo grid cells are removed by
     * default so nearby barangays mapped to one ECMWF grid cell do not
     * artificially overweight that observation during model training.
     *
     * @return array<int, array<string, string>>
     */
    public function records(bool $deduplicateGrid = true): array
    {
        if (! is_file($this->datasetPath)) {
            throw new RuntimeException(
                "Historical dataset not found at {$this->datasetPath}. Run `php artisan ml:build-history`."
            );
        }

        $handle = fopen($this->datasetPath, 'rb');
        if ($handle === false) {
            throw new RuntimeException("Unable to open historical dataset at {$this->datasetPath}.");
        }

        try {
            $header = fgetcsv($handle, escape: '');
            if ($header !== self::COLUMNS) {
                throw new RuntimeException('Historical dataset columns do not match the expected schema.');
            }

            $records = [];
            $seen = [];
            while (($values = fgetcsv($handle, escape: '')) !== false) {
                if (count($values) !== count($header)) {
                    throw new RuntimeException('Historical dataset contains a malformed CSV row.');
                }

                $record = array_combine($header, $values);
                if ($deduplicateGrid) {
                    $key = implode('|', [
                        $record['event_id'],
                        $record['issued_at'],
                        $record['grid_latitude'],
                        $record['grid_longitude'],
                    ]);
                    if (isset($seen[$key])) {
                        continue;
                    }
                    $seen[$key] = true;
                }

                $records[] = $record;
            }

            return $records;
        } finally {
            fclose($handle);
        }
    }

    public function path(): string
    {
        return $this->datasetPath;
    }

    public function fingerprint(): string
    {
        if (! is_file($this->datasetPath)) {
            throw new RuntimeException("Historical dataset not found at {$this->datasetPath}.");
        }

        return hash_file('sha256', $this->datasetPath);
    }

    /** @return array<string, mixed> */
    private function readManifest(): array
    {
        if (! is_file($this->manifestPath)) {
            throw new RuntimeException("PAGASA label manifest not found at {$this->manifestPath}.");
        }

        $manifest = json_decode(file_get_contents($this->manifestPath), true, flags: JSON_THROW_ON_ERROR);
        if (($manifest['schema_version'] ?? null) !== 1 || empty($manifest['bulletins'])) {
            throw new RuntimeException('PAGASA label manifest has an unsupported or empty schema.');
        }

        return $manifest;
    }

    /**
     * @param  Collection<int, Barangay>  $barangays
     * @param  Collection<int, array<string, mixed>>  $bulletins
     * @return array<int, array<string, mixed>>
     */
    private function fetchEventWeather(Collection $barangays, Collection $bulletins): array
    {
        $dates = $bulletins
            ->map(fn (array $bulletin) => Carbon::parse($bulletin['issued_at'])->utc());

        $response = $this->httpClient()->get(self::ARCHIVE_URL, [
            'latitude' => $barangays->pluck('latitude')->implode(','),
            'longitude' => $barangays->pluck('longitude')->implode(','),
            'start_date' => $dates->min()->toDateString(),
            'end_date' => $dates->max()->toDateString(),
            'hourly' => implode(',', [
                'temperature_2m',
                'relative_humidity_2m',
                'precipitation',
                'surface_pressure',
                'wind_speed_10m',
            ]),
            'wind_speed_unit' => 'kmh',
            'timezone' => 'GMT',
            'models' => 'ecmwf_ifs',
        ])->throw()->json();

        $locations = array_is_list($response) ? $response : [$response];
        if (count($locations) !== $barangays->count()) {
            throw new RuntimeException('Open-Meteo returned an unexpected number of locations.');
        }

        return array_map(function (array $location): array {
            if (! isset($location['hourly']['time'])) {
                throw new RuntimeException('Open-Meteo response is missing hourly weather data.');
            }

            $location['time_index'] = array_flip($location['hourly']['time']);

            return $location;
        }, $locations);
    }

    private function httpClient(): PendingRequest
    {
        return Http::acceptJson()
            ->timeout(90)
            ->retry(3, 750, throw: false);
    }

    /** @param array<string, mixed> $hourly */
    private function hourlyValue(array $hourly, string $field, int $index): float
    {
        $value = $hourly[$field][$index] ?? null;
        if (! is_numeric($value)) {
            throw new RuntimeException("Open-Meteo returned no numeric {$field} value.");
        }

        return (float) $value;
    }

    private function labelForSignal(int $signal): string
    {
        return match ($signal) {
            0 => 'Normal',
            1, 2, 3, 4, 5 => "Signal {$signal}",
            default => throw new RuntimeException("Unsupported PAGASA signal {$signal}."),
        };
    }

    /** @param array<int, array<int, mixed>> $rows */
    private function writeCsv(array $rows): void
    {
        $directory = dirname($this->datasetPath);
        if (! is_dir($directory) && ! mkdir($directory, 0755, true) && ! is_dir($directory)) {
            throw new RuntimeException("Unable to create dataset directory {$directory}.");
        }

        $temporary = tempnam($directory, 'typhoon-history-');
        if ($temporary === false) {
            throw new RuntimeException('Unable to create a temporary historical dataset file.');
        }

        $handle = fopen($temporary, 'wb');
        if ($handle === false) {
            throw new RuntimeException('Unable to write the temporary historical dataset.');
        }

        try {
            fputcsv($handle, self::COLUMNS, escape: '');
            foreach ($rows as $row) {
                fputcsv($handle, $row, escape: '');
            }
        } finally {
            fclose($handle);
        }

        if (! copy($temporary, $this->datasetPath)) {
            @unlink($temporary);
            throw new RuntimeException("Unable to write historical dataset to {$this->datasetPath}.");
        }
        @unlink($temporary);
    }
}
