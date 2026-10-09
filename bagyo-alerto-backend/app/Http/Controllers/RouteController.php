<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;

class RouteController extends Controller
{
    public function show(Request $request)
    {
        $d = $request->validate([
            'from_lat' => 'required|numeric|between:-90,90',
            'from_lng' => 'required|numeric|between:-180,180',
            'to_lat'   => 'required|numeric|between:-90,90',
            'to_lng'   => 'required|numeric|between:-180,180',
        ]);

        // Round the start (~100 m) so nearby users share one cached route
        $key = sprintf('route:%.3f,%.3f:%.5f,%.5f',
            $d['from_lat'], $d['from_lng'], $d['to_lat'], $d['to_lng']);

        $result = Cache::remember($key, now()->addDays(7), function () use ($d) {
            $coords = "{$d['from_lng']},{$d['from_lat']};{$d['to_lng']},{$d['to_lat']}";
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

        if (!$result) {
            return response()->json(['message' => 'Routing unavailable'], 502);
        }
        return response()->json($result);
    }
}
