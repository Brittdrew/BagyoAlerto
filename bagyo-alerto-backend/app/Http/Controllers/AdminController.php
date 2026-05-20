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
        $severityCounts = TyphoonLog::selectRaw('severity_level, COUNT(*) as count')
            ->groupBy('severity_level')
            ->pluck('count', 'severity_level');

        return response()->json([
            'total_assessments' => TyphoonLog::count(),
            'severity_counts' => [
                'low' => (int) ($severityCounts['low'] ?? 0),
                'moderate' => (int) ($severityCounts['moderate'] ?? 0),
                'high' => (int) ($severityCounts['high'] ?? 0),
                'critical' => (int) ($severityCounts['critical'] ?? 0),
            ],
            'total_capacity' => (int) EvacuationCenter::sum('capacity'),
            'total_barangays' => Barangay::count(),
            'total_evacuation_centers' => EvacuationCenter::count(),
            'total_recommendations' => Recommendation::count(),
        ]);
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
