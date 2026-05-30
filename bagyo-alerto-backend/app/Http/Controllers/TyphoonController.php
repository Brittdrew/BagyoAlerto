<?php

namespace App\Http\Controllers;

use App\Models\TyphoonLog;
use App\Models\EvacuationCenter;
use App\Models\Recommendation;
use App\Models\Barangay;
use App\Services\TyphoonMLService;
use Illuminate\Http\Request;

class TyphoonController extends Controller
{
    public function assess(Request $request)
    {
        $request->validate([
            'wind_speed'   => 'required|numeric',
            'rainfall'     => 'required|numeric',
            'pressure'     => 'required|numeric',
            'temperature'  => 'nullable|numeric',
            'humidity'     => 'nullable|numeric',
            'barangay_id'  => 'required|integer'
        ]);

        $windSpeed   = $request->wind_speed;
        $rainfall    = $request->rainfall;
        $pressure    = $request->pressure;
        $temperature = $request->temperature ?? 30;
        $humidity    = $request->humidity ?? 85;

        // Rule-Based Severity Scoring
        list($severity, $score, $rank) = $this->calculateSeverity(
            $windSpeed, $rainfall, $pressure, $temperature, $humidity
        );

        // Rule-based label — now uses same labels as ML
        $classification = $this->getClassificationLabel($rank);

        $weatherData = [
            'wind'     => $windSpeed,
            'rain'     => $rainfall,
            'pressure' => $pressure,
            'temp'     => $temperature,
            'humidity' => $humidity,
        ];

        // ML Prediction
        $ml = new TyphoonMLService();
        $mlPrediction  = $ml->predict(
            $weatherData['wind'],
            $weatherData['rain'],
            $weatherData['pressure'],
            $weatherData['temp'],
            $weatherData['humidity']
        );
        $mlExplanation = $ml->getConfidence($mlPrediction);

        // Check if rule-based and ML agree
        $agreement = $this->checkAgreement($classification, $mlPrediction);

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
        $center   = null;

        // Pick the nearest active evacuation center to the selected barangay
        if ($barangay) {
            $center = EvacuationCenter::where('is_active', true)
                ->withCount('recommendations')
                ->get()
                ->map(function ($evacuationCenter) use ($barangay) {
                    $distance = $evacuationCenter->getDistanceTo(
                        $barangay->latitude,
                        $barangay->longitude
                    );
                    $evacuationCenter->distance = $distance;
                    return $evacuationCenter;
                })
                ->sortBy(fn($ec) => $ec->distance)
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
                $center->distance = $center->getDistanceTo(
                    $barangay->latitude,
                    $barangay->longitude
                );
            }
        }

