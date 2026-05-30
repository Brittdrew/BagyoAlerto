<?php

namespace App\Http\Controllers;

use App\Models\Barangay;
use App\Models\EvacuationCenter;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;

class ChatController extends Controller
{
    public function ask(Request $request)
    {
        $request->validate([
            'question' => 'required|string|max:500',
        ]);

        $question = $request->question;

        // Step 1: Extract barangay name from question
        $matched = $this->extractBarangay($question);

        // If no barangay found, return not found response
        if (!$matched) {
            \Log::warning("Barangay not found for question: {$question}");
            return response()->json([
                'response' => $this->generateNotFoundResponse(),
                'barangay_id' => null,
                'intent' => 'not_found'
            ]);
        }

        // DEBUG: Log barangay details
        \Log::info("Barangay found: {$matched->name}");
        \Log::info("Barangay data: " . json_encode($matched->toArray()));
        \Log::info("Coordinates: lat={$matched->latitude}, lng={$matched->longitude}");

        // Validate coordinates exist
        if (empty($matched->latitude) || empty($matched->longitude)) {
            \Log::error("Missing coordinates for barangay {$matched->name}");
            return response()->json([
                'response' => "I found {$matched->name} but its coordinates are not set in the system. Please update the barangay coordinates.",
                'barangay_id' => $matched->id,
                'barangay_name' => $matched->name,
                'error' => 'missing_coordinates'
            ]);
        }

        // Step 2: Detect question intent
        $intent = $this->detectIntent($question);

        // Step 3: Fetch weather data for the barangay
        $weatherData = $this->fetchWeatherData($matched);

        // Step 4: Calculate severity
        list($severity, $rank) = $this->calculateSeverityLevel($weatherData);

        // Step 5: Get evacuation center if needed
        $evacuationCenter = null;
        if ($rank >= 3) {
            $evacuationCenter = $this->getNearestEvacuationCenter($matched);
        }

        // Step 6: Generate response based on intent and severity
        $response = $this->generateResponse(
            $intent,
            $severity,
            $rank,
            $matched,
            $weatherData,
            $evacuationCenter
        );

        return response()->json([
            'response' => $response,
            'barangay_id' => $matched->id,
            'barangay_name' => $matched->name,
            'intent' => $intent,
            'severity' => $severity,
            'weather_data' => $weatherData
        ]);
    }

    /**
     * Extract barangay name from question using keyword matching
     */
    private function extractBarangay($question)
    {
        $barangays = Barangay::all();

        foreach ($barangays as $barangay) {
            // Case-insensitive substring match
            if (stripos($question, $barangay->name) !== false) {
                return $barangay;
            }
        }

        return null;
    }

    /**
     * Detect intent from question keywords
     */
    private function detectIntent($question)
    {
        $question = strtolower($question);

        $intents = [
            'safety'   => ['safe', 'danger', 'dangerous', 'risk', 'okay', 'ok', 'is it safe', 'how safe'],
            'wind'     => ['wind', 'winds', 'windy', 'storm', 'speed', 'wind speed'],
            'rain'     => ['rain', 'rainfall', 'flood', 'flooding', 'raining'],
            'signal'   => ['signal', 'pagasa', 'typhoon', 'bagyo', 'class suspend', 'tc signal'],
            'evac'     => ['evacuate', 'evacuation', 'evac', 'shelter', 'center', 'should i evac'],
            'general'  => ['weather', 'condition', 'status', 'update', 'how is'],
        ];

        // Check for each intent's keywords
        foreach ($intents as $intent => $keywords) {
            foreach ($keywords as $keyword) {
                if (strpos($question, $keyword) !== false) {
                    return $intent;
                }
            }
        }

        return 'general';
    }

