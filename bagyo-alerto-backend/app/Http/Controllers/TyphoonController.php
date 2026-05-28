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
    private function calculateSeverity($wind_speed, $rainfall, $pressure, $temperature = 30, $humidity = 85)
    {
        // Wind: calm baseline 30 km/h, extreme 220 km/h
        $windScore = min(max(($wind_speed - 30) / 190 * 100, 0), 100);

        // Pressure: 1013 hPa = safe baseline, dangerous below 970 hPa
        $pressureScore = min(max((1013 - $pressure) / 43 * 100, 0), 100);

        // Rainfall: 60 mm/hr = extreme
        $rainScore = min(max($rainfall / 60 * 100, 0), 100);

        // Humidity: 85% = PH ambient baseline, below 85% scores 0
        $humidityScore = min(max(($humidity - 85) / 15 * 100, 0), 100);

        // Temperature: only flags when cold inflow drops below 30°C
        $tempScore = min(max((30 - $temperature) / 6 * 100, 0), 100);

        // Weighted final score
        $score = ($windScore * 0.35)
               + ($pressureScore * 0.30)
               + ($rainScore * 0.20)
               + ($humidityScore * 0.10)
               + ($tempScore * 0.05);

        // Classification
        if ($score >= 55) return 'critical';
        if ($score >= 25) return 'high';
        if ($score >= 10) return 'moderate';
        return 'low';
    }

    private function getSeverityMessage($severity)
    {
        $messages = [
            'normal'  => 'No Tropical Cyclone Signal — Conditions are normal. No significant threat at this time.',
            'watch'   => 'Low Pressure Area / Tropical Cyclone Watch — Monitor weather updates closely. Prepare early precautions.',
            'typhoon' => 'Typhoon Signal Active — Destructive winds and heavy rainfall expected. Follow evacuation orders immediately.',
        ];
        return $messages[$severity] ?? 'Severity level unknown.';
    }
}
