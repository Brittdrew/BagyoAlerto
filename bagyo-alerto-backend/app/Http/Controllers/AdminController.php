<?php

namespace App\Http\Controllers;

use App\Models\Admin;
use App\Models\Barangay;
use App\Models\EvacuationCenter;
use App\Models\Recommendation;
use App\Models\TyphoonLog;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rule;

class AdminController extends Controller
{
    public function login(Request $request)
    {
        $request->validate([
            'username' => 'required|string',
            'password' => 'required|string',
        ]);

        $admin = Admin::where('username', $request->username)->first();

        if (!$admin || !Hash::check($request->password, $admin->password)) {
            return response()->json(['message' => 'Invalid credentials'], 401);
        }

        $token = $admin->createToken('admin-token')->plainTextToken;

        return response()->json([
            'token' => $token,
            'admin' => [
                'id'       => $admin->id,
                'name'     => $admin->name,
                'username' => $admin->username,
            ],
        ]);
    }

    public function logout(Request $request)
    {
        $request->user()->currentAccessToken()->delete();

        return response()->json(['message' => 'Logged out successfully']);
    }

    /**
     * GET /api/admin/me
     * Already fast — just one Sanctum token lookup + one admin row.
     * We return directly from the already-resolved $request->user().
     */
    public function me(Request $request)
    {
        $admin = $request->user();

        return response()->json([
            'id'         => $admin->id,
            'name'       => $admin->name,
            'username'   => $admin->username,
            'created_at' => $admin->created_at,
        ]);
    }

    public function changePassword(Request $request)
    {
        $request->validate([
            'current_password' => 'required|string',
            'new_password'     => 'required|string|min:6|confirmed',
        ]);

        $admin = $request->user();

        if (!Hash::check($request->current_password, $admin->password)) {
            return response()->json(['message' => 'Current password is incorrect'], 422);
        }

        $admin->update(['password' => $request->new_password]);

        return response()->json(['message' => 'Password updated successfully']);
    }

    public function stats()
    {
        return response()->json($this->buildStats());
    }



