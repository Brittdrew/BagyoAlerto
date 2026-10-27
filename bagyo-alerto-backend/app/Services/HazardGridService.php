<?php

namespace App\Services;

use RuntimeException;

class HazardGridService
{
    private static ?array $meta = null;
    private static ?string $floodGrid = null;
    private static ?string $landslideGrid = null;
    private static bool $loaded = false;

    public const CLASS_NAMES = [
        0 => 'none',
        1 => 'low',
        2 => 'moderate',
        3 => 'high',
        4 => 'very_high',
    ];

    public const CLASS_VALUES = [
        'none'      => 0,
        'low'       => 1,
        'moderate'  => 2,
        'high'      => 3,
        'very_high' => 4,
    ];

    /**
     * Check if grid files exist or fixture is loaded.
     */
    public function isGridAvailable(?string $customDir = null): bool
    {
        if (self::$loaded && self::$meta !== null && self::$floodGrid !== null && self::$landslideGrid !== null) {
            return true;
        }

        $dir = $customDir ?? config('hazard.grid.storage_path', storage_path('app/hazard-grid'));
        return file_exists("{$dir}/meta.json")
            && file_exists("{$dir}/flood.bin")
            && file_exists("{$dir}/landslide.bin");
    }

    /**
     * Load the grid into memory if not already loaded.
     */
    public function loadGrid(?string $customDir = null): void
    {
        if (self::$loaded && self::$meta !== null) {
            return;
        }

        $dir = $customDir ?? config('hazard.grid.storage_path', storage_path('app/hazard-grid'));

        $metaFile = "{$dir}/meta.json";
        $floodFile = "{$dir}/flood.bin";
        $landslideFile = "{$dir}/landslide.bin";

        if (! file_exists($metaFile) || ! file_exists($floodFile) || ! file_exists($landslideFile)) {
            throw new RuntimeException("Hazard grid files not found in [{$dir}]. Run `php artisan hazard:grid` first.");
        }

        $rawMeta = file_get_contents($metaFile);
        $meta = json_decode($rawMeta, true);
        if (! is_array($meta)) {
            throw new RuntimeException("Invalid meta.json in [{$dir}].");
        }

        $flood = file_get_contents($floodFile);
        $landslide = file_get_contents($landslideFile);

        if ($flood === false || $landslide === false) {
            throw new RuntimeException("Failed to read binary grid files in [{$dir}].");
        }

        self::$meta = $meta;
        self::$floodGrid = $flood;
        self::$landslideGrid = $landslide;
        self::$loaded = true;
    }

    /**
     * Inject a synthetic fixture grid for unit tests.
     */
    public function setFixtureGrid(array $meta, string $floodGrid, string $landslideGrid): void
    {
        self::$meta = $meta;
        self::$floodGrid = $floodGrid;
        self::$landslideGrid = $landslideGrid;
        self::$loaded = true;
    }

    /**
     * Reset in-memory cached grid.
     */
    public static function reset(): void
    {
        self::$meta = null;
        self::$floodGrid = null;
        self::$landslideGrid = null;
        self::$loaded = false;
    }

    /**
     * Lookup hazard levels at a given coordinate.
     *
     * @return array{0: int, 1: int, flood: int, landslide: int} [flood, landslide] with named and indexed keys
     */
    public function lookup(float $lat, float $lng): array
    {
        $this->ensureLoaded();

        $bbox = self::$meta['bbox'] ?? [];
        $minLat = (float) ($bbox['min_lat'] ?? 0);
        $maxLat = (float) ($bbox['max_lat'] ?? 0);
        $minLng = (float) ($bbox['min_lng'] ?? 0);
        $maxLng = (float) ($bbox['max_lng'] ?? 0);

        $width = (int) (self::$meta['width'] ?? 0);
        $height = (int) (self::$meta['height'] ?? 0);

        if ($width <= 0 || $height <= 0) {
            return [0, 0, 'flood' => 0, 'landslide' => 0];
        }

        // Outside bounding box counts as 0
        if ($lat < $minLat || $lat > $maxLat || $lng < $minLng || $lng > $maxLng) {
            return [0, 0, 'flood' => 0, 'landslide' => 0];
        }

        $lngSpan = $maxLng - $minLng;
        $latSpan = $maxLat - $minLat;

        if ($lngSpan <= 0 || $latSpan <= 0) {
            return [0, 0, 'flood' => 0, 'landslide' => 0];
        }

        $col = (int) floor((($lng - $minLng) / $lngSpan) * $width);
        $row = (int) floor((($maxLat - $lat) / $latSpan) * $height);

        $col = max(0, min($width - 1, $col));
        $row = max(0, min($height - 1, $row));

        $offset = ($row * $width) + $col;

        $floodVal = isset(self::$floodGrid[$offset]) ? ord(self::$floodGrid[$offset]) : 0;
        $landslideVal = isset(self::$landslideGrid[$offset]) ? ord(self::$landslideGrid[$offset]) : 0;

        return [
            0           => $floodVal,
            1           => $landslideVal,
            'flood'     => $floodVal,
            'landslide' => $landslideVal,
        ];
    }

