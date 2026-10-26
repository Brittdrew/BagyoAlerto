<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class HazardLookupService
{
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
