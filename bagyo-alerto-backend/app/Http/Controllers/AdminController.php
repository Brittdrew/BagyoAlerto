<?php

namespace App\Http\Controllers;

use App\Models\Admin;
use App\Models\Barangay;
use App\Models\EvacuationCenter;
use App\Models\Recommendation;
use App\Models\TyphoonLog;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rule;
use Laravel\Sanctum\PersonalAccessToken;

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
                'id' => $admin->id,
                'name' => $admin->name,
                'username' => $admin->username,
            ],
        ]);
    }

    public function logout(Request $request)
    {
        $request->user()->currentAccessToken()->delete();

        return response()->json(['message' => 'Logged out successfully']);
    }

    public function me(Request $request)
    {
        $admin = $request->user();

        return response()->json([
            'id' => $admin->id,
            'name' => $admin->name,
            'username' => $admin->username,
            'created_at' => $admin->created_at,
        ]);
    }

    public function changePassword(Request $request)
    {
        $request->validate([
            'current_password' => 'required|string',
            'new_password' => 'required|string|min:6|confirmed',
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

    public function statsStream(Request $request)
    {
        $token = $request->query('token');
        if (!$token) {
            return response()->json(['message' => 'Unauthorized'], 401);
        }

        $accessToken = PersonalAccessToken::findToken($token);
        if (!$accessToken || !($accessToken->tokenable instanceof Admin)) {
            return response()->json(['message' => 'Unauthorized'], 401);
        }

        return response()->stream(function () {
            set_time_limit(0);
            ignore_user_abort(true);

            $previousPayload = null;

            while (!connection_aborted()) {
                $stats = $this->buildStats();
                $payload = json_encode($stats);

                if ($payload !== $previousPayload) {
                    echo "data: {$payload}\n\n";
                    ob_flush();
                    flush();
                    $previousPayload = $payload;
                } else {
                    echo ": keep-alive\n\n";
                    ob_flush();
                    flush();
                }

                sleep(2);
            }
        }, 200, [
            'Content-Type' => 'text/event-stream',
            'Cache-Control' => 'no-cache',
            'Connection' => 'keep-alive',
        ]);
    }

    private function buildStats(): array
    {
        $severityCounts = TyphoonLog::selectRaw('severity_level, COUNT(*) as count')
            ->groupBy('severity_level')
            ->pluck('count', 'severity_level');

        $severityScoreMap = [
            'low' => 1,
            'moderate' => 2,
            'high' => 3,
            'critical' => 4,
        ];

        $recentAssessmentSeries = TyphoonLog::query()
            ->orderByDesc('id')
            ->limit(12)
            ->get(['severity_level'])
            ->reverse()
            ->map(fn ($log) => $severityScoreMap[$log->severity_level] ?? 1)
            ->values()
            ->all();

        $recentAssessments = Recommendation::query()
            ->with(['barangay:id,name', 'typhoonLog:id,severity_level'])
            ->orderByDesc('id')
            ->limit(6)
            ->get()
            ->map(fn ($recommendation) => [
                'id' => $recommendation->id,
                'barangay_name' => $recommendation->barangay?->name ?? 'Unknown barangay',
                'severity_level' => $recommendation->typhoonLog?->severity_level ?? 'low',
            ])
            ->values()
            ->all();

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
            ->map(function ($recommendation) use ($recommendationCountsByCenter) {
                $capacity = (int) ($recommendation->evacuationCenter?->capacity ?? 0);
                $totalAssigned = (int) ($recommendationCountsByCenter[$recommendation->evacuation_center_id] ?? 0);

                if ($capacity <= 0) {
                    return 0;
                }

                return min(100, (int) round(($totalAssigned / $capacity) * 100));
            })
            ->values()
            ->all();

        return [
            'total_assessments' => TyphoonLog::count(),
            'severity_counts' => [
                'low' => (int) ($severityCounts['low'] ?? 0),
                'moderate' => (int) ($severityCounts['moderate'] ?? 0),
                'high' => (int) ($severityCounts['high'] ?? 0),
                'critical' => (int) ($severityCounts['critical'] ?? 0),
            ],
            'total_capacity' => (int) EvacuationCenter::where('is_active', 1)->sum('capacity'),
            'total_barangays' => Barangay::count(),
            'total_evacuation_centers' => EvacuationCenter::where('is_active', 1)->count(),
            'total_recommendations' => Recommendation::count(),
            'assessments_over_time' => $recentAssessmentSeries,
            'assessments_history' => $recentAssessmentSeries,
            'recent_assessments' => $recentAssessments,
            'capacity_trend' => $capacityTrend,
        ];
    }

    public function recommendations()
    {
        $recommendations = Recommendation::with(['barangay', 'evacuationCenter', 'typhoonLog'])
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

    public function barangaysIndex()
    {
        return response()->json(Barangay::orderBy('name')->get());
    }

    public function barangaysStore(Request $request)
    {
        $data = $request->validate([
            'name' => 'required|string|max:255',
            'city' => 'required|string|max:255',
            'latitude' => 'required|numeric',
            'longitude' => 'required|numeric',
            'risk_level' => ['required', Rule::in(['low', 'moderate', 'high', 'critical'])],
        ]);

        $barangay = Barangay::create($data);

        return response()->json($barangay, 201);
    }

    public function barangaysUpdate(Request $request, $id)
    {
        $barangay = Barangay::find($id);

        if (!$barangay) {
            return response()->json(['message' => 'Barangay not found'], 404);
        }

        $data = $request->validate([
            'name' => 'required|string|max:255',
            'city' => 'required|string|max:255',
            'latitude' => 'required|numeric',
            'longitude' => 'required|numeric',
            'risk_level' => ['required', Rule::in(['low', 'moderate', 'high', 'critical'])],
        ]);

        $barangay->update($data);

        return response()->json($barangay);
    }

    public function barangaysDestroy($id)
    {
        $barangay = Barangay::find($id);

        if (!$barangay) {
            return response()->json(['message' => 'Barangay not found'], 404);
        }

        $barangay->delete();

        return response()->json(['message' => 'Barangay deleted successfully']);
    }

    public function evacuationCentersIndex()
    {
        return response()->json(
            EvacuationCenter::with('barangay')->orderBy('name')->get()
        );
    }

    public function evacuationCentersStore(Request $request)
    {
        $data = $request->validate([
            'name' => 'required|string|max:255',
            'barangay_id' => 'required|integer|exists:barangays,id',
            'address' => 'required|string|max:500',
            'latitude' => 'required|numeric',
            'longitude' => 'required|numeric',
            'capacity' => 'required|integer|min:1',
            'is_active' => 'required|boolean',
        ]);

        $center = EvacuationCenter::create($data);
        $center->load('barangay');

        return response()->json($center, 201);
    }

    public function evacuationCentersUpdate(Request $request, $id)
    {
        $center = EvacuationCenter::find($id);

        if (!$center) {
            return response()->json(['message' => 'Evacuation center not found'], 404);
        }

        $data = $request->validate([
            'name' => 'required|string|max:255',
            'barangay_id' => 'required|integer|exists:barangays,id',
            'address' => 'required|string|max:500',
            'latitude' => 'required|numeric',
            'longitude' => 'required|numeric',
            'capacity' => 'required|integer|min:1',
            'is_active' => 'required|boolean',
        ]);

        $center->update($data);
        $center->load('barangay');

        return response()->json($center);
    }

    public function evacuationCentersDestroy($id)
    {
        $center = EvacuationCenter::find($id);

        if (!$center) {
            return response()->json(['message' => 'Evacuation center not found'], 404);
        }

        $center->delete();

        return response()->json(['message' => 'Evacuation center deleted successfully']);
    }
}
