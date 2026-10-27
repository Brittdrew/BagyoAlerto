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

    /**
     * Generate up to 3 detour via points around the worst hazard stretch of the route.
     *
     * - Score the fastest route, find the worst contiguous stretch (highest summed exposure using weights in config/hazard.php).
     * - Around the midpoint of that stretch, sample candidate points perpendicular to the route direction, left and right, at 250-800 m.
     * - Keep only points whose grid cell is a lower hazard class than the stretch (and never high/very_high), prefer lowest class then smallest offset. Max 3, at least ~200 m apart.
     *
     * @param  array<int, array<int, float>|array{lat: float, lng: float}>  $routeCoords
     * @param  string  $mode  'foot' | 'car'
     * @return array<int, array{0: float, 1: float}>
     */
    public function detourPoints(array $routeCoords, string $mode = 'foot'): array
    {
        $this->ensureLoaded();

        $n = count($routeCoords);
        if ($n < 2) {
            return [];
        }

        $weights = config('hazard.weights', [
            'none' => 0, 'low' => 0, 'moderate' => 1, 'high' => 3, 'very_high' => 5,
            0 => 0, 1 => 0, 2 => 1, 3 => 3, 4 => 5,
        ]);

        // 1. Densify edges and sample hazard along the route
        $steps = [];
        for ($i = 0; $i < $n - 1; $i++) {
            [$lat1, $lng1] = $this->extractCoord($routeCoords[$i]);
            [$lat2, $lng2] = $this->extractCoord($routeCoords[$i + 1]);

            $d = $this->haversineDistance($lat1, $lng1, $lat2, $lng2);
            if ($d <= 0.0001) {
                continue;
            }

            $k = max(1, (int) ceil($d / 25.0));
            $stepD = $d / $k;

            for ($s = 1; $s <= $k; $s++) {
                $t1 = ($s - 1) / $k;
                $t2 = $s / $k;
                $tMid = ($s - 0.5) / $k;

                $sStartLat = $lat1 + $t1 * ($lat2 - $lat1);
                $sStartLng = $lng1 + $t1 * ($lng2 - $lng1);
                $sEndLat = $lat1 + $t2 * ($lat2 - $lat1);
                $sEndLng = $lng1 + $t2 * ($lng2 - $lng1);
                $sMidLat = $lat1 + $tMid * ($lat2 - $lat1);
                $sMidLng = $lng1 + $tMid * ($lng2 - $lng1);

                $sample = $this->lookup($sMidLat, $sMidLng);
                $w = max($sample[0], $sample[1]);
                $weight = $weights[$w] ?? 0;
                $stepExp = $stepD * $weight;

                $steps[] = [
                    'startLat'     => $sStartLat,
                    'startLng'     => $sStartLng,
                    'endLat'       => $sEndLat,
                    'endLng'       => $sEndLng,
                    'midLat'       => $sMidLat,
                    'midLng'       => $sMidLng,
                    'length_m'     => $stepD,
                    'hazard_class' => $w,
                    'weight'       => $weight,
                    'exposure'     => $stepExp,
                ];
            }
        }

        if (empty($steps)) {
            return [];
        }

        // 2. Identify contiguous hazard stretches where weight > 0
        $stretches = [];
        $currentStretch = null;

        foreach ($steps as $st) {
            if ($st['weight'] > 0) {
                if ($currentStretch === null) {
                    $currentStretch = [
                        'steps'    => [],
                        'exposure' => 0.0,
                        'length_m' => 0.0,
                        'maxClass' => 0,
                    ];
                }
                $currentStretch['steps'][] = $st;
                $currentStretch['exposure'] += $st['exposure'];
                $currentStretch['length_m'] += $st['length_m'];
                if ($st['hazard_class'] > $currentStretch['maxClass']) {
                    $currentStretch['maxClass'] = $st['hazard_class'];
                }
            } else {
                if ($currentStretch !== null) {
                    $stretches[] = $currentStretch;
                    $currentStretch = null;
                }
            }
        }
        if ($currentStretch !== null) {
            $stretches[] = $currentStretch;
        }

        if (empty($stretches)) {
            return [];
        }

        // Find the worst contiguous stretch (highest summed exposure)
        usort($stretches, fn($a, $b) => $b['exposure'] <=> $a['exposure']);
        $worstStretch = $stretches[0];

        if ($worstStretch['exposure'] <= 0.0 || $worstStretch['length_m'] <= 0.0) {
            return [];
        }

        $stretchClass = $worstStretch['maxClass'];
        $stretchSteps = $worstStretch['steps'];
        $totalStretchLen = $worstStretch['length_m'];

        // 3. Find the midpoint of that stretch (halfway by distance)
        $halfLen = $totalStretchLen / 2.0;
        $cumLen = 0.0;
        $midLat = $stretchSteps[0]['midLat'];
        $midLng = $stretchSteps[0]['midLng'];
        $routeBearing = 0.0;

        foreach ($stretchSteps as $st) {
            if ($cumLen + $st['length_m'] >= $halfLen) {
                $rem = $halfLen - $cumLen;
                $frac = $st['length_m'] > 0 ? ($rem / $st['length_m']) : 0.5;
                $frac = max(0.0, min(1.0, $frac));
                $midLat = $st['startLat'] + $frac * ($st['endLat'] - $st['startLat']);
                $midLng = $st['startLng'] + $frac * ($st['endLng'] - $st['startLng']);
                $routeBearing = $this->calculateBearing($st['startLat'], $st['startLng'], $st['endLat'], $st['endLng']);
                break;
            }
            $cumLen += $st['length_m'];
        }

        if ($routeBearing === 0.0 && count($stretchSteps) > 1) {
            $first = $stretchSteps[0];
            $last = end($stretchSteps);
            $routeBearing = $this->calculateBearing($first['startLat'], $first['startLng'], $last['endLat'], $last['endLng']);
        }

        // 4. Sample candidate points around the midpoint perpendicular to route direction, left and right, at 250-800 m
        $offsets = [250, 350, 500, 650, 800];

        // Sample centers around midpoint: midpoint, and if stretch is long enough, around 30% and 70%
        $centers = [[$midLat, $midLng, $routeBearing]];
        if ($totalStretchLen >= 300.0) {
            foreach ([0.3, 0.7] as $pct) {
                $targetLen = $totalStretchLen * $pct;
                $cLen = 0.0;
                foreach ($stretchSteps as $st) {
                    if ($cLen + $st['length_m'] >= $targetLen) {
                        $rem = $targetLen - $cLen;
                        $frac = $st['length_m'] > 0 ? ($rem / $st['length_m']) : 0.5;
                        $cLat = $st['startLat'] + $frac * ($st['endLat'] - $st['startLat']);
                        $cLng = $st['startLng'] + $frac * ($st['endLng'] - $st['startLng']);
                        $cBrg = $this->calculateBearing($st['startLat'], $st['startLng'], $st['endLat'], $st['endLng']);
                        $centers[] = [$cLat, $cLng, $cBrg];
                        break;
                    }
                    $cLen += $st['length_m'];
                }
            }
        }

        $candidates = [];
        $bbox = self::$meta['bbox'] ?? null;

        foreach ($centers as [$cLat, $cLng, $cBrg]) {
            $lBrg = fmod($cBrg - 90.0 + 360.0, 360.0);
            $rBrg = fmod($cBrg + 90.0, 360.0);

            foreach ($offsets as $offset) {
                foreach ([$lBrg, $rBrg] as $brg) {
                    [$pLat, $pLng] = $this->destinationPoint($cLat, $cLng, (float) $offset, $brg);

                    // Ensure point is within bounding box if bbox is defined
                    if ($bbox) {
                        if ($pLat < $bbox['min_lat'] || $pLat > $bbox['max_lat'] ||
                            $pLng < $bbox['min_lng'] || $pLng > $bbox['max_lng']) {
                            continue;
                        }
                    }

                    $sample = $this->lookup($pLat, $pLng);
                    $pClass = max($sample[0], $sample[1]);

                    // Condition: lower hazard class than the stretch AND never high (3) or very_high (4)
                    if ($pClass < $stretchClass && $pClass < 3) {
                        $candidates[] = [
                            'lat'      => round($pLat, 6),
                            'lng'      => round($pLng, 6),
                            'class'    => $pClass,
                            'offset_m' => (float) $offset,
                        ];
                    }
                }
            }
        }

        if (empty($candidates)) {
            return [];
        }

        // 5. Prefer lowest class then smallest offset
        usort($candidates, function ($a, $b) {
            if ($a['class'] !== $b['class']) {
                return $a['class'] <=> $b['class'];
            }
            return $a['offset_m'] <=> $b['offset_m'];
        });

        // 6. Max 3, at least ~200 m apart
        $selected = [];
        foreach ($candidates as $cand) {
            $tooClose = false;
            foreach ($selected as $s) {
                if ($this->haversineDistance($cand['lat'], $cand['lng'], $s[0], $s[1]) < 195.0) {
                    $tooClose = true;
                    break;
                }
            }

            if (! $tooClose) {
                $selected[] = [$cand['lat'], $cand['lng']];
                if (count($selected) === 3) {
                    break;
                }
            }
        }

        return $selected;
    }

    /**
     * Compute initial compass bearing from point 1 to point 2 in degrees (0..360).
     */
    public function calculateBearing(float $lat1, float $lng1, float $lat2, float $lng2): float
    {
        $phi1 = deg2rad($lat1);
        $phi2 = deg2rad($lat2);
        $dLng = deg2rad($lng2 - $lng1);

        $y = sin($dLng) * cos($phi2);
        $x = cos($phi1) * sin($phi2) - sin($phi1) * cos($phi2) * cos($dLng);

        $bearing = atan2($y, $x);
        return fmod((rad2deg($bearing) + 360.0), 360.0);
    }

    /**
     * Compute destination point coordinate given start point, distance in meters, and bearing in degrees.
     *
     * @return array{0: float, 1: float} [lat, lng]
     */
    public function destinationPoint(float $lat, float $lng, float $distanceM, float $bearingDeg): array
    {
        $earthRadius = 6371000.0;
        $delta = $distanceM / $earthRadius;
        $theta = deg2rad($bearingDeg);

        $phi1 = deg2rad($lat);
        $lambda1 = deg2rad($lng);

        $phi2 = asin(sin($phi1) * cos($delta) + cos($phi1) * sin($delta) * cos($theta));
        $lambda2 = $lambda1 + atan2(
            sin($theta) * sin($delta) * cos($phi1),
            cos($delta) - sin($phi1) * sin($phi2)
        );

        return [
            rad2deg($phi2),
            fmod(rad2deg($lambda2) + 540.0, 360.0) - 180.0,
        ];
    }

    private function ensureLoaded(): void
    {
        if (! self::$loaded || self::$meta === null) {
            $this->loadGrid();
        }
    }
}
