<?php

namespace App\Http\Controllers;

use App\Models\Barangay;
use App\Models\EvacuationCenter;
use App\Models\ChatLog;
use App\Services\OllamaService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

class ChatController extends Controller
{
    private OllamaService $ollama;

    public function __construct(OllamaService $ollama)
    {
        $this->ollama = $ollama;
    }
    public function ask(Request $request)
    {
        $request->validate([
            'question'      => 'required|string|max:500',
            'last_barangay' => 'nullable|string|max:100',
        ]);

        $question     = $request->question;
        $lastBarangay = $request->last_barangay;

        // Step 1: Check if it's a general typhoon knowledge question first
        $generalResponse = $this->handleGeneralQuestion($question);
        if ($generalResponse) {
            ChatLog::create([
                'barangay_name' => null,
                'question'      => $question,
                'answer'        => $generalResponse,
                'severity'      => null,
                'wind'          => null,
                'rainfall'      => null,
                'pressure'      => null,
                'temperature'   => null,
                'humidity'      => null,
                'asked_by'      => 'admin',
            ]);
            return response()->json([
                'response'      => $generalResponse,
                'barangay_id'   => null,
                'barangay_name' => null,
                'severity'      => null,
                'intent'        => 'knowledge',
            ]);
        }

        // Step 2: Extract barangay name from question text
        $matched = $this->extractBarangay($question);

        // Step 2b: No barangay in question — try context memory from last message
        if (!$matched && $lastBarangay) {
            $matched = Barangay::select('id', 'name', 'latitude', 'longitude')
                ->where('name', $lastBarangay)
                ->first();

            if ($matched) {
                Log::info("Using context barangay: {$matched->name}");
            }
        }

        // Step 2c: Still no match — return helpful not-found response
        if (!$matched) {
            Log::warning("Barangay not found for question: {$question}");
            $notFoundResponse = $this->generateNotFoundResponse();
            ChatLog::create([
                'barangay_name' => null,
                'question'      => $question,
                'answer'        => $notFoundResponse,
                'severity'      => null,
                'wind'          => null,
                'rainfall'      => null,
                'pressure'      => null,
                'temperature'   => null,
                'humidity'      => null,
                'asked_by'      => 'admin',
            ]);
            return response()->json([
                'response'      => $notFoundResponse,
                'barangay_id'   => null,
                'barangay_name' => null,
                'severity'      => null,
                'intent'        => 'not_found',
            ]);
        }

        Log::info("Barangay matched: {$matched->name}");

        // Validate coordinates exist
        if (empty($matched->latitude) || empty($matched->longitude)) {
            $errResponse = "I found {$matched->name} but its coordinates are not set in the system. Please update the barangay coordinates.";
            ChatLog::create([
                'barangay_name' => $matched->name,
                'question'      => $question,
                'answer'        => $errResponse,
                'severity'      => null,
                'wind'          => null,
                'rainfall'      => null,
                'pressure'      => null,
                'temperature'   => null,
                'humidity'      => null,
                'asked_by'      => 'admin',
            ]);
            return response()->json([
                'response'      => $errResponse,
                'barangay_id'   => $matched->id,
                'barangay_name' => $matched->name,
                'severity'      => null,
                'intent'        => 'error',
                'error'         => 'missing_coordinates',
            ]);
        }

        // Step 3: Detect question intent
        $intent = $this->detectIntent($question);

        // Step 4: Fetch weather data — cached 5 minutes per barangay
        $weatherData = Cache::remember(
            "weather_barangay_{$matched->id}",
            300,
            fn () => $this->fetchWeatherData($matched)
        );

        // Step 5: Calculate severity
        [$severity, $rank] = $this->calculateSeverityLevel($weatherData);

        // Step 6: Get evacuation center if severity is high enough OR intent is evacuation query
        $evacuationCenter = null;
        if ($rank >= 3 || $intent === 'evac') {
            $evacuationCenter = $this->getNearestEvacuationCenter($matched);
        }

        // Step 7: For evacuation intent, always use the template (it has real DB data).
        // For other intents, try Ollama first — fall back to template if unavailable.
        $aiPowered = false;
        $response  = null;

        if ($intent !== 'evac' && $this->ollama->isAvailable()) {
            $systemPrompt = $this->ollama->buildTyphoonSystemPrompt(
                $matched->name,
                $weatherData,
                $severity,
                $evacuationCenter  // Pass DB evacuation center so Ollama can reference it
            );
            $response  = $this->ollama->chat($systemPrompt, $question);
            $aiPowered = $response !== null;
        }

        // Always use template for evac intent (guaranteed real DB data),
        // or as fallback if Ollama is down or returned nothing
        if (!$response) {
            $response = $this->generateResponse(
                $intent, $severity, $rank, $matched, $weatherData, $evacuationCenter
            );
        }

        // Save normal Q&A conversation
        ChatLog::create([
            'barangay_name' => $matched->name,
            'question'      => $question,
            'answer'        => $response,
            'severity'      => $severity,
            'wind'          => $weatherData['wind_speed'] ?? null,
            'rainfall'      => $weatherData['rainfall'] ?? null,
            'pressure'      => $weatherData['pressure'] ?? null,
            'temperature'   => $weatherData['temperature'] ?? null,
            'humidity'      => $weatherData['humidity'] ?? null,
            'asked_by'      => 'admin',
        ]);

        return response()->json([
            'response'      => $response,
            'barangay_id'   => $matched->id,
            'barangay_name' => $matched->name,
            'intent'        => $intent,
            'severity'      => $severity,
            'weather_data'  => $weatherData,
            'ai_powered'    => $aiPowered,
            'barangay'      => [
                'id'        => $matched->id,
                'name'      => $matched->name,
                'latitude'  => (float) $matched->latitude,
                'longitude' => (float) $matched->longitude,
            ],
            'evacuation_center' => $evacuationCenter ? [
                'id'        => $evacuationCenter->id,
                'name'      => $evacuationCenter->name,
                'address'   => $evacuationCenter->address,
                'latitude'  => (float) $evacuationCenter->latitude,
                'longitude' => (float) $evacuationCenter->longitude,
                'capacity'  => (int) $evacuationCenter->capacity,
                'distance'  => (float) $evacuationCenter->distance,
            ] : null,
        ]);
    }

