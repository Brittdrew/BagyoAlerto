<?php

namespace App\Http\Controllers;

use App\Models\Recommendation;
use Illuminate\Http\Request;

class RecommendationController extends Controller
{
    public function index()
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

    public function store(Request $request)
    {
        $recommendation = Recommendation::create($request->all());
        return response()->json($recommendation, 201);
    }

    public function destroy($id)
    {
        $recommendation = Recommendation::find($id);

        if (!$recommendation) {
            return response()->json(['message' => 'Recommendation not found'], 404);
        }

        $recommendation->delete();

        return response()->json(['message' => 'Recommendation deleted successfully']);
    }
}