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
            'temperature' => 'nullable|numeric',
            'humidity' => 'nullable|numeric',
            'barangay_id' => 'required|integer'
        ]);

        $windSpeed    = $request->wind_speed;
        $rainfall     = $request->rainfall;
        $pressure     = $request->pressure;
        $temperature  = $request->temperature;
        $humidity     = $request->humidity;

        // AI Severity Scoring Logic
        $severity = $this->calculateSeverity($windSpeed, $rainfall, $pressure, $temperature, $humidity);

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
    private function calculateSeverity($windSpeed, $rainfall, $pressure, $temperature = null, $humidity = null)
    {
        $wind = (float) $windSpeed;
        $rain = (float) $rainfall;
        $pres = (float) $pressure;
        $temp = (float) ($temperature ?? 0);
        $humid = (float) ($humidity ?? 0);

        $windPct = min(100, max(0, round(($wind / 200) * 100)));
        $rainPct = min(100, max(0, round(($rain / 50) * 100)));
        $pressurePct = $pres > 0
            ? min(100, max(0, round(((1020 - $pres) / (1020 - 900)) * 100)))
            : 0;

        $tempDangerPct = 0;
        if ($temp > 0) {
            if ($temp < 20) {
                $tempDangerPct = round(((20 - $temp) / 20) * 60);
            } elseif ($temp <= 32) {
                $tempDangerPct = 0;
            } elseif ($temp <= 36) {
                $tempDangerPct = round((($temp - 32) / 4) * 60);
            } else {
                $tempDangerPct = min(100, round(60 + (($temp - 36) / 10) * 40));
            }
        }

        $humidDangerPct = 0;
        if ($humid >= 60 && $humid <= 75) {
            $humidDangerPct = round((($humid - 60) / 15) * 33);
        } elseif ($humid > 75 && $humid <= 90) {
            $humidDangerPct = round(33 + (($humid - 75) / 15) * 34);
        } elseif ($humid > 90) {
            $humidDangerPct = min(100, round(67 + (($humid - 90) / 10) * 33));
        }

        $score = round(
            $windPct * 0.30 +
            $rainPct * 0.30 +
            $pressurePct * 0.20 +
            $tempDangerPct * 0.10 +
            $humidDangerPct * 0.10
        );

        if ($score >= 75) return 'critical';
        if ($score >= 50) return 'high';
        if ($score >= 25) return 'moderate';
        return 'low';
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