    /**
     * Score a route polyline:
     * - Densify to <= 25 m steps
     * - Sample flood & landslide per step
     * - Compute length_m, exposure_index, meters_by_class, and run-length segments
     *
     * @param  array<int, array<int, float>|array{lat: float, lng: float}>  $coords
     * @return array{
     *     length_m: float,
     *     exposure_index: float,
     *     meters_by_class: array{flood: array, landslide: array, worst: array},
     *     segments: array<int, array{0: int, 1: int, 2: int}>
     * }
     */
    public function scoreRoute(array $coords): array
    {
        $this->ensureLoaded();

        $weights = config('hazard.weights', [
            'none' => 0, 'low' => 0, 'moderate' => 1, 'high' => 3, 'very_high' => 5,
            0 => 0, 1 => 0, 2 => 1, 3 => 3, 4 => 5,
        ]);

        $defaultClassMap = [
            'none'      => 0.0,
            'low'       => 0.0,
            'moderate'  => 0.0,
            'high'      => 0.0,
            'very_high' => 0.0,
        ];

        $metersFlood = [0 => 0.0, 1 => 0.0, 2 => 0.0, 3 => 0.0, 4 => 0.0];
        $metersLandslide = [0 => 0.0, 1 => 0.0, 2 => 0.0, 3 => 0.0, 4 => 0.0];
        $metersWorst = [0 => 0.0, 1 => 0.0, 2 => 0.0, 3 => 0.0, 4 => 0.0];

        $totalLengthM = 0.0;
        $totalExposure = 0.0;
        $segments = [];

        $n = count($coords);

        if ($n < 2) {
            $pointClass = 0;
            if ($n === 1) {
                [$lat, $lng] = $this->extractCoord($coords[0]);
                $sample = $this->lookup($lat, $lng);
                $pointClass = max($sample[0], $sample[1]);
                $segments = [[0, 0, $pointClass]];
            }

            return [
                'length_m'        => 0.0,
                'exposure_index'  => 0.0,
                'meters_by_class' => [
                    'flood'     => $defaultClassMap,
                    'landslide' => $defaultClassMap,
                    'worst'     => $defaultClassMap,
                ],
                'segments'        => $segments,
            ];
        }

        $edgeWorstClasses = [];

        for ($i = 0; $i < $n - 1; $i++) {
            [$lat1, $lng1] = $this->extractCoord($coords[$i]);
            [$lat2, $lng2] = $this->extractCoord($coords[$i + 1]);

            $d = $this->haversineDistance($lat1, $lng1, $lat2, $lng2);

            if ($d <= 0.0001) {
                $sample = $this->lookup($lat1, $lng1);
                $f = $sample[0];
                $l = $sample[1];
                $w = max($f, $l);
                $edgeWorstClasses[] = $w;
                continue;
            }

            // Densify to <= 25 m steps
            $k = max(1, (int) ceil($d / 25.0));
            $stepD = $d / $k;
            $edgeWorst = 0;

            for ($s = 1; $s <= $k; $s++) {
                $t = ($s - 0.5) / $k; // Midpoint of step
                $sampleLat = $lat1 + $t * ($lat2 - $lat1);
                $sampleLng = $lng1 + $t * ($lng2 - $lng1);

                $sample = $this->lookup($sampleLat, $sampleLng);
                $f = $sample[0];
                $l = $sample[1];
                $w = max($f, $l);

                if ($w > $edgeWorst) {
                    $edgeWorst = $w;
                }

                $metersFlood[$f] += $stepD;
                $metersLandslide[$l] += $stepD;
                $metersWorst[$w] += $stepD;

                $weight = $weights[$w] ?? 0;
                $totalExposure += ($stepD * $weight);
                $totalLengthM += $stepD;
            }

            $edgeWorstClasses[] = $edgeWorst;
        }

        // Run-length encode consecutive edges into segments: [[startIdx, endIdx, worstClass], ...]
        $currentStart = 0;
        $currentClass = $edgeWorstClasses[0] ?? 0;

        for ($i = 1; $i < count($edgeWorstClasses); $i++) {
            if ($edgeWorstClasses[$i] !== $currentClass) {
                $segments[] = [$currentStart, $i, $currentClass];
                $currentStart = $i;
                $currentClass = $edgeWorstClasses[$i];
            }
        }
        $segments[] = [$currentStart, $n - 1, $currentClass];

        $formatClassMeters = function (array $m) {
            return [
                'none'      => round($m[0], 2),
                'low'       => round($m[1], 2),
                'moderate'  => round($m[2], 2),
                'high'      => round($m[3], 2),
                'very_high' => round($m[4], 2),
            ];
        };

        return [
            'length_m'        => round($totalLengthM, 2),
            'exposure_index'  => round($totalExposure, 2),
            'meters_by_class' => [
                'flood'     => $formatClassMeters($metersFlood),
                'landslide' => $formatClassMeters($metersLandslide),
                'worst'     => $formatClassMeters($metersWorst),
            ],
            'segments'        => $segments,
        ];
    }

    /**
     * Helper to extract [lat, lng] from array format.
     *
     * @param  array<int, float>|array{lat: float, lng: float}  $c
     * @return array{0: float, 1: float}
     */
    private function extractCoord(array $c): array
    {
        if (isset($c['lat']) && isset($c['lng'])) {
            return [(float) $c['lat'], (float) $c['lng']];
        }
        return [(float) ($c[0] ?? 0), (float) ($c[1] ?? 0)];
    }

    /**
     * Compute Haversine great-circle distance between two coordinates in meters.
     */
    public function haversineDistance(float $lat1, float $lng1, float $lat2, float $lng2): float
    {
        $earthRadius = 6371000.0; // meters
        $dLat = deg2rad($lat2 - $lat1);
        $dLng = deg2rad($lng2 - $lng1);

        $a = sin($dLat / 2) * sin($dLat / 2) +
            cos(deg2rad($lat1)) * cos(deg2rad($lat2)) *
            sin($dLng / 2) * sin($dLng / 2);

        $c = 2 * atan2(sqrt($a), sqrt(1 - $a));
        return $earthRadius * $c;
    }

    private function ensureLoaded(): void
    {
        if (! self::$loaded || self::$meta === null) {
            $this->loadGrid();
        }
    }
}
