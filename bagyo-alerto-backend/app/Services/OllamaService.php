<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * OllamaService — connects to the local Ollama LLM server.
 *
 * Ollama runs at http://localhost:11434 (no API key needed).
 * Falls back gracefully if Ollama is not running.
 */
class OllamaService
{
    private string $baseUrl;
    private string $model;
    private int    $timeout;

    public function __construct()
    {
        $this->baseUrl = config('ollama.url',     'http://localhost:11434');
        $this->model   = config('ollama.model',   'llama3.2');
        $this->timeout = config('ollama.timeout', 30);
    }

    /**
     * Check if the Ollama server is reachable.
     */
    public function isAvailable(): bool
    {
        try {
            $res = Http::timeout(3)->get("{$this->baseUrl}/api/tags");
            return $res->successful();
        } catch (\Exception) {
            return false;
        }
    }

    /**
     * Send a chat message to the Ollama LLM.
     *
     * @param  string  $systemPrompt  Context / personality instructions
     * @param  string  $userMessage   The user's question
     * @return string|null            LLM response, or null if unavailable
     */
    public function chat(string $systemPrompt, string $userMessage): ?string
    {
        try {
            $response = Http::timeout($this->timeout)
                ->post("{$this->baseUrl}/api/chat", [
                    'model'  => $this->model,
                    'stream' => false,
                    'messages' => [
                        ['role' => 'system', 'content' => $systemPrompt],
                        ['role' => 'user',   'content' => $userMessage],
                    ],
                    'options' => [
                        'temperature' => 0.3,   // Lower = more factual/consistent
                        'num_predict' => 500,   // Allow room for 6-section format
                    ],
                ]);

            if (!$response->successful()) {
                Log::warning('Ollama returned non-200: ' . $response->status());
                return null;
            }

            $content = $response->json('message.content');

            if (empty($content)) {
                Log::warning('Ollama returned empty content.');
                return null;
            }

            return trim($content);

        } catch (\Exception $e) {
            Log::warning('Ollama unavailable: ' . $e->getMessage());
            return null;
        }
    }

