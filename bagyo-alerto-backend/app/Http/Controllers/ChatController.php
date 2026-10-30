<?php

namespace App\Http\Controllers;

use App\Models\Barangay;
use App\Models\EvacuationCenter;
use App\Models\ChatLog;
use App\Models\PagasaSignal;
use App\Services\OpenMeteoWeatherService;
use App\Services\OllamaService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Throwable;

class ChatController extends Controller
{
    private OllamaService $ollama;
    private OpenMeteoWeatherService $weatherService;
    private AdminController $adminController;
    private TyphoonController $typhoonController;

    public function __construct(
        OllamaService $ollama,
        OpenMeteoWeatherService $weatherService,
        AdminController $adminController,
        TyphoonController $typhoonController,
    ) {
        $this->ollama = $ollama;
        $this->weatherService = $weatherService;
        $this->adminController = $adminController;
        $this->typhoonController = $typhoonController;
    }
    public function ask(Request $request)
    {
        $request->validate([
            'question'      => 'required|string|max:500',
            'last_barangay' => 'nullable|string|max:100',
            'force_refresh' => 'sometimes|boolean',
            'context'       => 'sometimes|string|in:admin,resident',
            'conversation_id' => 'nullable|integer|min:1',
        ]);

        $question     = $request->question;
        $lastBarangay = $request->last_barangay;
        $forceRefresh = $request->boolean('force_refresh');
        $chatContext  = $request->input('context', 'resident');
        $isAdminContext = $chatContext === 'admin';
        $conversationLog = null;
        $conversationState = ['messages' => [], 'last_barangay' => null];

        if ($isAdminContext) {
            [$conversationLog, $conversationState] = $this->loadAdminConversation(
                $request->integer('conversation_id') ?: null
            );
            $lastBarangay = $conversationState['last_barangay'] ?? $lastBarangay;
        }

        // Step 1: Check if it's a general typhoon knowledge question first
        $q = strtolower($question);
        $hasBarangay = $this->extractBarangay($question) !== null;
        $isPredefinedGeneral = $this->isPredefinedGeneralQuestion($q);

        if ($isPredefinedGeneral || (!$hasBarangay && !$lastBarangay
            && ($isAdminContext || $this->seemsTyphoonOrWeatherRelated($q)))) {
            // It's a general typhoon question! Let's try Ollama first for a warm, conversational response.
            if ($this->ollama->isAvailable()) {
                $citySnapshot = $isAdminContext && !$hasBarangay && !$lastBarangay
                    ? $this->buildCitywideSnapshot($forceRefresh)
                    : null;
                $systemPrompt = $isAdminContext
                    ? $this->ollama->buildAdminSystemPrompt(
                        citySnapshot: $citySnapshot
                    )
                    : $this->ollama->buildKnowledgeSystemPrompt();
                $response = $this->ollama->chat(
                    $systemPrompt,
                    $question,
                    $isAdminContext ? $conversationState['messages'] : []
                );
                if ($response) {
                    return $this->chatResponse(
                        $isAdminContext,
                        $conversationLog,
                        $conversationState,
                        $question,
                        [
                        'response'      => $response,
                        'barangay_id'   => null,
                        'barangay_name' => null,
                        'severity'      => null,
                        'intent'        => 'knowledge',
                        ]
                    );
                }
            }

            // Fallback to static templates
            $generalResponse = $isAdminContext
                ? $this->generateAdminGeneralFallback()
                : $this->handleGeneralQuestion($question);
            if ($generalResponse) {
                return $this->chatResponse(
                    $isAdminContext,
                    $conversationLog,
                    $conversationState,
                    $question,
                    [
                    'response'      => $generalResponse,
                    'barangay_id'   => null,
                    'barangay_name' => null,
                    'severity'      => null,
                    'intent'        => 'knowledge',
                    ]
                );
            }
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
            $notFoundResponse = $isAdminContext
                ? $this->generateAdminGeneralFallback()
                : $this->generateNotFoundResponse();
            return $this->chatResponse(
                $isAdminContext,
                $conversationLog,
                $conversationState,
                $question,
                [
                'response'      => $notFoundResponse,
                'barangay_id'   => null,
                'barangay_name' => null,
                'severity'      => null,
                'intent'        => 'not_found',
                ]
            );
        }

        Log::info("Barangay matched: {$matched->name}");

        // Validate coordinates exist
        if (empty($matched->latitude) || empty($matched->longitude)) {
            $errResponse = "I found {$matched->name} but its coordinates are not set in the system. Please update the barangay coordinates.";
            return $this->chatResponse(
                $isAdminContext,
                $conversationLog,
                $conversationState,
                $question,
                [
                'response'      => $errResponse,
                'barangay_id'   => $matched->id,
                'barangay_name' => $matched->name,
                'severity'      => null,
                'intent'        => 'error',
                'error'         => 'missing_coordinates',
                ]
            );
        }

        // Step 3: Detect question intent
        $intent = $this->detectIntent($question);

        // Step 4: Fetch weather data — cached 5 minutes per barangay if successful
        $cacheKey = $isAdminContext
            ? "weather_barangay_admin_{$matched->id}"
            : "weather_barangay_{$matched->id}";
        if ($forceRefresh) {
            Cache::forget($cacheKey);
        }

        $weatherData = Cache::get($cacheKey);

        if (!$weatherData) {
            $weatherData = $this->fetchWeatherData($matched, $isAdminContext);
            if ($weatherData) {
                Cache::put($cacheKey, $weatherData, 300);
            } else {
                $weatherData = $isAdminContext
                    ? $this->getUnavailableWeatherData()
                    : $this->getDefaultWeatherData();
            }
        }

        // Step 5: Calculate severity
        if ($isAdminContext && !$this->hasCompleteWeatherData($weatherData)) {
            $severity = 'Unavailable';
            $rank = 0;
        } else {
            [$severity, $rank] = $this->calculateSeverityLevel($weatherData);
        }

        // Step 6: Get evacuation center if severity is high enough OR intent is evacuation query
        $evacuationCenter = null;
        if ($rank >= 3 || $intent === 'evac') {
            $evacuationCenter = $this->getNearestEvacuationCenter($matched);
        }

        // Step 7: For evacuation intent, always use the template (it has real DB data).
        // For other intents, try Ollama first — fall back to template if unavailable.
        $aiPowered = false;
        $response  = null;

        if (($intent !== 'evac' || $isAdminContext) && $this->ollama->isAvailable()) {
            $systemPrompt = $isAdminContext
                ? $this->ollama->buildAdminSystemPrompt(
                    $matched->name,
                    $weatherData,
                    $severity,
                    $evacuationCenter
                )
                : $this->ollama->buildTyphoonSystemPrompt(
                    $matched->name,
                    $weatherData,
                    $severity,
                    $evacuationCenter  // Pass DB evacuation center so Ollama can reference it
                );
            $response  = $this->ollama->chat(
                $systemPrompt,
                $question,
                $isAdminContext ? $conversationState['messages'] : []
            );
            $aiPowered = $response !== null;
        }

        // Always use template for evac intent (guaranteed real DB data),
        // or as fallback if Ollama is down or returned nothing
        if (!$response) {
            $response = $isAdminContext
                ? $this->generateAdminResponse(
                    $intent, $severity, $rank, $matched, $weatherData, $evacuationCenter
                )
                : $this->generateResponse(
                    $intent, $severity, $rank, $matched, $weatherData, $evacuationCenter
                );
        }

        return $this->chatResponse(
            $isAdminContext,
            $conversationLog,
            $conversationState,
            $question,
            [
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
            ]
        );
    }

