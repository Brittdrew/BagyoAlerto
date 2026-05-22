<?php

namespace App\Http\Controllers;

use App\Models\TyphoonLog;
use App\Models\EvacuationCenter;
use App\Models\Recommendation;
use App\Models\Barangay;
use Illuminate\Http\Request;

class TyphoonController extends Controller
{
    public function assess(Request $request)
    {
        $request->validate([
            'wind_speed' => 'required|numeric',
            'rainfall'   => 'required|numeric',
            'pressure'   => 'required|numeric',
            'barangay_id' => 'required|integer'
        ]);

        $windSpeed    = $request->wind_speed;
        $rainfall     = $request->rainfall;
        $pressure     = $request->pressure;
        $temperature  = $request->temperature;
        $humidity     = $request->humidity;

        // AI Severity Scoring Logic
        $severity = $this->calculateSeverity($windSpeed, $rainfall, $pressure);

        // Log the typhoon data
        $log = TyphoonLog::create([
            'wind_speed'     => $windSpeed,
            'rainfall'       => $rainfall,
            'pressure'       => $pressure,
            'temperature'    => $temperature,
            'humidity'       => $humidity,
            'severity_level' => $severity
        ]);

        $barangay = Barangay::find($request->barangay_id);
        $center = null;

        // Pick the nearest active evacuation center to the selected barangay
        if ($barangay) {
            $center = EvacuationCenter::where('is_active', true)
                ->withCount('recommendations')
                ->get()
                ->map(function ($evacuationCenter) use ($barangay) {
                    $distance = $evacuationCenter->getDistanceTo($barangay->latitude, $barangay->longitude);
                    $evacuationCenter->distance = $distance;
                    return $evacuationCenter;
                })
                ->sortBy(function ($evacuationCenter) {
                    return $evacuationCenter->distance;
                })
                ->first();
        }

        // Save recommendation
        if ($center) {
            Recommendation::create([
                'barangay_id'          => $request->barangay_id,
                'evacuation_center_id' => $center->id,
                'typhoon_log_id'       => $log->id
            ]);

            if ($barangay && !isset($center->distance)) {
                $center->distance = $center->getDistanceTo($barangay->latitude, $barangay->longitude);
            }
        }

        return response()->json([
            'severity'          => $severity,
            'message'           => $this->getSeverityMessage($severity),
            'evacuation_center' => $center
        ]);
    }

    // AI Scoring Function
    private function calculateSeverity($windSpeed, $rainfall, $pressure)
    {
        if ($windSpeed > 220) {
            return 'critical'; // Signal #5
        } elseif ($windSpeed >= 171) {
            return 'critical'; // Signal #4
        } elseif ($windSpeed >= 121) {
            return 'high';     // Signal #3
        } elseif ($windSpeed >= 61) {
            return 'moderate'; // Signal #2
        } elseif ($windSpeed >= 30) {
            return 'low';      // Signal #1
        } else {
            return 'low';      // No signal
        }
    }

    private function getSeverityMessage($severity)
    {
        $messages = [
            'low'      => 'PAGASA Signal #1 — Tropical cyclone winds expected within 36 hours. Stay alert and monitor updates.',
            'moderate' => 'PAGASA Signal #2 — Destructive winds expected within 24 hours. Prepare for possible evacuation.',
            'high'     => 'PAGASA Signal #3 — Very destructive winds expected within 18 hours. Evacuate now!',
            'critical' => 'PAGASA Signal #4-5 — Catastrophic winds expected within 12 hours. IMMEDIATE EVACUATION REQUIRED!',
        ];
        return $messages[$severity];
    }
}
