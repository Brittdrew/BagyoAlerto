<?php

namespace App\Services;

use App\Models\Barangay;
use Illuminate\Support\Facades\Http;
use RuntimeException;

class OpenMeteoWeatherService
{
    private const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

    /**
     * Fetch the current readings and the six most recent hourly trend points
     * in one Open-Meteo request. This service only reads weather data.
     *
     * @return array<string, mixed>
     */
    public function forBarangay(Barangay $barangay): array
    {
        if (! is_numeric($barangay->latitude) || ! is_numeric($barangay->longitude)) {
            throw new RuntimeException('The barangay has no usable weather coordinates.');
        }

        $data = Http::acceptJson()
            ->timeout(10)
            ->get(self::FORECAST_URL, [
                'latitude' => (float) $barangay->latitude,
                'longitude' => (float) $barangay->longitude,
                'current' => implode(',', [
                    'wind_speed_10m',
                    'precipitation',
                    'surface_pressure',
                    'temperature_2m',
                    'relative_humidity_2m',
                    'wind_gusts_10m',
                ]),
                'hourly' => 'wind_speed_10m,temperature_2m',
                'forecast_days' => 1,
                'wind_speed_unit' => 'kmh',
                'precipitation_unit' => 'mm',
                'timezone' => 'Asia/Manila',
            ])
            ->throw()
            ->json();

        $current = $data['current'] ?? null;
        $hourly = $data['hourly'] ?? null;
        if (! is_array($current) || ! is_array($hourly) || ! isset($hourly['time'])) {
            throw new RuntimeException('Open-Meteo returned incomplete weather data.');
        }

        return [
            'barangay_id' => (int) $barangay->id,
            'updated_at' => now('Asia/Manila')->toIso8601String(),
            'current' => [
                'wind_speed' => $this->numeric($current, 'wind_speed_10m'),
                'rainfall' => $this->numeric($current, 'precipitation'),
                'pressure' => $this->numeric($current, 'surface_pressure'),
                'temperature' => $this->numeric($current, 'temperature_2m'),
                'humidity' => $this->numeric($current, 'relative_humidity_2m'),
                'wind_gusts' => $this->numeric($current, 'wind_gusts_10m'),
            ],
            'trend' => $this->trend($hourly, (string) ($current['time'] ?? '')),
        ];
    }

    /** @param array<string, mixed> $values */
    private function numeric(array $values, string $key): float
    {
        $value = $values[$key] ?? null;
        if (! is_numeric($value)) {
            throw new RuntimeException("Open-Meteo returned no numeric {$key} value.");
        }

        return (float) $value;
    }

    /**
     * @param  array<string, mixed>  $hourly
     * @return array<int, array{time: string, wind: float, temp: float}>
     */
    private function trend(array $hourly, string $currentTime): array
    {
        $times = $hourly['time'] ?? [];
        $winds = $hourly['wind_speed_10m'] ?? [];
        $temperatures = $hourly['temperature_2m'] ?? [];
        if (! is_array($times) || $times === []) {
            throw new RuntimeException('Open-Meteo returned no hourly trend data.');
        }

        $currentIndex = array_search($currentTime, $times, true);
        if ($currentIndex === false) {
            $currentIndex = count($times) - 1;
            foreach ($times as $index => $time) {
                if ($currentTime !== '' && $time > $currentTime) {
                    $currentIndex = max(0, $index - 1);
                    break;
                }
            }
        }

        $points = [];
        for ($index = max(0, $currentIndex - 5); $index <= $currentIndex; $index++) {
            if (! isset($times[$index]) || ! is_numeric($winds[$index] ?? null) || ! is_numeric($temperatures[$index] ?? null)) {
                continue;
            }

            $points[] = [
                'time' => (string) $times[$index],
                'wind' => round((float) $winds[$index], 1),
                'temp' => round((float) $temperatures[$index], 1),
            ];
        }

        return $points;
    }
}
