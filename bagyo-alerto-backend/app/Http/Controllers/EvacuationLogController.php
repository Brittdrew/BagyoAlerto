<?php

namespace App\Http\Controllers;

use App\Models\Barangay;
use App\Models\EvacuationCenter;
use App\Models\EvacuationLog;
use App\Models\User;
use App\Models\Admin;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class EvacuationLogController extends Controller
{
    /**
     * Store a new evacuation log (arrival or departure).
     *
     * Validates headcount >= 1.
     * Rejects a departure that would make occupancy negative.
     */
    public function store(Request $request, $centerId = null)
    {
        $targetCenterId = $centerId ?? $request->input('evacuation_center_id');

        $validated = $request->validate([
            'evacuation_center_id' => $centerId ? 'nullable|integer' : 'required|integer|exists:evacuation_centers_list,id',
            'type' => ['required', Rule::in(['arrival', 'departure'])],
            'headcount' => 'required|integer|min:1',
            'origin_barangay_id' => 'nullable|integer|exists:barangays,id',
            'recorded_by' => 'nullable|integer|exists:admins,id',
        ]);

        $center = EvacuationCenter::find($targetCenterId);
        if (!$center) {
            return response()->json(['message' => 'Evacuation center not found'], 404);
        }

        // Calculate current occupancy from logs
        $currentOccupancy = $this->getCurrentOccupancy($center->id);

        // Reject departure that would make occupancy negative
        if ($validated['type'] === 'departure' && ($currentOccupancy - $validated['headcount']) < 0) {
            return response()->json([
                'message' => 'Departure would cause evacuation center occupancy to become negative.',
                'errors' => [
                    'headcount' => [
                        "Departure headcount ({$validated['headcount']}) exceeds current occupancy ({$currentOccupancy})."
                    ]
                ],
                'current_occupancy' => $currentOccupancy,
            ], 422);
        }

        // Resolve recorded_by admin ID
        $recordedBy = $validated['recorded_by'] ?? null;
        if (!$recordedBy) {
            $user = $request->user();
            if ($user instanceof Admin) {
                $recordedBy = $user->id;
            } elseif ($user) {
                $recordedBy = $user->id;
            }
        }

        $log = EvacuationLog::create([
            'evacuation_center_id' => $center->id,
            'origin_barangay_id'   => $validated['origin_barangay_id'] ?? null,
            'type'                 => $validated['type'],
            'headcount'            => $validated['headcount'],
            'source'               => 'admin',
            'device_id'            => null,
            'recorded_by'          => $recordedBy,
        ]);

        // Keep current_occupancy column in sync
        $newOccupancy = $validated['type'] === 'arrival'
            ? ($currentOccupancy + $validated['headcount'])
            : ($currentOccupancy - $validated['headcount']);

        $center->update(['current_occupancy' => max(0, $newOccupancy)]);

        $log->load(['evacuationCenter', 'originBarangay', 'admin']);

        return response()->json($log, 201);
    }

    /**
     * List logs per center, filterable by type and origin_barangay_id, newest first.
     */
    public function index(Request $request, $centerId = null)
    {
        $targetCenterId = $centerId ?? $request->query('evacuation_center_id') ?? $request->query('center_id');

        $query = EvacuationLog::query();

        if ($targetCenterId) {
            $query->where('evacuation_center_id', $targetCenterId);
        }

        if ($request->filled('type')) {
            $query->where('type', $request->query('type'));
        }

        if ($request->filled('origin_barangay_id')) {
            $query->where('origin_barangay_id', $request->query('origin_barangay_id'));
        }

        $logs = $query->orderByDesc('id')
            ->with(['originBarangay', 'admin'])
            ->get();

        return response()->json($logs);
    }

    /**
     * Delete only the most recent log entry of a center (undo for typos).
     */
    public function destroy(Request $request, $id = null, $centerId = null)
    {
        $targetCenterId = $centerId ?? $request->route('centerId');

        if ($id) {
            $log = EvacuationLog::find($id);
            if (!$log) {
                return response()->json(['message' => 'Evacuation log not found'], 404);
            }
            $targetCenterId = $log->evacuation_center_id;
        } else {
            if (!$targetCenterId) {
                return response()->json(['message' => 'Center ID or Log ID must be provided'], 400);
            }
            $log = EvacuationLog::where('evacuation_center_id', $targetCenterId)
                ->orderByDesc('id')
                ->first();

            if (!$log) {
                return response()->json(['message' => 'No logs found for this center'], 404);
            }
        }

        // Verify that this is the most recent log entry for this center
        $mostRecent = EvacuationLog::where('evacuation_center_id', $targetCenterId)
            ->orderByDesc('id')
            ->first();

        if (!$mostRecent || (int) $mostRecent->id !== (int) $log->id) {
            return response()->json([
                'message' => 'Only the most recent log entry of a center can be deleted (undo for typos).'
            ], 422);
        }

        $log->delete();

        // Update center's current_occupancy
        $center = EvacuationCenter::find($targetCenterId);
        if ($center) {
            $newOccupancy = $this->getCurrentOccupancy($center->id);
            $center->update(['current_occupancy' => max(0, $newOccupancy)]);
        }

        return response()->json([
            'message' => 'Log entry deleted successfully.',
            'deleted_log_id' => $log->id,
        ]);
    }

    /**
     * Return center occupancy stats:
     * current (sum of arrivals minus sum of departures),
     * capacity,
     * free_space (capacity minus current, never below 0),
     * and status (available under 70%, almost_full 70-99%, full at 100%+).
     */
    public function occupancy(Request $request, $id = null)
    {
        $targetId = $id ?? $request->route('id') ?? $request->route('centerId') ?? $request->input('evacuation_center_id');
        $center = EvacuationCenter::find($targetId);
        if (!$center) {
            return response()->json(['message' => 'Evacuation center not found'], 404);
        }

        $data = $this->computeCenterOccupancy($center);

        return response()->json($data);
    }

    /**
     * GET /api/barangays/{id}/evacuees
     * Occupancy per center in that barangay, plus arrivals grouped by origin barangay.
     */
    public function barangayEvacuees($id)
    {
        $barangay = Barangay::find($id);
        if (!$barangay) {
            return response()->json(['message' => 'Barangay not found'], 404);
        }

        $centers = EvacuationCenter::where('barangay_id', $barangay->id)->get();
        $centerIds = $centers->pluck('id');

        $occupancyPerCenter = $centers->map(function ($center) {
            return $this->computeCenterOccupancy($center);
        })->values()->all();

        // Group arrivals by origin barangay for all centers in this barangay
        $groupedArrivals = EvacuationLog::whereIn('evacuation_center_id', $centerIds)
            ->where('type', 'arrival')
            ->selectRaw('origin_barangay_id, SUM(headcount) as total_arrivals')
            ->groupBy('origin_barangay_id')
            ->orderByDesc('total_arrivals')
            ->get();

        $originIds = $groupedArrivals->pluck('origin_barangay_id')->filter()->unique();
        $originNames = Barangay::whereIn('id', $originIds)->pluck('name', 'id');

        $arrivalsByOrigin = $groupedArrivals->map(function ($row) use ($originNames) {
            $originId = $row->origin_barangay_id ? (int) $row->origin_barangay_id : null;
            $originName = $originId ? ($originNames[$originId] ?? 'Unknown') : 'Unknown';
            $count = (int) $row->total_arrivals;

            return [
                'origin_barangay_id' => $originId,
                'origin_barangay_name' => $originName,
                'headcount' => $count,
                'total_arrivals' => $count,
            ];
        })->values()->all();

        return response()->json([
            'barangay' => [
                'id' => (int) $barangay->id,
                'name' => $barangay->name,
                'city' => $barangay->city,
            ],
            'centers' => $occupancyPerCenter,
            'occupancy' => $occupancyPerCenter,
            'arrivals_by_origin' => $arrivalsByOrigin,
            'arrivals_grouped_by_origin' => $arrivalsByOrigin,
        ]);
    }

    /**
     * GET /api/evacuation-centers/overview
     *
     * Returns every evacuation center with aggregated occupancy data using
     * only two DB queries (no per-center loop).
     *
     * Fields per row: id, name, barangay_id, barangay_name, current, capacity,
     * free_space, status, over_capacity, over_by, latest_log_at.
     *
     * Numbers are identical to what /occupancy returns for each center.
     */
    public function overview(): \Illuminate\Http\JsonResponse
    {
        $threshold = (float) config('evacuation.almost_full_threshold', 70);

        // ── Query 1: aggregate evacuation_logs per center ───────────────────
        // One row per (evacuation_center_id, type) – pivot in PHP.
        $logRows = DB::table('evacuation_logs')
            ->selectRaw('evacuation_center_id, type, SUM(headcount) AS total')
            ->groupBy('evacuation_center_id', 'type')
            ->get()
            ->groupBy('evacuation_center_id');

        // ── Query 2: latest log timestamp per center ─────────────────────────
        $latestLogs = DB::table('evacuation_logs')
            ->selectRaw('evacuation_center_id, MAX(created_at) AS latest_log_at')
            ->groupBy('evacuation_center_id')
            ->pluck('latest_log_at', 'evacuation_center_id');

        // ── Query 3: all centers with barangay name ──────────────────────────
        $centers = EvacuationCenter::with('barangay:id,name')->orderBy('id')->get();

        $result = $centers->map(function (EvacuationCenter $center) use ($logRows, $latestLogs, $threshold) {
            $rows     = $logRows->get((string) $center->id, collect());
            $arrivals = (int) ($rows->firstWhere('type', 'arrival')?->total ?? 0);
            $departures = (int) ($rows->firstWhere('type', 'departure')?->total ?? 0);
            $current  = max(0, $arrivals - $departures);
            $capacity = (int) $center->capacity;
            $freeSpace = max(0, $capacity - $current);

            if ($capacity <= 0) {
                $status = $current > 0 ? 'full' : 'available';
            } else {
                $pct = ($current / $capacity) * 100;
                if ($current >= $capacity || $pct >= 100) {
                    $status = 'full';
                } elseif ($pct >= $threshold) {
                    $status = 'almost_full';
                } else {
                    $status = 'available';
                }
            }

            $overCapacity = $capacity > 0 && $current > $capacity;
            $overBy       = $overCapacity ? ($current - $capacity) : 0;

            return [
                'id'             => (int) $center->id,
                'name'           => $center->name,
                'barangay_id'    => (int) $center->barangay_id,
                'barangay_name'  => $center->barangay?->name ?? null,
                'current'        => $current,
                'capacity'       => $capacity,
                'free_space'     => $freeSpace,
                'status'         => $status,
                'over_capacity'  => $overCapacity,
                'over_by'        => $overBy,
                'latest_log_at'  => $latestLogs->get($center->id),
            ];
        })->values();

        return response()->json($result);
    }

    /**
     * Batch calculate current occupancy for evacuation centers from logs.
     * Returns a collection keyed by evacuation_center_id => occupancy int.
     *
     * @param iterable|null $centerIds
     * @return \Illuminate\Support\Collection<int, int>
     */
    public static function getOccupancyCounts(?iterable $centerIds = null): \Illuminate\Support\Collection
    {
        $query = DB::table('evacuation_logs')
            ->selectRaw('evacuation_center_id, type, SUM(headcount) AS total')
            ->groupBy('evacuation_center_id', 'type');

        if ($centerIds !== null) {
            $query->whereIn('evacuation_center_id', $centerIds);
        }

        $logRows = $query->get()->groupBy('evacuation_center_id');

        $occupancies = collect();
        foreach ($logRows as $centerId => $rows) {
            $arrivals = (int) ($rows->firstWhere('type', 'arrival')?->total ?? 0);
            $departures = (int) ($rows->firstWhere('type', 'departure')?->total ?? 0);
            $occupancies[$centerId] = max(0, $arrivals - $departures);
        }

        return $occupancies;
    }

    /**
     * Helper to calculate current occupancy (sum of arrivals minus sum of departures).
     */
    private function getCurrentOccupancy(int $centerId): int
    {
        $arrivals = (int) EvacuationLog::where('evacuation_center_id', $centerId)
            ->where('type', 'arrival')
            ->sum('headcount');

        $departures = (int) EvacuationLog::where('evacuation_center_id', $centerId)
            ->where('type', 'departure')
            ->sum('headcount');

        return max(0, $arrivals - $departures);
    }

    /**
     * Compute standardized occupancy attributes for an evacuation center.
     */
    private function computeCenterOccupancy(EvacuationCenter $center): array
    {
        $current = $this->getCurrentOccupancy($center->id);
        $capacity = (int) $center->capacity;
        $freeSpace = max(0, $capacity - $current);

        $threshold = (float) config('evacuation.almost_full_threshold');

        if ($capacity <= 0) {
            $status = $current > 0 ? 'full' : 'available';
        } else {
            $percentage = ($current / $capacity) * 100;
            if ($current >= $capacity || $percentage >= 100) {
                $status = 'full';
            } elseif ($percentage >= $threshold) {
                $status = 'almost_full';
            } else {
                $status = 'available';
            }
        }

        $overCapacity = $capacity > 0 && $current > $capacity;
        $overBy = $overCapacity ? ($current - $capacity) : 0;

        return [
            'id' => (int) $center->id,
            'evacuation_center_id' => (int) $center->id,
            'name' => $center->name,
            'capacity' => $capacity,
            'current' => $current,
            'free_space' => $freeSpace,
            'status' => $status,
            'over_capacity' => $overCapacity,
            'over_by' => $overBy,
            'is_active' => (bool) $center->is_active,
            'address' => $center->address,
            'barangay_id' => (int) $center->barangay_id,
        ];
    }

    /**
     * Public self-arrival endpoint — no auth required.
     *
     * POST /api/evacuation-centers/{centerId}/self-arrival
     *
     * Validates:
     *   - Device must be within arrival_radius_meters of the center (422 if too far)
     *   - Same device_id may not self-report at the same center within cooldown window (409)
     *   - headcount 1-10, default 1
     *   - Only creates arrivals, never departures
     *
     * Returns a slim occupancy payload (no personal data).
     */
    public function selfArrival(Request $request, $centerId)
    {
        $center = EvacuationCenter::find($centerId);
        if (!$center) {
            return response()->json(['message' => 'Evacuation center not found'], 404);
        }

        $validated = $request->validate([
            'device_id'          => 'required|string|max:255',
            'latitude'           => 'required|numeric|between:-90,90',
            'longitude'          => 'required|numeric|between:-180,180',
            'headcount'          => 'sometimes|integer|min:1|max:10',
            'origin_barangay_id' => 'nullable|integer|exists:barangays,id',
        ]);

        $headcount = $validated['headcount'] ?? 1;

        // --- Distance check (Haversine) ---
        // getDistanceTo() returns km; convert to metres for comparison.
        $radiusMeters = (int) config('evacuation.arrival_radius_meters', 100);
        $distanceMeters = $center->getDistanceTo(
            (float) $validated['latitude'],
            (float) $validated['longitude']
        ) * 1000;

        if ($distanceMeters > $radiusMeters) {
            return response()->json([
                'message'          => 'You are too far from this evacuation center to self-report.',
                'distance_meters'  => round($distanceMeters, 1),
                'radius_meters'    => $radiusMeters,
            ], 422);
        }

        // --- Device cooldown check ---
        $cooldownHours = (int) config('evacuation.self_arrival_cooldown_hours', 12);
        $cutoff = Carbon::now()->subHours($cooldownHours);

        $alreadyReported = EvacuationLog::where('evacuation_center_id', $center->id)
            ->where('device_id', $validated['device_id'])
            ->where('source', 'gps')
            ->where('created_at', '>=', $cutoff)
            ->exists();

        if ($alreadyReported) {
            return response()->json([
                'message' => "This device has already self-reported at this center within the last {$cooldownHours} hours.",
            ], 409);
        }

        // --- Create the arrival log ---
        EvacuationLog::create([
            'evacuation_center_id' => $center->id,
            'origin_barangay_id'   => $validated['origin_barangay_id'] ?? null,
            'type'                 => 'arrival',
            'headcount'            => $headcount,
            'source'               => 'gps',
            'device_id'            => $validated['device_id'],
            'recorded_by'          => null,
        ]);

        // Update the cached current_occupancy column
        $newOccupancy = $this->getCurrentOccupancy($center->id);
        $center->update(['current_occupancy' => max(0, $newOccupancy)]);

        // --- Return slim occupancy payload ---
        $occupancy = $this->computeCenterOccupancy($center->fresh());

        return response()->json([
            'message'    => 'Self-arrival recorded successfully.',
            'current'    => $occupancy['current'],
            'capacity'   => $occupancy['capacity'],
            'free_space' => $occupancy['free_space'],
            'status'     => $occupancy['status'],
        ], 201);
    }
}