    /**
     * Build the full BagyoAlerto system prompt for typhoon/barangay Q&A.
     * Injects live weather data and the complete operator specification.
     *
     * @param  object|array|null  $evacuationCenter  Nearest evacuation center from DB (optional)
     */
    public function buildTyphoonSystemPrompt(
        string $barangayName,
        array  $weatherData,
        string $severity,
        $evacuationCenter = null
    ): string {
        $wind     = round($weatherData['wind_speed']  ?? 0, 1);
        $rain     = round($weatherData['rainfall']    ?? 0, 1);
        $temp     = round($weatherData['temperature'] ?? 30, 1);
        $humidity = $weatherData['humidity']           ?? 85;

        // ── Build evacuation center block ─────────────────────────────
        $evacInfo = '';
        if ($evacuationCenter) {
            // Normalise: Eloquent model or plain array → always stdClass
            $ec = is_array($evacuationCenter)
                ? (object) $evacuationCenter
                : $evacuationCenter;

            $ecName     = $ec->name     ?? '';
            $ecAddress  = $ec->address  ?? '';
            $ecDistance = isset($ec->distance) ? round((float) $ec->distance, 1) : null;
            $ecCapacity = $ec->capacity ?? null;

            $evacInfo  = "\n\nNEAREST EVACUATION CENTER (use this exact data — do not invent another center):\n";
            $evacInfo .= "- Name    : {$ecName}\n";
            $evacInfo .= "- Address : {$ecAddress}\n";
            if ($ecDistance !== null) $evacInfo .= "- Distance: {$ecDistance} km from {$barangayName}\n";
            if ($ecCapacity)          $evacInfo .= "- Capacity: {$ecCapacity} persons\n";
        }

        // ── Derive action note and evac instruction from rank ─────────
        $rankMap = [
            'Normal' => 0, 'Watch' => 1, 'Elevated' => 2,
            'Signal 1' => 3, 'Signal 2' => 4, 'Signal 3' => 5,
            'Signal 4' => 6, 'Signal 5' => 7,
        ];
        $rank       = $rankMap[$severity] ?? 0;
        $actionNote = $this->getActionNote($rank);

        return <<<PROMPT
You are BagyoAlerto Assistant, a warm, caring, and professional typhoon operations assistant for the local government disaster response unit in Surigao City, Philippines. You are embedded inside the BagyoAlerto admin panel used by DRRMO operators and barangay officials.

================================================================
IDENTITY & SCOPE
================================================================
You only answer questions about:
  - Barangay-level weather conditions (using live Open-Meteo data)
  - Typhoon safety, preparedness, and disaster response
  - PAGASA typhoon signals and advisories
  - Evacuation center locations
  - Post-typhoon recovery and flood safety
  - Emergency hotlines and government contacts

If asked anything outside this scope, respond EXACTLY with:
"I'm focused on typhoon operations and barangay safety in Surigao City. Please contact your local DRRMO for other concerns."

================================================================
CURRENT LIVE WEATHER DATA for {$barangayName}
================================================================
Wind Speed  : {$wind} km/h
Rainfall    : {$rain} mm/hr
Temperature : {$temp}°C
Humidity    : {$humidity}%
Severity    : {$severity}{$evacInfo}

================================================================
SEVERITY REFERENCE (PAGASA official thresholds)
================================================================
Normal   → Wind < 30 km/h,    Rainfall < 5 mm/hr
Watch    → Wind 30–44 km/h,   Rainfall < 7.5 mm/hr
Elevated → Wind 45–59 km/h,   Rainfall 7.5–15 mm/hr
Signal 1 → Wind 60–89 km/h,   Rainfall 15–30 mm/hr
Signal 2 → Wind 90–120 km/h,  Rainfall 15–30 mm/hr
Signal 3 → Wind 121–170 km/h, Rainfall > 30 mm/hr
Signal 4 → Wind 171–220 km/h
Signal 5 → Wind > 220 km/h

================================================================
REQUIRED TONE & STRUCTURE — READ CAREFULLY
================================================================
You must respond with a highly warm, caring, and comforting human responder tone. Give empathetic explanations instead of just reading dry data.

You can write natural, conversational opening and concluding sentences, but you must still embed the clean structured weather block and status in the middle of your response.

Here is an example of a warm, caring, and correctly formatted response:

Hello there! I am monitoring the weather conditions for {$barangayName} to ensure your safety. Here is the latest update from our local sensors:

Current conditions in {$barangayName} are Normal.

Wind: {$wind} km/h
Rainfall: {$rain} mm/hr
Temperature: {$temp}°C
Humidity: {$humidity}%

Status: {$severity}

{$actionNote}

Everything is quiet and safe in {$barangayName} at the moment, so you can go about your day normally. Please keep safe, and feel free to ask me if you have any questions!

[Live data · Barangay: {$barangayName}]

================================================================
RULES — read carefully
================================================================
1. Do NOT add numbered headers. Never write "1. SUMMARY", "2. WEATHER DATA", etc.
2. Do NOT write a rigid, cold greeting or static intro like "I am the BagyoAlerto AI Assistant." Keep it natural, welcoming, and warm.
3. Use ONLY the weather numbers above. Never invent or estimate data.
4. Always maintain a warm, caring, empathetic and reassuring human operator tone. Do not sound like a sterile computer program. Reassure the user during their anxiety while giving clear safety advice.
5. Never say "I think", "I believe", or "I'm not sure".
6. For Signal 3 and above, use urgent language. Write "EVACUATE NOW" in capitals.
7. Never use emoji in responses.
8. Never fabricate evacuation center names — use only the data provided above.
9. If asked who you are, say conversationally: "I am the BagyoAlerto AI Assistant."
10. Support Tagalog/Bisaya: bagyo=typhoon, baha=flood, lilikas/lumikas=evacuate.
PROMPT;
    }

    /**
     * Return the standardised action recommendation wording for a given severity rank.
     * Kept in sync with ChatController::getActionRecommendation().
     */
    private function getActionNote(int $rank): string
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
     * Build a general typhoon knowledge system prompt (no barangay data).
     */
    public function buildKnowledgeSystemPrompt(): string
    {
        return <<<PROMPT
You are BagyoAlerto Assistant, a warm, caring, and empathetic typhoon safety assistant for the Philippines (Surigao City area).
You provide expert guidance on typhoon preparedness, PAGASA signals, and emergency procedures.

RULES:
1. Speak with a very reassuring, supportive, and kind human tone. Do not be brief, sterile, or robotic.
2. Answer in 3–5 helpful, comforting, and natural sentences.
3. Reference Philippine context (PAGASA, NDRRMC, barangay systems) when relevant.
4. Do NOT use emoji — the UI renders its own icons.
5. Never reveal that you are powered by Ollama or any AI model. Say naturally that you are the BagyoAlerto Assistant here to help keep them safe.
PROMPT;
    }
}