    /**
     * Load an admin thread from its single chat_logs row. Legacy one-exchange
     * rows are treated as two-message conversations when reopened.
     *
     * @return array{0: ChatLog|null, 1: array{messages: array, last_barangay: string|null}}
     */
    private function loadAdminConversation(?int $conversationId): array
    {
        if (!$conversationId) {
            return [null, ['messages' => [], 'last_barangay' => null]];
        }

        $log = ChatLog::find($conversationId);
        if (!$log) {
            return [null, ['messages' => [], 'last_barangay' => null]];
        }

        $document = $this->conversationDocument($log);
        if ($document) {
            return [$log, [
                'messages' => $document['messages'],
                'last_barangay' => $document['last_barangay'] ?? $log->barangay_name,
            ]];
        }

        return [$log, [
            'messages' => $this->legacyConversationMessages($log),
            'last_barangay' => $log->barangay_name,
        ]];
    }

    /**
     * Persist an entire admin thread in one row while leaving resident logging
     * as one row per exchange. The response always exposes the thread id to
     * admin clients so they can continue the same conversation.
     */
    private function chatResponse(
        bool $isAdminContext,
        ?ChatLog &$conversationLog,
        array &$conversationState,
        string $question,
        array $payload
    ): \Illuminate\Http\JsonResponse {
        $weather = is_array($payload['weather_data'] ?? null)
            ? $payload['weather_data']
            : [];

        if (!$isAdminContext) {
            ChatLog::create([
                'barangay_name' => $payload['barangay_name'] ?? null,
                'question'      => $question,
                'answer'        => $payload['response'],
                'severity'      => $payload['severity'] ?? null,
                'wind'          => $weather['wind_speed'] ?? null,
                'rainfall'      => $weather['rainfall'] ?? null,
                'pressure'      => $weather['pressure'] ?? null,
                'temperature'   => $weather['temperature'] ?? null,
                'humidity'      => $weather['humidity'] ?? null,
                'asked_by'      => 'admin',
            ]);

            return response()->json($payload);
        }

        $timestamp = now('Asia/Manila')->toIso8601String();
        $conversationState['messages'][] = [
            'id' => (string) Str::uuid(),
            'role' => 'user',
            'content' => $question,
            'type' => 'user',
            'text' => $question,
            'timestamp' => $timestamp,
        ];
        $conversationState['messages'][] = [
            'id' => (string) Str::uuid(),
            'role' => 'assistant',
            'content' => $payload['response'],
            'type' => 'bot',
            'text' => $payload['response'],
            'barangay' => $payload['barangay_name'] ?? null,
            'severity' => $payload['severity'] ?? null,
            'intent' => $payload['intent'] ?? null,
            'weatherData' => $payload['weather_data'] ?? null,
            'aiPowered' => (bool) ($payload['ai_powered'] ?? false),
            'timestamp' => $timestamp,
            'originalQuestion' => $question,
            'barangayCoords' => $payload['barangay'] ?? null,
            'evacuationCoords' => $payload['evacuation_center'] ?? null,
        ];

        if (!empty($payload['barangay_name'])) {
            $conversationState['last_barangay'] = $payload['barangay_name'];
        }

        $document = json_encode([
            'version' => 1,
            'last_barangay' => $conversationState['last_barangay'] ?? null,
            'messages' => $conversationState['messages'],
        ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);

        $attributes = [
            'barangay_name' => $conversationState['last_barangay'] ?? null,
            'answer'        => $document,
            'severity'      => $payload['severity'] ?? null,
            'wind'          => $weather['wind_speed'] ?? null,
            'rainfall'      => $weather['rainfall'] ?? null,
            'pressure'      => $weather['pressure'] ?? null,
            'temperature'   => $weather['temperature'] ?? null,
            'humidity'      => $weather['humidity'] ?? null,
            'asked_by'      => 'admin',
        ];

        if ($conversationLog) {
            $conversationLog->update($attributes);
        } else {
            $conversationLog = ChatLog::create(array_merge($attributes, [
                'question' => $question,
            ]));
        }

        $payload['conversation_id'] = $conversationLog->id;
        $payload['last_barangay'] = $conversationState['last_barangay'] ?? null;

        return response()->json($payload);
    }

    private function conversationDocument(ChatLog $log): ?array
    {
        $document = json_decode($log->answer, true);

        return is_array($document)
            && ($document['version'] ?? null) === 1
            && is_array($document['messages'] ?? null)
                ? $document
                : null;
    }

    /** @return array<int, array<string, mixed>> */
    private function legacyConversationMessages(ChatLog $log): array
    {
        $timestamp = $log->created_at?->toIso8601String();

        return [
            [
                'id' => "user-{$log->id}",
                'role' => 'user',
                'content' => $log->question,
                'type' => 'user',
                'text' => $log->question,
                'timestamp' => $timestamp,
            ],
            [
                'id' => "bot-{$log->id}",
                'role' => 'assistant',
                'content' => $log->answer,
                'type' => 'bot',
                'text' => $log->answer,
                'barangay' => $log->barangay_name,
                'severity' => $log->severity,
                'weatherData' => $log->wind !== null ? [
                    'wind_speed' => $log->wind,
                    'rainfall' => $log->rainfall,
                    'temperature' => $log->temperature,
                    'humidity' => $log->humidity,
                    'pressure' => $log->pressure,
                ] : null,
                'aiPowered' => true,
                'timestamp' => $timestamp,
                'originalQuestion' => $log->question,
            ],
        ];
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

        // Out-of-scope: question is not typhoon/weather related and no barangay found
        if (!$hasBarangay && !$this->seemsTyphoonOrWeatherRelated($q)) {
            return "I'm focused on typhoon operations and barangay safety in Surigao City.\nPlease contact your local DRRMO for other concerns.";
        }

        return null; // Not a general question — proceed to barangay lookup
    }

    /**
     * Determine if the lowercased question matches predefined general keywords
     */
    private function isPredefinedGeneralQuestion(string $q): bool
    {
        $keywords = [
            'where the evacuation', 'where is the evacuation', 'evacuation center', 'evacuation centers',
            'list evacuation', 'list of evacuation', 'saan ang evacuation', 'saan pwede lumikas', 'saan lilikas',
            'what to do during typhoon', 'what should i do during', 'during typhoon what', 'typhoon what to do',
            'pag bagyo ano', 'how to prepare', 'prepare for typhoon', 'typhoon preparation', 'paghahanda sa bagyo',
            'before typhoon', 'go bag', 'emergency kit', 'emergency bag', 'what to pack', 'what to bring',
            'what is signal', 'explain signal', 'pagasa signal', 'typhoon signal meaning', 'what does signal mean',
            'signal 1', 'signal 2', 'signal 3', 'signal 4', 'signal 5', 'after typhoon', 'what to do after',
            'pagkatapos ng bagyo', 'typhoon aftermath', 'post typhoon', 'hotline', 'emergency number', 'contact',
            'who to call', 'phone number', 'emergency contact', 'what is pagasa', 'pagasa meaning', 'who is pagasa',
            'about pagasa', 'leptospirosis', 'lepto', 'flood disease', 'disease after flood', 'sick after flood',
            'storm surge', 'daluyong', 'what is storm surge', 'storm surge meaning', 'flood safety', 'flood tips',
            'baha', 'what to do flood', 'flooded', 'what is this system', 'what can you do', 'what can you answer',
            'how can you help', 'what are you', 'who are you'
        ];

        return $this->matches($q, $keywords);
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
    private function fetchWeatherData($barangay, bool $includePressure = false)
    {
        try {
            $lat = (float) $barangay->latitude;
            $lng = (float) $barangay->longitude;

            $currentFields = 'temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m';
            if ($includePressure) {
                $currentFields .= ',surface_pressure';
            }

            $response = Http::timeout(10)->get('https://api.open-meteo.com/v1/forecast', [
                'latitude'  => $lat,
                'longitude' => $lng,
                'current'   => $currentFields,
                'timezone'  => 'auto',
            ]);

            if (!$response->successful()) {
                return null;
            }

            $data    = $response->json();
            $current = $data['current'] ?? null;

            if (!$current) {
                return null;
            }

            return [
                'wind_speed'  => (float) ($current['wind_speed_10m']         ?? 0),
                'rainfall'    => (float) ($current['precipitation']           ?? 0),
                'temperature' => (float) ($current['temperature_2m']          ?? 30),
                'humidity'    => (int)   ($current['relative_humidity_2m']    ?? 85),
                'pressure'    => $includePressure
                    ? (isset($current['surface_pressure']) ? (float) $current['surface_pressure'] : null)
                    : 1013,
            ];

        } catch (\Exception $e) {
            Log::error("Open-Meteo API error: " . $e->getMessage());
            return null;
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

    private function getUnavailableWeatherData(): array
    {
        return [
            'wind_speed'  => null,
            'rainfall'    => null,
            'temperature' => null,
            'humidity'    => null,
            'pressure'    => null,
        ];
    }

    private function hasCompleteWeatherData(array $weatherData): bool
    {
        foreach (['wind_speed', 'rainfall', 'temperature', 'humidity', 'pressure'] as $field) {
            if (!array_key_exists($field, $weatherData) || $weatherData[$field] === null || !is_numeric($weatherData[$field])) {
                return false;
            }
        }

        return true;
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

    /**
     * Build the compact city-wide operational snapshot used only by general
     * admin chat. Weather and occupancy share the same data paths as the
     * dashboard and Evacuation Monitoring page.
     */
    private function buildCitywideSnapshot(bool $forceRefresh = false): array
    {
        $signalData = PagasaSignal::current();
        $signal = ($signalData['set_at'] ?? null) === null
            ? null
            : ((int) ($signalData['signal'] ?? 0) > 0
                ? 'Signal ' . (int) $signalData['signal']
                : 'No signal');

        $barangays = Barangay::query()
            ->select('id', 'name', 'latitude', 'longitude')
            ->orderBy('name')
            ->get()
            ->map(function (Barangay $barangay) use ($forceRefresh, $signal): array {
                $cacheKey = "api.barangays.{$barangay->id}.weather";
                if ($forceRefresh) {
                    Cache::forget($cacheKey);
                }

                try {
                    $weather = Cache::remember(
                        $cacheKey,
                        now()->addMinutes(5),
                        fn (): array => $this->weatherService->forBarangay($barangay),
                    );
                    $current = is_array($weather['current'] ?? null)
                        ? $weather['current']
                        : [];
                    $weatherData = [
                        'wind_speed' => $current['wind_speed'] ?? null,
                        'rainfall' => $current['rainfall'] ?? null,
                        'pressure' => $current['pressure'] ?? null,
                        'temperature' => $current['temperature'] ?? null,
                        'humidity' => $current['humidity'] ?? null,
                    ];
                    $severity = $this->hasCompleteWeatherData($weatherData)
                        ? $this->typhoonController->classifyWeather(
                            $weatherData['wind_speed'],
                            $weatherData['rainfall'],
                            $weatherData['pressure'],
                            $weatherData['temperature'],
                            $weatherData['humidity'],
                        )['classification']
                        : null;
                } catch (Throwable $exception) {
                    Log::warning('City-wide chat weather unavailable.', [
                        'barangay_id' => $barangay->id,
                        'error' => $exception->getMessage(),
                    ]);
                    $weatherData = $this->getUnavailableWeatherData();
                    $severity = null;
                }

                return [
                    'name' => $barangay->name,
                    'severity' => $severity,
                    'wind_speed' => $weatherData['wind_speed'],
                    'rainfall' => $weatherData['rainfall'],
                    'pressure' => $weatherData['pressure'],
                    'pagasa_signal' => $signal,
                ];
            })
            ->values()
            ->all();

        $centers = EvacuationCenter::query()
            ->where('is_active', 1)
            ->with('barangay:id,name')
            ->orderBy('name')
            ->get();
        $occupancies = EvacuationLogController::getOccupancyCounts($centers->pluck('id'));

        $centers = $centers->map(function (EvacuationCenter $center) use ($occupancies): array {
            $capacity = is_numeric($center->capacity) ? (int) $center->capacity : null;
            $occupancy = (int) ($occupancies->get($center->id) ?? 0);

            // Match the percentage displayed by AdminEvacuationMonitoring.
            $occupancyPercent = $capacity === null
                ? null
                : ($capacity > 0
                    ? min(100, (int) round(($occupancy / $capacity) * 100))
                    : ($occupancy > 0 ? 100 : 0));

            return [
                'name' => $center->name,
                'barangay_name' => $center->barangay?->name,
                'capacity' => $capacity,
                'current_occupancy' => $occupancy,
                'occupancy_percent' => $occupancyPercent,
                'hazard_class' => $center->hazard_level,
            ];
        })->values()->all();

        $dashboardStats = $this->adminController->stats()->getData(true);

        return [
            'barangays' => $barangays,
            'centers' => $centers,
            'center_summary' => [
                'count' => $dashboardStats['total_evacuation_centers'] ?? null,
                'total_capacity' => $dashboardStats['total_capacity'] ?? null,
            ],
        ];
    }

    private function generateAdminGeneralFallback(): string
    {
        return "No barangay-specific live operational data was loaded for this request. "
            . "Specify a barangay to retrieve current wind, rainfall, pressure, severity, and nearby center status. "
            . "Citywide risk rankings and near-capacity center lists are unavailable in this chat response; verify them in the Weather Monitor and Evacuation Monitoring views.";
    }

    private function generateAdminResponse(
        string $intent,
        string $severity,
        int $rank,
        $barangay,
        array $weatherData,
        $evacuationCenter
    ): string {
        $format = static function ($value, int $precision = 1): string {
            if ($value === null || !is_numeric($value)) {
                return 'unavailable';
            }

            return number_format((float) $value, $precision, '.', '');
        };

        $name = $barangay->name;
        $wind = $format($weatherData['wind_speed'] ?? null);
        $rainfall = $format($weatherData['rainfall'] ?? null);
        $pressure = $format($weatherData['pressure'] ?? null, 0);

        $lines = [
            "{$name}: computed current severity is {$severity}.",
            'Official PAGASA signal: unavailable for this request.',
            "Wind: " . ($wind === 'unavailable' ? $wind : "{$wind} km/h"),
            "Rainfall: " . ($rainfall === 'unavailable' ? $rainfall : "{$rainfall} mm/hr"),
            "Pressure: " . ($pressure === 'unavailable' ? $pressure : "{$pressure} hPa"),
        ];

        if ($evacuationCenter) {
            $capacity = is_numeric($evacuationCenter->capacity ?? null)
                ? (int) $evacuationCenter->capacity
                : null;
            $occupancy = is_numeric($evacuationCenter->current_occupancy ?? null)
                ? (int) $evacuationCenter->current_occupancy
                : null;
            $remaining = $capacity !== null && $occupancy !== null
                ? max(0, $capacity - $occupancy)
                : null;

            $lines[] = "Center: {$evacuationCenter->name}; capacity " . ($capacity ?? 'unavailable')
                . "; occupancy " . ($occupancy ?? 'unavailable')
                . "; remaining " . ($remaining ?? 'unavailable') . ".";
            $lines[] = "Center hazards: flood " . ($evacuationCenter->flood_susceptibility ?? 'unavailable')
                . "; landslide " . ($evacuationCenter->landslide_susceptibility ?? 'unavailable')
                . "; overall " . ($evacuationCenter->hazard_level ?? 'unavailable') . ".";
        } elseif ($intent === 'evac' || $rank >= 3) {
            $lines[] = 'Evacuation center data: no active center was found in the system.';
        }

        $action = match (true) {
            $severity === 'Unavailable' => 'Verify live observations before issuing an operational directive; weather data is incomplete.',
            $rank <= 1 => 'Continue monitoring PAGASA and barangay conditions. No center activation is indicated by the current readings.',
            $rank === 2 => 'Place designated centers on standby and monitor flood- and landslide-prone barangays.',
            $rank === 3 => 'Prepare designated centers for opening, verify staffing and supplies, and issue barangay-level warnings.',
            $rank === 4 => 'Open designated centers and prepare pre-emptive evacuation of exposed barangays.',
            default => 'Execute evacuation operations, open safe centers with available capacity, and maintain continuous barangay monitoring.',
        };

        $lines[] = "Recommended official action: {$action}";
        $lines[] = $severity === 'Unavailable'
            ? "[Live data unavailable · Barangay: {$name}]"
            : "[Live data · Barangay: {$name}]";

        return implode("\n", $lines);
    }

    private function generateResponse($intent, $severity, $rank, $barangay, $weatherData, $evacuationCenter)
    {
        $name     = $barangay->name;
        $wind     = round($weatherData['wind_speed']  ?? 0, 1);
        $rain     = round($weatherData['rainfall']    ?? 0, 1);
        $temp     = round($weatherData['temperature'] ?? 30, 1);
        $humidity = (int) ($weatherData['humidity']   ?? 85);

        // ── 1. SUMMARY ────────────────────────────────────────────────
        $summary = $this->buildSummary($intent, $severity, $name, $wind, $rain);

        // ── 2. WEATHER DATA ───────────────────────────────────────────
        $weatherBlock  = "Wind: {$wind} km/h\n";
        $weatherBlock .= "Rainfall: {$rain} mm/hr\n";
        $weatherBlock .= "Temperature: {$temp}°C\n";
        $weatherBlock .= "Humidity: {$humidity}%";

        // ── 3. SEVERITY LABEL ─────────────────────────────────────────
        $statusLine = "Status: {$severity}";

        // ── 4. ACTION RECOMMENDATION ──────────────────────────────────
        $action = $this->getActionRecommendation($rank);

        // ── 5. EVACUATION CENTER (rank >= Signal 1 OR evac intent) ────
        $evacBlock = '';
        if (($rank >= 3 || $intent === 'evac') && $evacuationCenter) {
            $distance  = round((float) ($evacuationCenter->distance ?? 0), 1);
            $evacBlock = "Nearest center: {$evacuationCenter->name}\n"
                       . "Address: {$evacuationCenter->address}\n"
                       . "Distance: {$distance} km from {$name}";
        } elseif ($rank >= 3) {
            $evacBlock = "No active evacuation center found in the system.\n"
                       . "Contact your barangay hall or DRRMO immediately.";
        } elseif ($intent === 'evac') {
            $evacBlock = "No active evacuation center found near {$name}.\n"
                       . "Please contact your local DRRMO for the nearest shelter.";
        }

        // ── 6. LOCATION & DATA TAG ────────────────────────────────────
        $tag = "[Live data · Barangay: {$name}]";

        // ── Assemble sections separated by blank lines ─────────────────
        $parts = [$summary, $weatherBlock, $statusLine, $action];
        if ($evacBlock) $parts[] = $evacBlock;
        $parts[] = $tag;

        return implode("\n\n", $parts);
    }

    /**
     * Build the intent-specific one-sentence summary (Section 1 of the response format).
     */
    private function buildSummary(string $intent, string $severity, string $name, float $wind, float $rain): string
    {
        $s = [
            'safety' => [
                'Normal'   => "Current conditions in {$name} are normal with no significant rainfall or wind threat.",
                'Watch'    => "Current conditions in {$name} are under Watch level — a low pressure area is being monitored.",
                'Elevated' => "Conditions in {$name} are elevated with strengthening wind at {$wind} km/h and increasing rainfall.",
                'Signal 1' => "{$name} is under Typhoon Signal 1. Wind has reached {$wind} km/h — destructive gusts are expected.",
                'Signal 2' => "{$name} is under Typhoon Signal 2. Wind is at {$wind} km/h — dangerous conditions are present.",
                'Signal 3' => "{$name} is under Typhoon Signal 3. Extremely destructive winds at {$wind} km/h — immediate action is required.",
                'Signal 4' => "{$name} is under Typhoon Signal 4. Catastrophic winds at {$wind} km/h — life-threatening conditions.",
                'Signal 5' => "{$name} is under Typhoon Signal 5 — SUPERTYPHOON. Wind at {$wind} km/h. Extreme danger to life.",
            ],
            'wind' => [
                'Normal'   => "Wind in {$name} is currently {$wind} km/h — conditions are light and safe.",
                'Watch'    => "Wind in {$name} is {$wind} km/h — a low pressure system is being monitored.",
                'Elevated' => "Wind in {$name} is strengthening at {$wind} km/h. Precautionary measures are advised.",
                'Signal 1' => "Wind in {$name} has reached {$wind} km/h, triggering Typhoon Signal 1 conditions.",
                'Signal 2' => "Wind in {$name} is at {$wind} km/h — destructive typhoon winds are present.",
                'Signal 3' => "Wind in {$name} is at {$wind} km/h — extremely destructive. Evacuate immediately.",
                'Signal 4' => "Wind in {$name} is at {$wind} km/h — catastrophic and life-threatening.",
                'Signal 5' => "Wind in {$name} is at {$wind} km/h — SUPERTYPHOON. Extreme danger to life.",
            ],
            'rain' => [
                'Normal'   => "There is no significant rainfall in {$name} right now. Conditions are currently dry.",
                'Watch'    => "Light rainfall is reported in {$name} at {$rain} mm/hr. Monitor weather updates.",
                'Elevated' => "Rainfall in {$name} is at {$rain} mm/hr. Avoid low-lying and flood-prone areas.",
                'Signal 1' => "Heavy rainfall is occurring in {$name} at {$rain} mm/hr. Flash flooding is possible.",
                'Signal 2' => "Heavy rain in {$name} at {$rain} mm/hr — avoid all flood-prone areas immediately.",
                'Signal 3' => "Extreme rainfall in {$name} at {$rain} mm/hr. Flash floods are likely. Evacuate now.",
                'Signal 4' => "Catastrophic rainfall in {$name} — severe flooding expected. EVACUATE IMMEDIATELY.",
                'Signal 5' => "Extreme rainfall in {$name} — life-threatening flooding underway. EVACUATE NOW.",
            ],
            'signal' => [
                'Normal'   => "{$name} is currently under No Tropical Cyclone Signal. Conditions are normal.",
                'Watch'    => "{$name} is under Tropical Cyclone Watch. A low pressure area is being monitored.",
                'Elevated' => "{$name} is on Elevated Alert — wind and rainfall are increasing.",
                'Signal 1' => "{$name} is under PAGASA Typhoon Signal 1. Wind has reached {$wind} km/h.",
                'Signal 2' => "{$name} is under PAGASA Typhoon Signal 2. Wind is at {$wind} km/h — destructive conditions.",
                'Signal 3' => "{$name} is under PAGASA Typhoon Signal 3. Wind is at {$wind} km/h — extremely destructive.",
                'Signal 4' => "{$name} is under PAGASA Typhoon Signal 4. Catastrophic winds at {$wind} km/h.",
                'Signal 5' => "{$name} is under PAGASA Typhoon Signal 5 — SUPERTYPHOON. Wind at {$wind} km/h.",
            ],
            'evac' => [
                'Normal'   => "No evacuation is required in {$name} at this time. Conditions are normal.",
                'Watch'    => "Evacuation is not yet required in {$name}. Continue monitoring PAGASA updates.",
                'Elevated' => "Residents in flood-prone areas of {$name} should begin preparing to evacuate.",
                'Signal 1' => "{$name} is under Typhoon Signal 1. Prepare to evacuate — follow barangay orders.",
                'Signal 2' => "{$name} is under Typhoon Signal 2. Prepare to evacuate now following barangay instructions.",
                'Signal 3' => "{$name} is under Typhoon Signal 3. All residents must evacuate immediately.",
                'Signal 4' => "{$name} is under Typhoon Signal 4. EVACUATE NOW — catastrophic winds are approaching.",
                'Signal 5' => "{$name} is under Typhoon Signal 5. EVACUATE IMMEDIATELY — life-threatening SUPERTYPHOON.",
            ],
            'general' => [
                'Normal'   => "Current conditions in {$name} are normal with no significant rainfall or wind threat.",
                'Watch'    => "Current conditions in {$name} are under Watch level. A low pressure area is being monitored.",
                'Elevated' => "Conditions in {$name} are elevated. Wind is at {$wind} km/h with rainfall at {$rain} mm/hr.",
                'Signal 1' => "{$name} is under Typhoon Signal 1. Wind: {$wind} km/h. Classes are suspended.",
                'Signal 2' => "{$name} is under Typhoon Signal 2. Wind: {$wind} km/h. Destructive conditions are present.",
                'Signal 3' => "{$name} is under Typhoon Signal 3. Wind: {$wind} km/h — extremely destructive.",
                'Signal 4' => "{$name} is under Typhoon Signal 4. Catastrophic winds at {$wind} km/h.",
                'Signal 5' => "{$name} is under Typhoon Signal 5 — SUPERTYPHOON. Wind at {$wind} km/h.",
            ],
        ];

        $set = $s[$intent] ?? $s['general'];
        return $set[$severity] ?? ($s['general'][$severity] ?? "Current conditions in {$name} are being monitored. Status: {$severity}.");
    }

    /**
     * Return the standardised action recommendation for a given severity rank.
     * Exact wording matches the Bakwit spec for UI badge rendering.
     */
    private function getActionRecommendation(int $rank): string
    {
        return match(true) {
            $rank <= 1  => "No action required. Continue to monitor PAGASA updates.",
            $rank === 2 => "Prepare emergency supplies. Secure loose objects around your home.",
            $rank === 3 => "Classes are suspended. Stay indoors and avoid unnecessary travel.",
            $rank === 4 => "Prepare to evacuate. Follow instructions from your barangay officials.",
            $rank === 5 => "Evacuate immediately. Move to your nearest evacuation center now.",
            default     => "EVACUATE NOW. This is a life-threatening emergency. Do not wait.",
        };
    }

    /**
     * Heuristic: does the question appear to be about typhoon / weather / disaster topics?
     * Used to distinguish a "barangay not found" case from a fully out-of-scope question.
     */
    private function seemsTyphoonOrWeatherRelated(string $question): bool
    {
        $keywords = [
            'typhoon', 'bagyo', 'weather', 'wind', 'rain', 'flood', 'baha',
            'signal', 'pagasa', 'evacuate', 'evacuation', 'evac', 'lilikas',
            'lumikas', 'safe', 'safety', 'shelter', 'barangay', 'storm',
            'surge', 'lepto', 'prepare', 'emergency', 'hotline', 'temperature',
            'humidity', 'forecast', 'warning', 'alert', 'drrmo', 'ndrrmc',
            'rescue', 'disaster', 'cloud', 'pressure', 'rainfall', 'cyclone',
        ];

        foreach ($keywords as $kw) {
            if (str_contains($question, $kw)) {
                return true;
            }
        }
        return false;
    }

    private function generateNotFoundResponse()
    {
        return "I couldn't find that barangay in the system. Please check the spelling or ask your DRRMO to add it.\n\n"
             . "You can also ask me general typhoon questions like:\n"
             . "   • What to do during a typhoon?\n"
             . "   • Emergency hotlines\n"
             . "   • How to prepare a go bag\n"
             . "   • PAGASA Signal 1 to 5 explanation";
    }

    public function history(Request $request)
    {
        $query = ChatLog::orderBy(
            $request->input('context') === 'admin' ? 'updated_at' : 'created_at',
            'desc'
        );

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
        $logs->getCollection()->transform(
            fn (ChatLog $log): array => $this->formatHistoryEntry($log)
        );

        return response()->json($logs);
    }

    public function historyByBarangay($barangay)
    {
        $logs = ChatLog::where('barangay_name', $barangay)
                       ->orderBy('created_at', 'desc')
                       ->paginate(20);
        $logs->getCollection()->transform(
            fn (ChatLog $log): array => $this->formatHistoryEntry($log)
        );

        return response()->json($logs);
    }

    private function formatHistoryEntry(ChatLog $log): array
    {
        $entry = $log->toArray();
        $document = $this->conversationDocument($log);
        $messages = $document['messages'] ?? $this->legacyConversationMessages($log);
        $lastAssistant = collect($messages)
            ->reverse()
            ->first(fn ($message) => ($message['role'] ?? null) === 'assistant');

        $entry['answer'] = $lastAssistant['content'] ?? $log->answer;
        $entry['messages'] = $messages;
        $entry['message_count'] = count($messages);
        $entry['last_barangay'] = $document['last_barangay'] ?? $log->barangay_name;

        return $entry;
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