    /**
     * Fetch weather data from Open-Meteo API for the barangay
     * ALWAYS fetches LIVE data - this is critical for Q&A accuracy
     */
    private function fetchWeatherData($barangay)
    {
        try {
            // Validate coordinates
            $lat = (float) $barangay->latitude;
            $lng = (float) $barangay->longitude;

            \Log::info("Fetching weather for {$barangay->name}: lat={$lat}, lng={$lng}");

            // Build URL manually for debugging
            $url = "https://api.open-meteo.com/v1/forecast"
                . "?latitude={$lat}"
                . "&longitude={$lng}"
                . "&current=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m"
                . "&timezone=auto";

            \Log::info("Open-Meteo API URL: {$url}");

            // Make HTTP request to Open-Meteo API with timeout
            // NOTE: Using query parameters array format
            $response = Http::timeout(10)->get('https://api.open-meteo.com/v1/forecast', [
                'latitude' => $lat,
                'longitude' => $lng,
                'current' => 'temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m',
                'timezone' => 'auto',
            ]);

            \Log::info("Open-Meteo HTTP Status: {$response->status()}");
            \Log::info("Open-Meteo Response Body: " . substr($response->body(), 0, 500)); // First 500 chars

            // Check if response was successful (200-299)
            if (!$response->successful()) {
                \Log::error("Open-Meteo API error for {$barangay->name}: HTTP {$response->status()}");
                \Log::error("Open-Meteo Error Response: " . $response->body());
                return $this->getDefaultWeatherData();
            }

            // Parse JSON response
            $data = $response->json();

            // Validate response structure
            if (!isset($data['current']) || !is_array($data['current'])) {
                \Log::warning("Invalid Open-Meteo response structure for {$barangay->name}");
                \Log::warning("Response: " . json_encode($data));
                return $this->getDefaultWeatherData();
            }

            $current = $data['current'];

            // Extract and validate each field
            $windSpeed = isset($current['wind_speed_10m']) ? (float) $current['wind_speed_10m'] : 0;
            $rainfall = isset($current['precipitation']) ? (float) $current['precipitation'] : 0;
            $temperature = isset($current['temperature_2m']) ? (float) $current['temperature_2m'] : 30;
            $humidity = isset($current['relative_humidity_2m']) ? (int) $current['relative_humidity_2m'] : 85;

            // Log successful fetch for debugging
            \Log::info("✓ Open-Meteo SUCCESS for {$barangay->name}: wind={$windSpeed} km/h, rain={$rainfall} mm/hr, temp={$temperature}°C, humidity={$humidity}%");

            return [
                'wind_speed' => $windSpeed,
                'rainfall' => $rainfall,
                'temperature' => $temperature,
                'humidity' => $humidity,
                'pressure' => 1013, // Open-Meteo doesn't provide current pressure; use standard
            ];

        } catch (\Exception $e) {
            // Log the actual exception for debugging
            \Log::error("Open-Meteo API exception for {$barangay->name}: " . $e->getMessage());
            \Log::error("Exception trace: " . $e->getTraceAsString());
            return $this->getDefaultWeatherData();
        }
    }

    /**
     * Get default weather data fallback
     * Only used if API fails - should be rare
     */
    private function getDefaultWeatherData()
    {
        return [
            'wind_speed' => 0,
            'rainfall' => 0,
            'temperature' => 30,
            'humidity' => 85,
            'pressure' => 1013,
        ];
    }

    /**
     * Calculate severity level using the same logic as TyphoonController
     */
    private function calculateSeverityLevel($weatherData)
    {
        $windSpeed = $weatherData['wind_speed'];
        $rainfall = $weatherData['rainfall'];
        $pressure = $weatherData['pressure'];
        $temperature = $weatherData['temperature'];
        $humidity = $weatherData['humidity'];

        // Wind: calm baseline 30 km/h, extreme 220 km/h
        $windScore = min(max(($windSpeed - 30) / 190 * 100, 0), 100);

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

        $score = (int) round($score);

        // Initial Classification Rank based on Score
        if ($score <= 24) {
            $rank = 0;
        } elseif ($score <= 39) {
            $rank = 1;
        } elseif ($score <= 54) {
            $rank = 2;
        } elseif ($score <= 70) {
            $rank = 3;
        } elseif ($score <= 85) {
            $rank = 4;
        } else {
            $rank = 5;
        }

        // Hard overrides — only upgrade, never downgrade
        if ($windSpeed >= 220) {
            $rank = max($rank, 5); // force "Signal 4-5"
        } elseif ($windSpeed >= 120) {
            $rank = max($rank, 4); // force minimum "Signal 2-3"
        } elseif ($windSpeed >= 60) {
            $rank = max($rank, 3); // force minimum "Signal 1"
        } elseif ($windSpeed >= 45) {
            $rank = max($rank, 2); // force minimum "Elevated"
        }

        if ($rainfall >= 30) {
            $rank = max($rank, 3); // force minimum "Signal 1"
        } elseif ($rainfall >= 7.5) {
            $rank = max($rank, 2); // force minimum "Elevated"
        }

        if ($pressure <= 970) {
            $rank = max($rank, 3); // force minimum "Signal 1"
        } elseif ($pressure <= 990) {
            $rank = max($rank, 1); // force minimum "Watch"
        }

        // Map rank to severity
        if ($rank === 0) {
            $severity = 'Normal';
        } elseif ($rank === 1) {
            $severity = 'Watch';
        } elseif ($rank === 2) {
            $severity = 'Elevated';
        } elseif ($rank === 3) {
            $severity = 'Signal 1';
        } elseif ($rank === 4) {
            $severity = 'Signal 2-3';
        } else {
            $severity = 'Signal 4-5';
        }

        return [$severity, $rank];
    }

    /**
     * Get nearest evacuation center to barangay
     */
    private function getNearestEvacuationCenter($barangay)
    {
        $center = EvacuationCenter::where('is_active', true)
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

        return $center;
    }

