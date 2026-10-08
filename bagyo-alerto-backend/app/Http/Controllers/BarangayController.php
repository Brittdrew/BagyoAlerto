<?php

namespace App\Http\Controllers;

use App\Models\Barangay;
use App\Models\EvacuationCenter;
use Illuminate\Http\Request;

class BarangayController extends Controller
{
    public function index()
    {
        return response()->json(Barangay::all());
    }

    public function show($id)
    {
        $barangay = Barangay::with('evacuationCenters')->find($id);
        if (!$barangay) {
            return response()->json(['message' => 'Barangay not found'], 404);
        }
        return response()->json($barangay);
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
            'id' => (int) $center->id,
            'name' => (string) $center->name,
            'address' => $center->address,
            'latitude' => (float) $center->latitude,
            'longitude' => (float) $center->longitude,
            'capacity' => (int) $center->capacity,
            'current_occupancy' => (int) $center->current_occupancy,
            'barangay_id' => (int) $center->barangay_id,
            'is_fallback' => $isFallback,
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