    /**
     * Handle general typhoon knowledge questions.
     * Uses elseif chain — returns on first match.
     */
    private function handleGeneralQuestion($question)
    {
        $q = strtolower($question);
        $hasBarangay = $this->extractBarangay($question) !== null;

        // --- EVACUATION CENTERS LIST (Global lookup) ---
        if (!$hasBarangay && $this->matches($q, ['where the evacuation', 'where is the evacuation', 'evacuation center', 'evacuation centers', 'list evacuation', 'list of evacuation', 'saan ang evacuation', 'saan pwede lumikas', 'saan lilikas'])) {
            $centers = \App\Models\EvacuationCenter::where('is_active', true)->get();
            if ($centers->isEmpty()) {
                return "🏫 Currently, there are no active evacuation centers set up in the system. Please check with local authorities for updates.";
            }

            $response = "🏫 **Active Evacuation Centers in Surigao City:**\n\n";
            foreach ($centers as $center) {
                $response .= "📍 **{$center->name}**\n"
                           . "   • Address: {$center->address}\n";
                if ($center->capacity) {
                    $response .= "   • Capacity: {$center->capacity} persons\n";
                }
                $response .= "   • Coordinates: {$center->latitude}, {$center->longitude}\n\n";
            }
            $response .= "💡 *Tip: Ask \"where is the evacuation center in [barangay name]?\" to find the nearest shelter and see direct routing coordinates!*";
            return $response;

        // --- WHAT TO DO DURING TYPHOON ---
        } elseif ($this->matches($q, ['what to do during typhoon', 'what should i do during', 'during typhoon what', 'typhoon what to do', 'pag bagyo ano'])) {
            return "🌀 What To Do During a Typhoon:\n\n"
                . "✅ Stay indoors and away from windows\n"
                . "✅ Turn off electrical appliances and unplug them\n"
                . "✅ Store enough food and drinking water for at least 3 days\n"
                . "✅ Keep a battery-powered radio for PAGASA updates\n"
                . "✅ Move to higher ground if flooding occurs\n"
                . "✅ Follow evacuation orders from local authorities immediately\n"
                . "✅ Keep emergency contacts saved on your phone\n"
                . "❌ Do not go outside during the typhoon eye — it is NOT over\n"
                . "❌ Do not cross flooded roads or rivers";

        // --- HOW TO PREPARE FOR TYPHOON ---
        } elseif ($this->matches($q, ['how to prepare', 'prepare for typhoon', 'typhoon preparation', 'paghahanda sa bagyo', 'before typhoon'])) {
            return "🧰 How To Prepare Before a Typhoon:\n\n"
                . "📦 Prepare a Go Bag with:\n"
                . "   • Water (1 liter per person per day for 3 days)\n"
                . "   • Non-perishable food (canned goods, biscuits)\n"
                . "   • Flashlight and extra batteries\n"
                . "   • First aid kit and medicines\n"
                . "   • Important documents (IDs, birth certificates) in waterproof bag\n"
                . "   • Extra clothing and blankets\n"
                . "   • Whistle, rope, and knife\n\n"
                . "🏠 At Home:\n"
                . "   • Secure loose items outside (pots, furniture, signs)\n"
                . "   • Check roof and walls for damage\n"
                . "   • Know your nearest evacuation center\n"
                . "   • Charge all devices and power banks\n"
                . "   • Fill water containers in case water supply is cut";

        // --- GO BAG / EMERGENCY KIT ---
        } elseif ($this->matches($q, ['go bag', 'emergency kit', 'emergency bag', 'what to pack', 'what to bring'])) {
            return "🎒 Go Bag Essentials for Typhoon:\n\n"
                . "💧 Water — 1 liter per person per day (3-day supply)\n"
                . "🍱 Food — canned goods, instant noodles, biscuits, energy bars\n"
                . "🔦 Flashlight — with extra batteries or hand-crank\n"
                . "🩺 First Aid Kit — bandages, antiseptic, paracetamol, medicines\n"
                . "📄 Documents — IDs, insurance, land titles (in waterproof bag)\n"
                . "👕 Clothing — extra clothes, rain jacket, sturdy shoes\n"
                . "📻 Radio — battery-powered for PAGASA updates\n"
                . "🔋 Power bank — fully charged\n"
                . "💵 Cash — ATMs may not work after typhoon\n"
                . "🔑 Whistle — to signal for help if trapped\n"
                . "📱 Phone — with emergency contacts saved";

        // --- PAGASA SIGNALS EXPLANATION ---
        } elseif ($this->matches($q, ['what is signal', 'explain signal', 'pagasa signal', 'typhoon signal meaning', 'what does signal mean', 'signal 1', 'signal 2', 'signal 3', 'signal 4', 'signal 5'])) {
            return "🌀 PAGASA Typhoon Signal Guide:\n\n"
                . "🟢 Signal 1 — Wind: 60–89 km/h\n"
                . "   • Classes suspended (Kinder to Grade 12)\n"
                . "   • Stay alert, prepare supplies\n\n"
                . "🟡 Signal 2 — Wind: 90–120 km/h\n"
                . "   • All classes suspended\n"
                . "   • Prepare to evacuate flood-prone areas\n\n"
                . "🟠 Signal 3 — Wind: 121–170 km/h\n"
                . "   • Extremely destructive winds\n"
                . "   • Evacuate immediately\n\n"
                . "🔴 Signal 4 — Wind: 171–220 km/h\n"
                . "   • Catastrophic damage expected\n"
                . "   • All residents must evacuate\n\n"
                . "⛔ Signal 5 — Wind: Above 220 km/h\n"
                . "   • Supertyphoon — catastrophic and life-threatening\n"
                . "   • Evacuate NOW — do not wait";

        // --- AFTER TYPHOON ---
        } elseif ($this->matches($q, ['after typhoon', 'what to do after', 'pagkatapos ng bagyo', 'typhoon aftermath', 'post typhoon'])) {
            return "✅ What To Do After a Typhoon:\n\n"
                . "🔍 Check for hazards:\n"
                . "   • Do not touch downed power lines\n"
                . "   • Check for gas leaks before using appliances\n"
                . "   • Inspect your home for structural damage\n\n"
                . "💧 Water safety:\n"
                . "   • Do not drink tap water until declared safe\n"
                . "   • Use bottled or boiled water only\n\n"
                . "🏥 Health:\n"
                . "   • Watch for signs of leptospirosis after flood exposure\n"
                . "   • Clean and disinfect your home\n"
                . "   • Seek medical help if injured\n\n"
                . "📞 Report:\n"
                . "   • Report damages to your local barangay\n"
                . "   • Document damage with photos for insurance";

        // --- EMERGENCY HOTLINES ---
        } elseif ($this->matches($q, ['hotline', 'emergency number', 'contact', 'who to call', 'phone number', 'emergency contact'])) {
            return "📞 Emergency Hotlines (Philippines):\n\n"
                . "🆘 National Emergency Hotline: 911\n"
                . "🌀 PAGASA: (02) 8284-0800\n"
                . "🔴 NDRRMC: (02) 8911-5061 to 65\n"
                . "🚒 Bureau of Fire Protection: 160\n"
                . "🚔 Philippine National Police: 117\n"
                . "🏥 Red Cross: (02) 8790-2300\n"
                . "⛑️ Civil Defense: (02) 8912-2665\n\n"
                . "📍 For local emergencies, contact your Barangay Hall or City DRRMO immediately.";

        // --- WHAT IS PAGASA ---
        } elseif ($this->matches($q, ['what is pagasa', 'pagasa meaning', 'who is pagasa', 'about pagasa'])) {
            return "🌤️ What is PAGASA?\n\n"
                . "PAGASA stands for Philippine Atmospheric, Geophysical and Astronomical Services Administration.\n\n"
                . "It is the Philippine government agency responsible for:\n"
                . "• Weather forecasting and typhoon tracking\n"
                . "• Issuing typhoon signal warnings\n"
                . "• Flood and storm surge advisories\n"
                . "• Climate monitoring across the Philippines\n\n"
                . "PAGASA issues typhoon signals (1-5) based on wind speed to warn communities of incoming danger.\n\n"
                . "Website: www.pagasa.dost.gov.ph\n"
                . "Hotline: (02) 8284-0800";

        // --- LEPTOSPIROSIS ---
        } elseif ($this->matches($q, ['leptospirosis', 'lepto', 'flood disease', 'disease after flood', 'sick after flood'])) {
            return "⚠️ Leptospirosis Warning:\n\n"
                . "Leptospirosis is a bacterial infection spread through floodwater contaminated with animal urine.\n\n"
                . "🚫 Avoid wading in floodwater. If you must:\n"
                . "   • Wear rubber boots and gloves\n"
                . "   • Cover any open wounds\n"
                . "   • Wash thoroughly with soap after exposure\n\n"
                . "🤒 Symptoms (appear 2-30 days after exposure):\n"
                . "   • High fever and headache\n"
                . "   • Muscle pain especially in calves\n"
                . "   • Red eyes and vomiting\n\n"
                . "🏥 Seek medical attention immediately if you experience these symptoms after flood exposure.";

        // --- STORM SURGE ---
        } elseif ($this->matches($q, ['storm surge', 'daluyong', 'what is storm surge', 'storm surge meaning'])) {
            return "🌊 What is a Storm Surge?\n\n"
                . "A storm surge is an abnormal rise in sea level caused by a typhoon's strong winds pushing ocean water toward the shore.\n\n"
                . "⚠️ It is one of the deadliest typhoon hazards:\n"
                . "   • Can reach 2-7 meters above normal sea level\n"
                . "   • Arrives with little warning\n"
                . "   • Can travel far inland in coastal areas\n\n"
                . "🏃 What to do:\n"
                . "   • Evacuate coastal areas IMMEDIATELY when warned\n"
                . "   • Do not wait to see the surge — it is too late by then\n"
                . "   • Move to higher ground at least 10 meters above sea level\n\n"
                . "📍 Coastal barangays are most at risk during Signal 3 and above.";

        // --- FLOOD SAFETY ---
        } elseif ($this->matches($q, ['flood safety', 'flood tips', 'baha', 'what to do flood', 'flooded'])) {
            return "🌊 Flood Safety Tips:\n\n"
                . "❌ Never:\n"
                . "   • Walk or drive through floodwater\n"
                . "   • Touch electrical equipment in flooded areas\n"
                . "   • Ignore evacuation orders\n\n"
                . "✅ Always:\n"
                . "   • Move to higher ground immediately\n"
                . "   • Turn off electricity at the main switch\n"
                . "   • Keep children and elderly away from floodwater\n"
                . "   • Follow instructions from barangay officials\n\n"
                . "🚗 If trapped in a vehicle in floodwater:\n"
                . "   • Exit immediately if water is rising\n"
                . "   • Move to the roof if doors cannot open\n"
                . "   • Signal for help with a whistle or cloth";

        // --- WHAT IS THIS SYSTEM ---
        } elseif ($this->matches($q, ['what is this system', 'what can you do', 'what can you answer', 'how can you help', 'what are you', 'who are you'])) {
            return "👋 I am the Typhoon Q&A Assistant!\n\n"
                . "I can answer questions about:\n\n"
                . "📍 Barangay Weather:\n"
                . "   • Is [barangay name] safe?\n"
                . "   • What is the wind speed in [barangay]?\n"
                . "   • Should I evacuate [barangay]?\n"
                . "   • What is the rainfall in [barangay]?\n\n"
                . "🌀 Typhoon Knowledge:\n"
                . "   • What to do during a typhoon?\n"
                . "   • How to prepare for a typhoon?\n"
                . "   • What is in a go bag?\n"
                . "   • What is PAGASA Signal 1, 2, 3, 4, 5?\n"
                . "   • Emergency hotlines\n"
                . "   • What to do after a typhoon?\n"
                . "   • Storm surge safety\n"
                . "   • Flood safety tips\n"
                . "   • Leptospirosis prevention\n\n"
                . "Just ask me anything about typhoon safety! 🌀";
        }

        return null; // Not a general question — proceed to barangay lookup
    }