    /**
     * Generate natural language response based on intent and severity
     */
    private function generateResponse($intent, $severity, $rank, $barangay, $weatherData, $evacuationCenter)
    {
        $templates = [
            'safety' => [
                'Normal'   => "{barangay} is currently safe. Weather conditions are normal with wind at {wind} km/h and no significant rainfall.",
                'Watch'    => "{barangay} is under Watch level. A low pressure area is nearby. Monitor updates from PAGASA.",
                'Elevated' => "{barangay} conditions are elevated. Wind is at {wind} km/h. Prepare emergency supplies.",
                'Signal 1' => "{barangay} is under Typhoon Signal 1. Wind has reached {wind} km/h. Classes are suspended. Stay indoors.",
                'Signal 2-3' => "{barangay} is under Typhoon Signal 2-3. Wind is at {wind} km/h. This is dangerous — evacuate if instructed.",
                'Signal 4-5' => "{barangay} is under Typhoon Signal 4-5. EVACUATE IMMEDIATELY. Do not go outside.",
            ],
            'wind' => [
                'Normal'   => "Wind in {barangay} is currently {wind} km/h — light and safe.",
                'Watch'    => "Wind in {barangay} is {wind} km/h — monitor closely.",
                'Elevated' => "Wind in {barangay} is {wind} km/h — strengthening. Prepare precautions.",
                'Signal 1' => "Wind in {barangay} has reached {wind} km/h, triggering Typhoon Signal 1.",
                'Signal 2-3' => "Wind in {barangay} is at {wind} km/h — destructive typhoon winds.",
                'Signal 4-5' => "Wind in {barangay} is at {wind} km/h — EXTREME AND DANGEROUS.",
            ],
            'rain' => [
                'Normal'   => "There is no rainfall in {barangay} right now. Conditions are dry.",
                'Watch'    => "Light rain is expected in {barangay}. Monitor weather updates.",
                'Elevated' => "Rainfall in {barangay} is {rain} mm/hr. Avoid low-lying areas.",
                'Signal 1' => "Heavy rain is occurring in {barangay} at {rain} mm/hr. Flooding is possible.",
                'Signal 2-3' => "Heavy rain in {barangay} at {rain} mm/hr. Avoid all flood-prone areas.",
                'Signal 4-5' => "Extreme rainfall in {barangay} at {rain} mm/hr. Flash floods are likely.",
            ],
            'signal' => [
                'Normal'   => "{barangay} is under No Tropical Cyclone Signal. Conditions are normal.",
                'Watch'    => "{barangay} is under Tropical Cyclone Watch. Monitor PAGASA updates closely.",
                'Elevated' => "{barangay} is on Elevated Alert. Prepare precautions. Monitor updates.",
                'Signal 1' => "{barangay} is under Typhoon Signal 1. Wind is {wind} km/h. Classes suspended.",
                'Signal 2-3' => "{barangay} is under Typhoon Signal 2-3. Wind is {wind} km/h. Destructive conditions.",
                'Signal 4-5' => "{barangay} is under Typhoon Signal 4-5. This is CATASTROPHIC. EVACUATE NOW.",
            ],
            'evac' => [
                'Normal'   => "No evacuation needed in {barangay}. Conditions are normal.",
                'Watch'    => "No evacuation needed yet in {barangay}. Nearest center: {evac_center} ({distance} km away).",
                'Elevated' => "Residents in flood-prone areas of {barangay} should prepare to evacuate. Nearest center: {evac_center} ({distance} km away).",
                'Signal 1' => "Prepare to evacuate from {barangay}. Nearest center: {evac_center} ({distance} km away).",
                'Signal 2-3' => "EVACUATE NOW from {barangay} to {evac_center}, {distance} km away.",
                'Signal 4-5' => "EVACUATE IMMEDIATELY from {barangay} to {evac_center}. Do not delay.",
            ],
            'general' => [
                'Normal'   => "{barangay} is under normal weather conditions. Wind: {wind} km/h, Rainfall: {rain} mm/hr.",
                'Watch'    => "{barangay} is under Watch status. A low pressure system is being monitored.",
                'Elevated' => "{barangay} is at Elevated Alert. Wind: {wind} km/h, Rainfall: {rain} mm/hr.",
                'Signal 1' => "{barangay} is under Typhoon Signal 1. Wind: {wind} km/h, Rainfall: {rain} mm/hr.",
                'Signal 2-3' => "{barangay} is under Typhoon Signal 2-3. Wind: {wind} km/h, Rainfall: {rain} mm/hr.",
                'Signal 4-5' => "{barangay} is under Typhoon Signal 4-5 — CATASTROPHIC. EVACUATE IMMEDIATELY.",
            ],
        ];

        // Get the appropriate template
        $templateSet = $templates[$intent] ?? $templates['general'];
        $template = $templateSet[$severity] ?? reset($templateSet);

        // Replace placeholders
        $response = str_replace('{barangay}', $barangay->name, $template);
        $response = str_replace('{wind}', round($weatherData['wind_speed'], 1), $response);
        $response = str_replace('{rain}', round($weatherData['rainfall'], 1), $response);

        if ($evacuationCenter) {
            $response = str_replace('{evac_center}', $evacuationCenter->name, $response);
            $response = str_replace('{distance}', round($evacuationCenter->distance, 1), $response);
        }

        return $response;
    }

    /**
     * Generate response when barangay not found
     */
    private function generateNotFoundResponse()
    {
        $barangays = Barangay::pluck('name')->take(5)->toArray();
        $barangayList = implode(', ', $barangays);

        return "I couldn't find that barangay in the system. Please check the barangay name and try again. Some available barangays: {$barangayList}.";
    }
}
