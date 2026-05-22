<?php

namespace App\Http\Controllers;

use App\Models\EvacuationCenter;
use Illuminate\Http\Request;

class EvacuationCenterController extends Controller
{
    public function index()
    {
        return response()->json(EvacuationCenter::with('barangay')->get());
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
            return response()->json(['message' => 'No photo found for this barangay'], 404);
        }
        return response()->json($photo);
    }
}