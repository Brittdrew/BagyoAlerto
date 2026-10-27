<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class HazardLookupService
{
    /** Susceptibility rank order (ascending severity) */
    public const SEVERITY_RANK = [
        'low'       => 1,
        'moderate'  => 2,
        'high'      => 3,
        'very_high' => 4,
    ];

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

    /**
     * Look up susceptibility sampling the exact point plus 25m, 50m (9 points within 50m),
     * and 100m (4 points at 100m ring).
     *
     * @param  float   $lat
     * @param  float   $lng
     * @param  string  $service Config key: 'flood' or 'landslide'
     * @param  array<string, array{status:string,class:string|null,raw:string|null}>  $cache
     * @return array{
     *     status: string,
     *     point_class: string|null,
     *     worst_class: string|null,
     *     mapped_nearby: bool|null,
     *     raw_point: string|null
     * }
     */
    public function lookupWithRadius(float $lat, float $lng, string $service, array &$cache = []): array
    {
        $directions = [
            'N' => 0.0,
            'S' => 180.0,
            'E' => 90.0,
            'W' => 270.0,
        ];

        // 1. Center / exact point (index 0)
        $sampleCoords = [
            ['dist' => 0, 'lat' => $lat, 'lng' => $lng],
        ];

        // 2. 25m and 50m (within 50m ring: indices 1..8)
        foreach ([25, 50] as $dist) {
            foreach ($directions as $bearing) {
                [$pLat, $pLng] = $this->destinationPoint($lat, $lng, (float) $dist, $bearing);
                $sampleCoords[] = ['dist' => $dist, 'lat' => $pLat, 'lng' => $pLng];
            }
        }

        // 3. 100m (probe ring: indices 9..12)
        foreach ($directions as $bearing) {
            [$pLat, $pLng] = $this->destinationPoint($lat, $lng, 100.0, $bearing);
            $sampleCoords[] = ['dist' => 100, 'lat' => $pLat, 'lng' => $pLng];
        }

        $results = [];

        foreach ($sampleCoords as $sample) {
            $pLat = $sample['lat'];
            $pLng = $sample['lng'];
            $cacheKey = "{$service}:" . round($pLat, 6) . ':' . round($pLng, 6);

            if (! isset($cache[$cacheKey])) {
                if (! app()->runningUnitTests()) {
                    usleep(150000); // 150 ms between network calls
                }
                $cache[$cacheKey] = $this->lookup($pLat, $pLng, $service);
            }

            $res = $cache[$cacheKey];

            // If ANY request failed / timed out, never treat as no_data
            if ($res['status'] === 'error') {
                return [
                    'status'        => 'error',
                    'point_class'   => null,
                    'worst_class'   => null,
                    'mapped_nearby' => null,
                    'raw_point'     => null,
                ];
            }

            $results[] = $res;
        }

        // Exact point class
        $exactRes = $results[0];
        $pointClass = ($exactRes['status'] === 'ok') ? $exactRes['class'] : null;

        // Worst class within 50m (indices 0..8)
        $worstClass = null;
        $maxRank = 0;

        for ($i = 0; $i <= 8; $i++) {
            $r = $results[$i];
            if ($r['status'] === 'ok' && ! empty($r['class'])) {
                $rank = self::SEVERITY_RANK[$r['class']] ?? 0;
                if ($rank > $maxRank) {
                    $maxRank = $rank;
                    $worstClass = $r['class'];
                }
            }
        }

        // Mapped nearby within 100m (all 13 points)
        $hasAnyMapped = false;
        foreach ($results as $r) {
            if ($r['status'] === 'ok' && ! empty($r['class'])) {
                $hasAnyMapped = true;
                break;
            }
        }

        return [
            'status'        => 'ok',
            'point_class'   => $pointClass,
            'worst_class'   => $worstClass,
            'mapped_nearby' => $hasAnyMapped,
            'raw_point'     => $exactRes['raw'] ?? null,
        ];
    }

    /**
     * Look up the susceptibility class for a given coordinate and service key.
     *
     * @param  float   $lat     Latitude in decimal degrees (WGS-84)
     * @param  float   $lng     Longitude in decimal degrees (WGS-84)
     * @param  string  $service Config key: 'flood' or 'landslide'
     * @return array{status: string, class: string|null, raw: string|null}
     */
    public function lookup(float $lat, float $lng, string $service): array
    {
        $cfg  = config("hazard.services.{$service}");
        $base = rtrim((string) config('hazard.base_url'), '/');
        $h    = (float) config('hazard.half_window', 0.0005);

        if (empty($cfg)) {
            Log::warning("HazardLookupService: unknown service [{$service}]");
            return ['status' => 'error', 'class' => null, 'raw' => null];
        }

        $url = "{$base}/{$cfg['path']}/MapServer/WMSServer";

        // Pass parameters as an array – Http::get() will URL-encode them correctly,
        // preserving special characters like '+' in info_format (no hand-concatenation).
        $query = [
            'service'       => 'WMS',
            'version'       => '1.3.0',
            'request'       => 'GetFeatureInfo',
            'layers'        => $cfg['layer'],
            'query_layers'  => $cfg['layer'],
            'styles'        => '',
            'crs'           => 'CRS:84',
            'bbox'          => implode(',', [
                $lng - $h,
                $lat - $h,
                $lng + $h,
                $lat + $h,
            ]),
            'width'         => 101,
            'height'        => 101,
            'i'             => 50,
            'j'             => 50,
            'info_format'   => 'application/geo+json',
            'feature_count' => 1,
        ];

        try {
            $response = Http::timeout(15)
                ->retry(2, 500)
                ->get($url, $query);

            if (! $response->successful()) {
                Log::warning(
                    "HazardLookupService: HTTP {$response->status()} for {$service} at ({$lat},{$lng})"
                );
                return ['status' => 'error', 'class' => null, 'raw' => null];
            }

            $data     = $response->json();
            $features = $data['features'] ?? [];

            if (empty($features)) {
                return ['status' => 'no_data', 'class' => null, 'raw' => null];
            }

            $raw = $features[0]['properties'][$cfg['property']] ?? null;

            if ($raw === null || $raw === '') {
                return ['status' => 'no_data', 'class' => null, 'raw' => null];
            }

            $normalized = $this->normalize((string) $raw);

            if ($normalized === null) {
                Log::warning("HazardLookupService: unrecognized value [{$raw}] for {$service}");
                return ['status' => 'error', 'class' => null, 'raw' => (string) $raw];
            }

            return ['status' => 'ok', 'class' => $normalized, 'raw' => (string) $raw];

        } catch (\Throwable $e) {
            Log::warning(
                "HazardLookupService: exception for {$service} at ({$lat},{$lng}): {$e->getMessage()}"
            );
            return ['status' => 'error', 'class' => null, 'raw' => null];
        }
    }

    /**
     * Normalize a raw susceptibility label to one of: low, moderate, high, very_high.
     *
     * Algorithm:
     *   1. Strip trailing word "Susceptibility" (case-insensitive).
     *   2. Trim, lowercase, collapse whitespace to underscore.
     *   3. Return null if the result is not in the allowed set.
     */
    public function normalize(string $raw): ?string
    {
        // Remove the trailing word "Susceptibility"
        $cleaned = trim((string) preg_replace('/\bSusceptibility\b/i', '', $raw));

        // Collapse any whitespace to underscore, then lowercase
        $key = strtolower((string) preg_replace('/\s+/', '_', trim($cleaned)));

        // Strip stray leading/trailing underscores
        $key = trim($key, '_');

        $allowed = ['low', 'moderate', 'high', 'very_high'];

        return in_array($key, $allowed, true) ? $key : null;
    }
}