        return response()->json([
            'severity'          => $severity,
            'score'             => $score,
            'weather'           => $weatherData,
            'classification'    => $classification,   // Rule-based signal label
            'ml_prediction'     => $mlPrediction,     // ML signal label
            'ml_explanation'    => $mlExplanation,
            'agreement'         => $agreement,         // Do both systems agree?
            'message'           => $this->getSeverityMessage($rank),
            'evacuation_center' => $center
        ]);
    }

    /**
     * Rule-Based Severity Scoring
     *
     * Ranks 0-7 now match PAGASA signal labels exactly:
     *   0 = Normal
     *   1 = Watch
     *   2 = Elevated
     *   3 = Signal 1
     *   4 = Signal 2
     *   5 = Signal 3
     *   6 = Signal 4
     *   7 = Signal 5
     *
     * This matches the ML model labels so both systems can be compared directly.
     */
    private function calculateSeverity($wind_speed, $rainfall, $pressure, $temperature = 30, $humidity = 85)
    {
        // --- Individual Factor Scores (0–100) ---

        // Wind: calm baseline 30 km/h, extreme 350 km/h
        $windScore = min(max(($wind_speed - 30) / 320 * 100, 0), 100);

        // Pressure: 1013 hPa = safe, 920 hPa = supertyphoon
        $pressureScore = min(max((1013 - $pressure) / 93 * 100, 0), 100);

        // Rainfall: 60 mm/hr = extreme
        $rainScore = min(max($rainfall / 60 * 100, 0), 100);

        // Humidity: above 85% PH baseline
        $humidityScore = min(max(($humidity - 85) / 15 * 100, 0), 100);

        // Temperature: cold inflow below 30°C
        $tempScore = min(max((30 - $temperature) / 10 * 100, 0), 100);

        // --- Weighted Composite Score ---
        // Wind is the primary PAGASA factor (35%)
        // Pressure is secondary (30%)
        // Rainfall tertiary (20%)
        $score = ($windScore     * 0.35)
               + ($pressureScore * 0.30)
               + ($rainScore     * 0.20)
               + ($humidityScore * 0.10)
               + ($tempScore     * 0.05);

        $score = (int) round($score);

        // --- Initial Rank from Score ---
        if ($score <= 10) {
            $rank = 0; // Normal
        } elseif ($score <= 22) {
            $rank = 1; // Watch
        } elseif ($score <= 35) {
            $rank = 2; // Elevated
        } elseif ($score <= 50) {
            $rank = 3; // Signal 1
        } elseif ($score <= 65) {
            $rank = 4; // Signal 2
        } elseif ($score <= 78) {
            $rank = 5; // Signal 3
        } elseif ($score <= 90) {
            $rank = 6; // Signal 4
        } else {
            $rank = 7; // Signal 5
        }

        // --- Hard Wind Overrides (PAGASA official thresholds) ---
        // Wind speed can only RAISE the rank, never lower it.
        // These match the exact same thresholds used in TyphoonMLService.
        if ($wind_speed >= 221) {
            $rank = max($rank, 7); // Signal 5
        } elseif ($wind_speed >= 171) {
            $rank = max($rank, 6); // Signal 4
        } elseif ($wind_speed >= 121) {
            $rank = max($rank, 5); // Signal 3
        } elseif ($wind_speed >= 90) {
            $rank = max($rank, 4); // Signal 2
        } elseif ($wind_speed >= 60) {
            $rank = max($rank, 3); // Signal 1
        } elseif ($wind_speed >= 45) {
            $rank = max($rank, 2); // Elevated
        } elseif ($wind_speed >= 30) {
            $rank = max($rank, 1); // Watch
        }

        // --- Rainfall Overrides ---
        if ($rainfall >= 30) {
            $rank = max($rank, 3); // minimum Signal 1
        } elseif ($rainfall >= 7.5) {
            $rank = max($rank, 2); // minimum Elevated
        }

        // --- Pressure Overrides ---
        if ($pressure <= 960) {
            $rank = max($rank, 5); // minimum Signal 3
        } elseif ($pressure <= 975) {
            $rank = max($rank, 4); // minimum Signal 2
        } elseif ($pressure <= 990) {
            $rank = max($rank, 3); // minimum Signal 1
        } elseif ($pressure <= 1005) {
            $rank = max($rank, 1); // minimum Watch
        }

        // --- Map Rank to Severity String ---
        if ($rank === 0) {
            $severity = 'low';
        } elseif ($rank <= 2) {
            $severity = 'moderate';
        } elseif ($rank <= 4) {
            $severity = 'high';
        } elseif ($rank <= 5) {
            $severity = 'critical';
        } else {
            $severity = 'catastrophic';
        }

        return [$severity, $score, $rank];
    }

    /**
     * Convert numeric rank to PAGASA signal label.
     * These labels now match TyphoonMLService exactly so both can be compared.
     */
    private function getClassificationLabel($rank): string
    {
        $map = [
            0 => 'Normal',
            1 => 'Watch',
            2 => 'Elevated',
            3 => 'Signal 1',
            4 => 'Signal 2',
            5 => 'Signal 3',
            6 => 'Signal 4',
            7 => 'Signal 5',
        ];

        return $map[$rank] ?? 'Normal';
    }

    /**
     * Check if rule-based and ML prediction agree.
     * Returns agreement status and difference level.
     */
    private function checkAgreement(string $ruleLabel, string $mlLabel): array
    {
        $ranks = [
            'Normal'   => 0,
            'Watch'    => 1,
            'Elevated' => 2,
            'Signal 1' => 3,
            'Signal 2' => 4,
            'Signal 3' => 5,
            'Signal 4' => 6,
            'Signal 5' => 7,
        ];

        $ruleRank = $ranks[$ruleLabel] ?? 0;
        $mlRank   = $ranks[$mlLabel]   ?? 0;
        $diff     = abs($ruleRank - $mlRank);

        return [
            'match'      => $diff === 0,
            'difference' => $diff,
            'status'     => $diff === 0
                                ? 'Both systems agree'
                                : ($diff === 1
                                    ? 'Minor difference (1 level)'
                                    : 'Warning: Systems disagree by ' . $diff . ' levels'),
        ];
    }

    private function getSeverityMessage($rank): string
    {
        return match(true) {
            $rank === 0 => 'No Tropical Cyclone Signal — Conditions are normal. No significant threat at this time.',
            $rank <= 2  => 'Low Pressure Area / Tropical Cyclone Watch — Monitor weather updates closely. Prepare early precautions.',
            $rank <= 4  => 'Typhoon Signal Active — Destructive winds and heavy rainfall expected. Follow evacuation orders immediately.',
            default     => 'Supertyphoon Warning — Catastrophic and life-threatening conditions. Evacuate now.',
        };
    }
}