    /**
     * Build dashboard stats.
     *
     * Optimisations applied (response shape unchanged):
     *  - severity_counts + total_assessments: one query using selectRaw instead of two
     *  - total_capacity, total_barangays, total_evacuation_centers,
     *    total_recommendations: batched into a single DB::select() to avoid
     *    five separate COUNT/SUM round-trips
     *  - recommendationCountsByCenter: already a single grouped query; kept as-is
     */
    private function buildStats(): array
    {
        $severityScoreMap = [
            'low'      => 1,
            'moderate' => 2,
            'high'     => 3,
            'critical' => 4,
        ];

        // ── Single query for severity counts + total ──────────────────────────
        $severityRows = TyphoonLog::where('is_manual', false)
            ->selectRaw('severity_level, COUNT(*) as cnt')
            ->groupBy('severity_level')
            ->pluck('cnt', 'severity_level');

        $totalAssessments = $severityRows->sum();

        // ── Recent assessment series (last 12, reversed for chart order) ──────
        $recentAssessmentSeries = TyphoonLog::where('is_manual', false)
            ->orderByDesc('id')
            ->limit(12)
            ->pluck('severity_level')
            ->map(fn ($lvl) => $severityScoreMap[$lvl] ?? 1)
            ->reverse()
            ->values()
            ->all();

        // ── Recent assessments (6 rows with minimal eager-loads) ─────────────
        $recentAssessments = Recommendation::query()
            ->with(['barangay:id,name', 'typhoonLog:id,severity_level,is_manual'])
            ->whereHas('typhoonLog', fn ($q) => $q->where('is_manual', false))
            ->orderByDesc('id')
            ->limit(6)
            ->get()
            ->map(fn ($r) => [
                'id'             => $r->id,
                'barangay_name'  => $r->barangay?->name ?? 'Unknown barangay',
                'severity_level' => $r->typhoonLog?->severity_level ?? 'low',
            ])
            ->values()
            ->all();

        // ── Capacity trend (last 12 recommendations) ──────────────────────────
        $recentRecommendations = Recommendation::query()
            ->with(['evacuationCenter:id,capacity'])
            ->orderByDesc('id')
            ->limit(12)
            ->get();

        $centerIds = $recentRecommendations
            ->pluck('evacuation_center_id')
            ->filter()
            ->unique()
            ->values();

        $recommendationCountsByCenter = $centerIds->isEmpty()
            ? collect()
            : Recommendation::query()
                ->selectRaw('evacuation_center_id, COUNT(*) as total')
                ->whereIn('evacuation_center_id', $centerIds)
                ->groupBy('evacuation_center_id')
                ->pluck('total', 'evacuation_center_id');

        $capacityTrend = $recentRecommendations
            ->reverse()
            ->map(function ($r) use ($recommendationCountsByCenter) {
                $capacity      = (int) ($r->evacuationCenter?->capacity ?? 0);
                $totalAssigned = (int) ($recommendationCountsByCenter[$r->evacuation_center_id] ?? 0);

                if ($capacity <= 0) {
                    return 0;
                }

                return min(100, (int) round(($totalAssigned / $capacity) * 100));
            })
            ->values()
            ->all();

        // ── Aggregate scalars in one query ────────────────────────────────────
        $scalars = DB::selectOne('
            SELECT
                (SELECT COALESCE(SUM(capacity),0) FROM evacuation_centers_list WHERE is_active = 1) AS total_capacity,
                (SELECT COUNT(*) FROM barangays)                                                     AS total_barangays,
                (SELECT COUNT(*) FROM evacuation_centers_list WHERE is_active = 1)                  AS total_evacuation_centers,
                (SELECT COUNT(*) FROM recommendations r
                 JOIN typhoon_logs tl ON tl.id = r.typhoon_log_id
                 WHERE tl.is_manual = FALSE)                                                         AS total_recommendations
        ');

        return [
            'total_assessments'       => (int) $totalAssessments,
            'severity_counts'         => [
                'low'      => (int) ($severityRows['low']      ?? 0),
                'moderate' => (int) ($severityRows['moderate'] ?? 0),
                'high'     => (int) ($severityRows['high']     ?? 0),
                'critical' => (int) ($severityRows['critical'] ?? 0),
            ],
            'total_capacity'           => (int) ($scalars->total_capacity ?? 0),
            'total_barangays'          => (int) ($scalars->total_barangays ?? 0),
            'total_evacuation_centers' => (int) ($scalars->total_evacuation_centers ?? 0),
            'total_recommendations'    => (int) ($scalars->total_recommendations ?? 0),
            'assessments_over_time'    => $recentAssessmentSeries,
            'assessments_history'      => $recentAssessmentSeries,
            'recent_assessments'       => $recentAssessments,
            'capacity_trend'           => $capacityTrend,
        ];
    }

    public function recommendations()
    {
        $recommendations = Recommendation::with(['barangay', 'evacuationCenter', 'typhoonLog'])
            ->whereHas('typhoonLog', fn ($q) => $q->where('is_manual', false))
            ->orderBy('id', 'desc')
            ->get();

        foreach ($recommendations as $rec) {
            if ($rec->evacuationCenter && $rec->barangay) {
                $rec->evacuationCenter->distance = $rec->evacuationCenter->getDistanceTo(
                    $rec->barangay->latitude,
                    $rec->barangay->longitude
                );
            }
        }

        return response()->json($recommendations);
    }

    // ── Barangay CRUD (admin) ──────────────────────────────────────────────

    public function barangaysIndex()
    {
        return response()->json(Barangay::orderBy('name')->get());
    }

    public function barangaysStore(Request $request)
    {
        $data = $request->validate([
            'name'       => 'required|string|max:255',
            'city'       => 'required|string|max:255',
            'latitude'   => 'required|numeric',
            'longitude'  => 'required|numeric',
            'risk_level' => ['required', Rule::in(['low', 'moderate', 'high', 'critical'])],
        ]);

        $barangay = Barangay::create($data);
        Cache::forget(BarangayController::CACHE_KEY);

        return response()->json($barangay, 201);
    }

    public function barangaysUpdate(Request $request, $id)
    {
        $barangay = Barangay::find($id);

        if (!$barangay) {
            return response()->json(['message' => 'Barangay not found'], 404);
        }

        $data = $request->validate([
            'name'       => 'required|string|max:255',
            'city'       => 'required|string|max:255',
            'latitude'   => 'required|numeric',
            'longitude'  => 'required|numeric',
            'risk_level' => ['required', Rule::in(['low', 'moderate', 'high', 'critical'])],
        ]);

        $barangay->update($data);
        Cache::forget(BarangayController::CACHE_KEY);

        return response()->json($barangay);
    }

    public function barangaysDestroy($id)
    {
        $barangay = Barangay::find($id);

        if (!$barangay) {
            return response()->json(['message' => 'Barangay not found'], 404);
        }

        $barangay->delete();
        Cache::forget(BarangayController::CACHE_KEY);

        return response()->json(['message' => 'Barangay deleted successfully']);
    }

    // ── Evacuation Center CRUD (admin) ─────────────────────────────────────

    public function evacuationCentersIndex()
    {
        return response()->json(
            EvacuationCenter::with('barangay')->orderBy('name')->get()
        );
    }

    public function evacuationCentersStore(Request $request)
    {
        $data = $request->validate([
            'name'       => 'required|string|max:255',
            'barangay_id' => 'required|integer|exists:barangays,id',
            'address'    => 'required|string|max:500',
            'latitude'   => 'required|numeric',
            'longitude'  => 'required|numeric',
            'capacity'   => 'required|integer|min:1',
            'is_active'  => 'required|boolean',
        ]);

        $center = EvacuationCenter::create($data);
        $center->load('barangay');
        Cache::forget(EvacuationCenterController::CACHE_KEY);

        return response()->json($center, 201);
    }

    public function evacuationCentersUpdate(Request $request, $id)
    {
        $center = EvacuationCenter::find($id);

        if (!$center) {
            return response()->json(['message' => 'Evacuation center not found'], 404);
        }

        $data = $request->validate([
            'name'       => 'required|string|max:255',
            'barangay_id' => 'required|integer|exists:barangays,id',
            'address'    => 'required|string|max:500',
            'latitude'   => 'required|numeric',
            'longitude'  => 'required|numeric',
            'capacity'   => 'required|integer|min:1',
            'is_active'  => 'required|boolean',
        ]);

        $center->update($data);
        $center->load('barangay');
        Cache::forget(EvacuationCenterController::CACHE_KEY);

        return response()->json($center);
    }

    public function evacuationCentersDestroy($id)
    {
        $center = EvacuationCenter::find($id);

        if (!$center) {
            return response()->json(['message' => 'Evacuation center not found'], 404);
        }

        $center->delete();
        Cache::forget(EvacuationCenterController::CACHE_KEY);

        return response()->json(['message' => 'Evacuation center deleted successfully']);
    }

    public function uploadEvacuationCenterPhoto(Request $request)
    {
        $request->validate([
            'barangay_name' => 'required|string|exists:barangays,name',
            'photo'         => 'required|image|max:5120',
        ]);

        $destinationPath = public_path('uploads/evacuation');
        if (!file_exists($destinationPath)) {
            mkdir($destinationPath, 0755, true);
        }

        $photo     = $request->file('photo');
        $extension = $photo->getClientOriginalExtension();
        $filename  = \Illuminate\Support\Str::slug($request->barangay_name) . '_' . time() . '.' . $extension;
        $photo->move($destinationPath, $filename);

        $imagePath = '/uploads/evacuation/' . $filename;

        $record = \App\Models\EvacuationCenterPhoto::where('barangay_name', $request->barangay_name)->first();

        if ($record) {
            $oldFilePath = public_path($record->image_path);
            if (file_exists($oldFilePath) && is_file($oldFilePath)) {
                @unlink($oldFilePath);
            }
            $record->update(['image_path' => $imagePath]);
        } else {
            $record = \App\Models\EvacuationCenterPhoto::create([
                'barangay_name' => $request->barangay_name,
                'image_path'    => $imagePath,
            ]);
        }

        return response()->json([
            'message' => 'Evacuation center photo saved successfully.',
            'data'    => $record,
        ]);
    }

    public function deleteEvacuationCenterPhoto($barangay_name)
    {
        $record = \App\Models\EvacuationCenterPhoto::where('barangay_name', $barangay_name)->first();

        if (!$record) {
            return response()->json(['message' => 'No photo found for this barangay.'], 404);
        }

        $filePath = public_path($record->image_path);
        if (file_exists($filePath) && is_file($filePath)) {
            @unlink($filePath);
        }

        $record->delete();

        return response()->json(['message' => 'Evacuation center photo deleted successfully.']);
    }
}
