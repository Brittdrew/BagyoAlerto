<?php

namespace App\Http\Controllers;

use App\Models\Barangay;
use App\Models\EvacuationCenter;
use App\Services\OpenMeteoWeatherService;
use Illuminate\Support\Facades\Cache;
use Throwable;

class BarangayController extends Controller
{
    /** Cache key for the public barangay list. */
    const CACHE_KEY = 'api.barangays.list';

    /** GET /api/barangays — cached 60 s. */
    public function index()
    {
        $data = Cache::remember(self::CACHE_KEY, 60, function () {
            // Use map + toArray so $appends accessors (hazard_level) are included.
            return Barangay::all()->map->toArray()->values()->all();
        });

        return response()->json($data);
    }

    public function show($id)
    {
        $barangay = Barangay::with('evacuationCenters')->find($id);
        if (!$barangay) {
            return response()->json(['message' => 'Barangay not found'], 404);
        }
        return response()->json($barangay);
    }

    /** GET /api/barangays/{id}/weather — read-only, cached five minutes. */
    public function weather($id, OpenMeteoWeatherService $weatherService)
    {
        $barangay = Barangay::find($id);
        if (! $barangay) {
            return response()->json(['message' => 'Barangay not found'], 404);
        }

        try {
            $weather = Cache::remember(
                "api.barangays.{$barangay->id}.weather",
                now()->addMinutes(5),
                fn (): array => $weatherService->forBarangay($barangay),
            );
        } catch (Throwable) {
            return response()->json([
                'message' => 'Live weather is temporarily unavailable.',
            ], 503);
        }

        return response()->json($weather);
    }

    public function evacuationTarget($id)
    {
        $barangay = Barangay::find($id);
        if (!$barangay) {
            return response()->json(['message' => 'Barangay not found'], 404);
        }

        // 1. Candidates = active centers where barangay_id = {id} and current_occupancy < capacity
        $localCandidates = EvacuationCenter::where('barangay_id', $barangay->id)
            ->where('is_active', true)
            ->whereColumn('current_occupancy', '<', 'capacity')
            ->get();

        if ($localCandidates->isNotEmpty()) {
            // 2. Return the one nearest to the barangay's coordinates (use existing getDistanceTo). is_fallback = false
            $sortedLocal = $localCandidates->map(function ($center) use ($barangay) {
                $center->distance = $center->getDistanceTo($barangay->latitude, $barangay->longitude);
                return $center;
            })->sortBy('distance')->values();

            $target = $sortedLocal->first();
            $alternatives = $sortedLocal->slice(1)->values();

            return response()->json($this->formatResponse($target, false, $alternatives));
        }

        // 3. Otherwise, return the nearest active center city-wide with current_occupancy < capacity. is_fallback = true
        $cityWideCandidates = EvacuationCenter::where('is_active', true)
            ->whereColumn('current_occupancy', '<', 'capacity')
            ->get();

        if ($cityWideCandidates->isNotEmpty()) {
            $sortedCityWide = $cityWideCandidates->map(function ($center) use ($barangay) {
                $center->distance = $center->getDistanceTo($barangay->latitude, $barangay->longitude);
                return $center;
            })->sortBy('distance')->values();

            $target = $sortedCityWide->first();

            return response()->json($this->formatResponse($target, true, collect()));
        }

        // 4. If none qualify, return 404 with a clear message
        return response()->json([
            'message' => 'No qualifying evacuation centers available'
        ], 404);
    }

    private function formatCenter(EvacuationCenter $center, bool $isFallback = false): array
    {
        return [
            'id'                       => (int) $center->id,
            'name'                     => (string) $center->name,
            'address'                  => $center->address,
            'latitude'                 => (float) $center->latitude,
            'longitude'                => (float) $center->longitude,
            'capacity'                 => (int) $center->capacity,
            'current_occupancy'        => (int) $center->current_occupancy,
            'barangay_id'              => (int) $center->barangay_id,
            'is_fallback'              => $isFallback,
            'is_active'                => (bool) $center->is_active,
            'flood_susceptibility'     => $center->flood_susceptibility,
            'landslide_susceptibility' => $center->landslide_susceptibility,
            'flood_mapped_nearby'      => $center->flood_mapped_nearby,
            'landslide_mapped_nearby'  => $center->landslide_mapped_nearby,
            'hazard_level'             => $center->hazard_level,
            'hazard_source'            => $center->hazard_source,
            'hazard_checked_at'        => $center->hazard_checked_at,
        ];
    }

    private function formatResponse(EvacuationCenter $target, bool $isFallback, $alternatives): array
    {
        $response = $this->formatCenter($target, $isFallback);
        $response['alternatives'] = $alternatives->map(function ($alt) {
            return $this->formatCenter($alt, false);
        })->values()->all();

        return $response;
    }
}