    /**
     * Helper: check if question contains any of the given keyword phrases
     */
    private function matches($question, array $keywords): bool
    {
        foreach ($keywords as $keyword) {
            if (strpos($question, $keyword) !== false) {
                return true;
            }
        }
        return false;
    }

    /**
     * Extract barangay from question using case-insensitive substring match.
     * Only selects the columns we actually need.
     */
    private function extractBarangay($question)
    {
        $barangays = Barangay::select('id', 'name', 'latitude', 'longitude')->get();

        foreach ($barangays as $barangay) {
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
            'safety'  => ['safe', 'danger', 'dangerous', 'risk', 'okay', 'ok', 'is it safe', 'how safe'],
            'wind'    => ['wind', 'winds', 'windy', 'storm', 'speed', 'wind speed'],
            'rain'    => ['rain', 'rainfall', 'flood', 'flooding', 'raining'],
            'signal'  => ['signal', 'pagasa', 'typhoon', 'bagyo', 'class suspend', 'tc signal'],
            'evac'    => ['evacuate', 'evacuation', 'evac', 'shelter', 'center', 'should i evac'],
            'general' => ['weather', 'condition', 'status', 'update', 'how is'],
        ];

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
     */
    private function fetchWeatherData($barangay)
    {
        try {
            $lat = (float) $barangay->latitude;
            $lng = (float) $barangay->longitude;

            $response = Http::timeout(10)->get('https://api.open-meteo.com/v1/forecast', [
                'latitude'  => $lat,
                'longitude' => $lng,
                'current'   => 'temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m',
                'timezone'  => 'auto',
            ]);

            if (!$response->successful()) {
                return $this->getDefaultWeatherData();
            }

            $data    = $response->json();
            $current = $data['current'] ?? null;

            if (!$current) {
                return $this->getDefaultWeatherData();
            }

            return [
                'wind_speed'  => (float) ($current['wind_speed_10m']         ?? 0),
                'rainfall'    => (float) ($current['precipitation']           ?? 0),
                'temperature' => (float) ($current['temperature_2m']          ?? 30),
                'humidity'    => (int)   ($current['relative_humidity_2m']    ?? 85),
                'pressure'    => 1013,
            ];

        } catch (\Exception $e) {
            Log::error("Open-Meteo API error: " . $e->getMessage());
            return $this->getDefaultWeatherData();
        }
    }

    private function getDefaultWeatherData()
    {
        return [
            'wind_speed'  => 0,
            'rainfall'    => 0,
            'temperature' => 30,
            'humidity'    => 85,
            'pressure'    => 1013,
        ];
    }

    /**
     * Calculate severity level — kept in sync with TyphoonController
     */
    private function calculateSeverityLevel($weatherData)
    {
        $windSpeed   = $weatherData['wind_speed'];
        $rainfall    = $weatherData['rainfall'];
        $pressure    = $weatherData['pressure'];
        $temperature = $weatherData['temperature'];
        $humidity    = $weatherData['humidity'];

        $windScore     = min(max(($windSpeed - 30) / 320 * 100, 0), 100);
        $pressureScore = min(max((1013 - $pressure) / 93 * 100, 0), 100);
        $rainScore     = min(max($rainfall / 60 * 100, 0), 100);
        $humidityScore = min(max(($humidity - 85) / 15 * 100, 0), 100);
        $tempScore     = min(max((30 - $temperature) / 10 * 100, 0), 100);

        $score = ($windScore     * 0.35)
               + ($pressureScore * 0.30)
               + ($rainScore     * 0.20)
               + ($humidityScore * 0.10)
               + ($tempScore     * 0.05);

        $score = (int) round($score);

        if ($score <= 10)     $rank = 0;
        elseif ($score <= 22) $rank = 1;
        elseif ($score <= 35) $rank = 2;
        elseif ($score <= 50) $rank = 3;
        elseif ($score <= 65) $rank = 4;
        elseif ($score <= 78) $rank = 5;
        elseif ($score <= 90) $rank = 6;
        else                  $rank = 7;

        // Wind overrides — aligned with TyphoonController
        if ($windSpeed >= 221)     $rank = max($rank, 7);
        elseif ($windSpeed >= 171) $rank = max($rank, 6);
        elseif ($windSpeed >= 121) $rank = max($rank, 5);
        elseif ($windSpeed >= 90)  $rank = max($rank, 4);
        elseif ($windSpeed >= 60)  $rank = max($rank, 3);
        elseif ($windSpeed >= 45)  $rank = max($rank, 2);
        elseif ($windSpeed >= 30)  $rank = max($rank, 1);

        if ($rainfall >= 30)       $rank = max($rank, 3);
        elseif ($rainfall >= 7.5)  $rank = max($rank, 2);

        if ($pressure <= 960)      $rank = max($rank, 5);
        elseif ($pressure <= 975)  $rank = max($rank, 4);
        elseif ($pressure <= 990)  $rank = max($rank, 3);
        elseif ($pressure <= 1005) $rank = max($rank, 1);

        $severityMap = [
            0 => 'Normal',
            1 => 'Watch',
            2 => 'Elevated',
            3 => 'Signal 1',
            4 => 'Signal 2',
            5 => 'Signal 3',
            6 => 'Signal 4',
            7 => 'Signal 5',
        ];

        $severity = $severityMap[$rank] ?? 'Normal';

        return [$severity, $rank];
    }

    private function getNearestEvacuationCenter($barangay)
    {
        return EvacuationCenter::where('is_active', true)
            ->get()
            ->map(function ($ec) use ($barangay) {
                $ec->distance = $ec->getDistanceTo($barangay->latitude, $barangay->longitude);
                return $ec;
            })
            ->sortBy('distance')
            ->first();
    }

    private function generateResponse($intent, $severity, $rank, $barangay, $weatherData, $evacuationCenter)
    {
        $templates = [
            'safety' => [
                'Normal'   => "{barangay} is currently safe. Weather conditions are normal with wind at {wind} km/h and no significant rainfall.",
                'Watch'    => "{barangay} is under Watch level. A low pressure area is nearby. Monitor updates from PAGASA.",
                'Elevated' => "{barangay} conditions are elevated. Wind is at {wind} km/h. Prepare emergency supplies.",
                'Signal 1' => "{barangay} is under Typhoon Signal 1. Wind has reached {wind} km/h. Classes are suspended. Stay indoors.",
                'Signal 2' => "{barangay} is under Typhoon Signal 2. Wind is at {wind} km/h. This is dangerous — evacuate if instructed.",
                'Signal 3' => "{barangay} is under Typhoon Signal 3. Wind is at {wind} km/h. Extremely destructive — evacuate now.",
                'Signal 4' => "{barangay} is under Typhoon Signal 4. EVACUATE IMMEDIATELY. Do not go outside.",
                'Signal 5' => "{barangay} is under Typhoon Signal 5. SUPERTYPHOON — EVACUATE NOW. Life-threatening danger.",
            ],
            'wind' => [
                'Normal'   => "Wind in {barangay} is currently {wind} km/h — light and safe.",
                'Watch'    => "Wind in {barangay} is {wind} km/h — monitor closely.",
                'Elevated' => "Wind in {barangay} is {wind} km/h — strengthening. Prepare precautions.",
                'Signal 1' => "Wind in {barangay} has reached {wind} km/h, triggering Typhoon Signal 1.",
                'Signal 2' => "Wind in {barangay} is at {wind} km/h — destructive typhoon winds.",
                'Signal 3' => "Wind in {barangay} is at {wind} km/h — extremely destructive.",
                'Signal 4' => "Wind in {barangay} is at {wind} km/h — catastrophic winds.",
                'Signal 5' => "Wind in {barangay} is at {wind} km/h — SUPERTYPHOON. Extreme danger.",
            ],
            'rain' => [
                'Normal'   => "There is no significant rainfall in {barangay} right now. Conditions are dry.",
                'Watch'    => "Light rain is expected in {barangay}. Monitor weather updates.",
                'Elevated' => "Rainfall in {barangay} is {rain} mm/hr. Avoid low-lying areas.",
                'Signal 1' => "Heavy rain is occurring in {barangay} at {rain} mm/hr. Flooding is possible.",
                'Signal 2' => "Heavy rain in {barangay} at {rain} mm/hr. Avoid all flood-prone areas.",
                'Signal 3' => "Extreme rain in {barangay} at {rain} mm/hr. Flash floods are occurring.",
                'Signal 4' => "Catastrophic rainfall in {barangay}. Evacuate flood-prone areas immediately.",
                'Signal 5' => "Extreme rainfall in {barangay}. Life-threatening flooding. EVACUATE NOW.",
            ],
            'signal' => [
                'Normal'   => "{barangay} is under No Tropical Cyclone Signal. Conditions are normal.",
                'Watch'    => "{barangay} is under Tropical Cyclone Watch. Monitor PAGASA updates closely.",
                'Elevated' => "{barangay} is on Elevated Alert. Prepare precautions.",
                'Signal 1' => "{barangay} is under Typhoon Signal 1. Wind is {wind} km/h. Classes suspended.",
                'Signal 2' => "{barangay} is under Typhoon Signal 2. Wind is {wind} km/h. Destructive conditions.",
                'Signal 3' => "{barangay} is under Typhoon Signal 3. Wind is {wind} km/h. Extremely destructive.",
                'Signal 4' => "{barangay} is under Typhoon Signal 4. Catastrophic winds. Evacuate now.",
                'Signal 5' => "{barangay} is under Typhoon Signal 5. SUPERTYPHOON. EVACUATE IMMEDIATELY.",
            ],
            'evac' => [
                'Normal'   => "No evacuation needed in {barangay}. Conditions are normal.",
                'Watch'    => "No evacuation needed yet in {barangay}. Nearest center: {evac_center} ({distance} km away).",
                'Elevated' => "Residents in flood-prone areas of {barangay} should prepare to evacuate. Nearest center: {evac_center} ({distance} km away).",
                'Signal 1' => "Prepare to evacuate from {barangay}. Nearest center: {evac_center} ({distance} km away).",
                'Signal 2' => "EVACUATE NOW from {barangay} to {evac_center}, {distance} km away.",
                'Signal 3' => "EVACUATE IMMEDIATELY from {barangay} to {evac_center}. Do not delay.",
                'Signal 4' => "EVACUATE NOW. Go to {evac_center} immediately. Signal 4 is catastrophic.",
                'Signal 5' => "EVACUATE IMMEDIATELY. {evac_center} is your nearest shelter. SUPERTYPHOON WARNING.",
            ],
            'general' => [
                'Normal'   => "{barangay} is under normal weather conditions. Wind: {wind} km/h, Rainfall: {rain} mm/hr.",
                'Watch'    => "{barangay} is under Watch status. A low pressure system is being monitored. Wind: {wind} km/h.",
                'Elevated' => "{barangay} is at Elevated Alert. Wind: {wind} km/h, Rainfall: {rain} mm/hr.",
                'Signal 1' => "{barangay} is under Typhoon Signal 1. Wind: {wind} km/h, Rainfall: {rain} mm/hr.",
                'Signal 2' => "{barangay} is under Typhoon Signal 2. Wind: {wind} km/h, Rainfall: {rain} mm/hr.",
                'Signal 3' => "{barangay} is under Typhoon Signal 3. Wind: {wind} km/h. Extremely destructive.",
                'Signal 4' => "{barangay} is under Typhoon Signal 4. Catastrophic winds. Evacuate immediately.",
                'Signal 5' => "{barangay} is under Typhoon Signal 5 — SUPERTYPHOON. EVACUATE IMMEDIATELY.",
            ],
        ];

        $templateSet = $templates[$intent] ?? $templates['general'];
        $template    = $templateSet[$severity] ?? reset($templateSet);

        $response = str_replace('{barangay}', $barangay->name, $template);
        $response = str_replace('{wind}', round($weatherData['wind_speed'], 1), $response);
        $response = str_replace('{rain}', round($weatherData['rainfall'], 1), $response);

        if ($evacuationCenter) {
            $response = str_replace('{evac_center}', $evacuationCenter->name, $response);
            $response = str_replace('{distance}', round($evacuationCenter->distance, 1), $response);
        }

        return $response;
    }

    private function generateNotFoundResponse()
    {
        $barangays    = Barangay::pluck('name')->take(5)->toArray();
        $barangayList = implode(', ', $barangays);

        return "I couldn't find that barangay in the system. You can also ask me general typhoon questions like:\n\n"
            . "• What to do during a typhoon?\n"
            . "• How to prepare for a typhoon?\n"
            . "• What is in a go bag?\n"
            . "• What is PAGASA Signal 1, 2, 3?\n"
            . "• Emergency hotlines\n\n"
            . "Available barangays: {$barangayList}";
    }

    public function history(Request $request)
    {
        $query = ChatLog::orderBy('created_at', 'desc');

        if ($request->filled('barangay') && $request->barangay !== 'all') {
            $query->where('barangay_name', $request->barangay);
        }

        if ($request->filled('search')) {
            $search = $request->search;
            $query->where(function($q) use ($search) {
                $q->where('question', 'like', "%{$search}%")
                  ->orWhere('answer', 'like', "%{$search}%");
            });
        }

        if ($request->filled('start_date')) {
            $query->whereDate('created_at', '>=', $request->start_date);
        }

        if ($request->filled('end_date')) {
            $query->whereDate('created_at', '<=', $request->end_date);
        }

        $logs = $query->paginate(20);
        return response()->json($logs);
    }

    public function historyByBarangay($barangay)
    {
        $logs = ChatLog::where('barangay_name', $barangay)
                       ->orderBy('created_at', 'desc')
                       ->paginate(20);
        return response()->json($logs);
    }

    public function deleteLog($id)
    {
        ChatLog::findOrFail($id)->delete();
        return response()->json(['message' => 'Deleted successfully']);
    }

    public function clearHistory()
    {
        ChatLog::truncate();
        return response()->json(['message' => 'History cleared']);
    }
}