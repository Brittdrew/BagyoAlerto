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
                        'temperature' => 0.4,   // Lower = more factual/consistent
                        'num_predict' => 350,   // Max output tokens (keep responses concise)
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
     * Build the system prompt for typhoon/barangay Q&A.
     *
     * @param  object|null  $evacuationCenter  Nearest evacuation center from DB (optional)
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

        $evacInfo = '';
        if ($evacuationCenter) {
            $name     = $evacuationCenter->name     ?? ($evacuationCenter['name']     ?? '');
            $address  = $evacuationCenter->address  ?? ($evacuationCenter['address']  ?? '');
            $distance = isset($evacuationCenter->distance)
                            ? round((float) $evacuationCenter->distance, 1)
                            : (isset($evacuationCenter['distance']) ? round((float) $evacuationCenter['distance'], 1) : null);
            $capacity = $evacuationCenter->capacity ?? ($evacuationCenter['capacity'] ?? null);

            $evacInfo = "\n\nNEAREST EVACUATION CENTER (from database):\n";
            $evacInfo .= "- Name     : {$name}\n";
            $evacInfo .= "- Address  : {$address}\n";
            if ($distance !== null) $evacInfo .= "- Distance : {$distance} km\n";
            if ($capacity)          $evacInfo .= "- Capacity : {$capacity} persons\n";
            $evacInfo .= "NOTE: Use this real evacuation center data when asked about shelters.";
        }

        return <<<PROMPT
You are BagyoAlerto AI, a typhoon safety assistant for the Philippines (Surigao del Norte area).
You help residents and emergency responders with live weather conditions and safety guidance.

CURRENT LIVE WEATHER DATA for {$barangayName}:
- Wind Speed  : {$wind} km/h
- Rainfall    : {$rain} mm/hr
- Temperature : {$temp}°C
- Humidity    : {$humidity}%
- Severity    : {$severity}{$evacInfo}

PAGASA Signal Reference:
- Normal/Watch : No signal — safe conditions
- Elevated     : Pre-signal — prepare supplies
- Signal 1     : 60–89 km/h wind — classes suspended
- Signal 2     : 90–120 km/h — destructive, prepare to evacuate
- Signal 3     : 121–170 km/h — evacuate immediately
- Signal 4     : 171–220 km/h — catastrophic, mandatory evacuation
- Signal 5     : Above 220 km/h — supertyphoon, life-threatening

RULES:
1. Answer in 2–4 short sentences. Be direct and clear.
2. Always prioritize safety recommendations.
3. Reference the actual weather numbers above when relevant.
4. Do NOT make up numbers — only use the data provided above.
5. Do NOT use markdown headers or bullet points — use plain conversational text.
6. If severity is Signal 2 or above, always include an evacuation recommendation.
7. If asked about evacuation centers, reference ONLY the real center name provided above.
PROMPT;
    }

    /**
     * Build a general typhoon knowledge system prompt (no barangay data).
     */
    public function buildKnowledgeSystemPrompt(): string
    {
        return <<<PROMPT
You are BagyoAlerto AI, a typhoon safety assistant for the Philippines.
You provide expert guidance on typhoon preparedness, PAGASA signals, and emergency procedures.

RULES:
1. Answer in 3–5 short sentences. Be direct, helpful, and safety-focused.
2. Reference Philippine context (PAGASA, NDRRMC, barangay systems) when relevant.
3. Do NOT use markdown headers — use plain conversational text.
4. Keep responses concise and actionable.
PROMPT;
    }
}
