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
            return EvacuationCenter::with('barangay')->get()->toArray();
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
}