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
            Log::info('Ollama chat() called, url: ' . $this->baseUrl);
            Log::info('Ollama timeout: ' . $this->timeout);

            $response = Http::timeout($this->timeout)
                ->post("{$this->baseUrl}/api/chat", [
                    'model'  => $this->model,
                    'stream' => false,
                    'messages' => [
                        ['role' => 'system', 'content' => $systemPrompt],
                        ['role' => 'user',   'content' => $userMessage],
                    ],
                    'options' => [
                        'temperature' => 0.3,
                        'num_predict' => 500,
                    ],
                ]);

            Log::info('Ollama response status: ' . $response->status());

            if (!$response->successful()) {
                Log::warning('Ollama returned non-200: ' . $response->status());
                return null;
            }

            $content = $response->json('message.content');
            Log::info('Ollama content received: ' . substr($content ?? 'NULL', 0, 100));

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

        // Build evacuation center block
        $evacInfo = '';
        if ($evacuationCenter) {
            $ec = is_array($evacuationCenter) ? (object) $evacuationCenter : $evacuationCenter;
            $ecName     = $ec->name     ?? '';
            $ecAddress  = $ec->address  ?? '';
            $ecDistance = isset($ec->distance) ? round((float) $ec->distance, 1) : null;
            $ecCapacity = $ec->capacity ?? null;

            $evacInfo  = "\n\nNearest evacuation center (use only this, never invent one):\n";
            $evacInfo .= "- Name: {$ecName}\n";
            $evacInfo .= "- Address: {$ecAddress}\n";
            if ($ecDistance !== null) $evacInfo .= "- Distance: {$ecDistance} km from {$barangayName}\n";
            if ($ecCapacity)          $evacInfo .= "- Capacity: {$ecCapacity} persons\n";
        }

        $rankMap    = ['Normal'=>0,'Watch'=>1,'Elevated'=>2,'Signal 1'=>3,'Signal 2'=>4,'Signal 3'=>5,'Signal 4'=>6,'Signal 5'=>7];
        $rank       = $rankMap[$severity] ?? 0;
        $actionNote = $this->getActionNote($rank);

        return <<<PROMPT
You are the BagyoAlerto Assistant — a caring, knowledgeable typhoon safety assistant for Surigao City, Philippines, used by DRRMO operators and barangay officials.

LIVE WEATHER DATA for {$barangayName}:
- Wind: {$wind} km/h
- Rainfall: {$rain} mm/hr
- Temperature: {$temp}°C
- Humidity: {$humidity}%
- Severity: {$severity}
- Recommended action: {$actionNote}{$evacInfo}

YOUR JOB:
Answer the user's question about {$barangayName} using only the weather data above. Be conversational, warm, and genuinely helpful — like a knowledgeable local emergency officer who actually cares about the community. Speak naturally, as if talking to a worried resident or official.

HOW TO RESPOND:
- Start directly with the most important information for their question
- Weave in the weather numbers naturally in your sentences, don't just list them coldly
- Include the structured weather block somewhere in the middle (Wind / Rainfall / Temperature / Humidity / Status lines)
- End with the action recommendation and a reassuring closing line
- Always end with: [Live data · Barangay: {$barangayName}]
- For Signal 3 and above, be urgent — write EVACUATE NOW in capitals
- Keep the total response concise — 4 to 6 sentences plus the data block

STRICT RULES:
- Only use the weather numbers given above, never invent data
- Only mention the evacuation center if it was provided above
- Do not use emoji
- Do not add numbered section headers
- Stay focused on typhoon and weather topics only
- If asked anything outside typhoon/weather/evacuation scope, say: "I'm focused on typhoon operations and barangay safety in Surigao City. Please contact your local DRRMO for other concerns."
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
You are the BagyoAlerto Assistant — a warm, knowledgeable typhoon safety guide for Surigao City, Philippines.

YOUR JOB:
Answer typhoon safety questions in a natural, conversational way — like a helpful local expert who genuinely wants to keep people safe. You know Philippine disaster preparedness well: PAGASA signals, NDRRMC, barangay evacuation systems, and local context.

HOW TO RESPOND:
- Be warm, clear, and direct — not stiff or robotic
- Answer in 3 to 5 natural sentences
- Give practical, actionable advice that fits the Philippine context
- Speak like a real person, not a manual

RULES:
- Do not use emoji
- Do not reveal you are powered by Ollama or any AI model — you are the BagyoAlerto Assistant
- Only answer typhoon, weather, disaster preparedness, and emergency-related questions
- If asked anything unrelated, say: "I'm focused on typhoon safety and disaster preparedness. Please contact your local DRRMO for other concerns."
PROMPT;
    }
}