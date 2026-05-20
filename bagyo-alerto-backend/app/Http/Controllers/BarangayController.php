<?php

namespace App\Http\Controllers;

use App\Models\Barangay;
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
}