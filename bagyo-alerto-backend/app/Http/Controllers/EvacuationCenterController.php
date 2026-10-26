<?php

namespace App\Http\Controllers;

use App\Models\EvacuationCenter;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;

class EvacuationCenterController extends Controller
{
    /** Cache key for the public evacuation center list. */
    const CACHE_KEY = 'api.evacuation_centers.list';

    /** GET /api/evacuation-centers — cached 60 s. */
    public function index()
    {
        $data = Cache::remember(self::CACHE_KEY, 60, function () {
            // Use map + toArray so $appends accessors (hazard_level) are included.
            return EvacuationCenter::with('barangay')->get()->map->toArray()->values()->all();
        });

        return response()->json($data);
    }

    public function show($id)
    {
        $center = EvacuationCenter::with('barangay')->find($id);
        if (!$center) {
            return response()->json(['message' => 'Evacuation center not found'], 404);
        }
        return response()->json($center);
    }

    public function getPhotoByBarangay($barangay_name)
    {
        $photo = \App\Models\EvacuationCenterPhoto::where('barangay_name', $barangay_name)->first();
        if (!$photo) {
            return response()->json(['message' => 'No photo found for this barangay', 'image_path' => null], 200);
        }
        return response()->json($photo);
    }

    /**
     * GET /api/evacuation-centers/nearest?lat=..&lng=..&limit=3
     *
     * Finds nearest evacuation centers to given coordinates.
     */
    public function nearest(Request $request)
    {
        $validated = $request->validate([
            'lat'   => 'required|numeric|between:-90,90',
            'lng'   => 'required|numeric|between:-180,180',
            'limit' => 'nullable|integer',
        ]);

        $lat = (float) $validated['lat'];
        $lng = (float) $validated['lng'];

        $rawLimit = (int) ($validated['limit'] ?? 3);
        $limit = $rawLimit < 1 ? 3 : min(5, $rawLimit);

        // Query 1: Get all evacuation centers
        $centers = EvacuationCenter::all();

        if ($centers->isEmpty()) {
            return response()->json([]);
        }

        // Query 2: Batch get occupancy counts from evacuation_logs
        $occupancyCounts = EvacuationLogController::getOccupancyCounts($centers->pluck('id')->all());

        $mapped = $centers->map(function (EvacuationCenter $center) use ($lat, $lng, $occupancyCounts) {
            $distance = (float) $center->getDistanceTo($lat, $lng);
            $capacity = (int) $center->capacity;

            $occupancy = $occupancyCounts->get($center->id)
                ?? $occupancyCounts->get((string) $center->id)
                ?? (int) ($center->current_occupancy ?? 0);
            $occupancy = (int) $occupancy;

            $freeSpace = $capacity - $occupancy;
            $isFull = $freeSpace <= 0;

            return [
                'id'                       => (int) $center->id,
                'name'                     => (string) $center->name,
                'barangay_id'              => $center->barangay_id !== null ? (int) $center->barangay_id : null,
                'latitude'                 => (float) $center->latitude,
                'longitude'                => (float) $center->longitude,
                'capacity'                 => $capacity,
                'occupancy'                => $occupancy,
                'free_space'               => $freeSpace,
                'is_full'                  => $isFull,
                'distance_km'              => round($distance, 2),
                '_raw_distance'            => $distance,
                'flood_susceptibility'     => $center->flood_susceptibility,
                'landslide_susceptibility' => $center->landslide_susceptibility,
                'hazard_level'             => $center->hazard_level,
                'hazard_source'            => $center->hazard_source,
                'hazard_checked_at'        => $center->hazard_checked_at,
            ];
        });

        $sorted = $mapped->sort(function ($a, $b) {
            if ($a['is_full'] !== $b['is_full']) {
                return $a['is_full'] ? 1 : -1;
            }
            if ($a['_raw_distance'] != $b['_raw_distance']) {
                return $a['_raw_distance'] <=> $b['_raw_distance'];
            }
            return $a['id'] <=> $b['id'];
        });

        $result = $sorted->take($limit)->map(function ($item) {
            unset($item['_raw_distance']);
            return $item;
        })->values();

        return response()->json($result);
    }
}