<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;

class RouteService
{
    public function getRoute(float $fromLat, float $fromLng, float $toLat, float $toLng): ?array
    {
        // Round the start (~100 m) so nearby users share one cached route
        $key = sprintf('route:%.3f,%.3f:%.5f,%.5f', $fromLat, $fromLng, $toLat, $toLng);

        return Cache::remember($key, now()->addDays(7), function () use ($fromLat, $fromLng, $toLat, $toLng) {
            $coords = "{$fromLng},{$fromLat};{$toLng},{$toLat}";
            $servers = [
                ['https://routing.openstreetmap.de/routed-foot', 'foot', false],
                ['https://router.project-osrm.org', 'driving', true],
            ];

            foreach ($servers as [$base, $profile, $isBackup]) {
                try {
                    $res = Http::timeout(12)->retry(2, 500)->get(
                        "{$base}/route/v1/{$profile}/{$coords}",
                        ['overview' => 'full', 'geometries' => 'geojson']
                    );
                    if ($res->ok() && isset($res['routes'][0])) {
                        return ['route' => $res['routes'][0], 'isBackup' => $isBackup];
                    }
                } catch (\Throwable $e) {
                    // try next server
                }
            }
            return null; // null is not cached, so it retries next time
        });
    }
}
