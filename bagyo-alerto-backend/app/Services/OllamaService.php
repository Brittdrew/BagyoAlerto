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
    private int    $historyMessages;
    private int    $numCtx;

    public function __construct()
    {
        $this->baseUrl = config('ollama.url',     'http://localhost:11434');
        $this->model   = config('ollama.model',   'llama3.2');
        $this->timeout = config('ollama.timeout', 30);
        $this->historyMessages = max(1, (int) config('chat.history_messages', 10));
        $this->numCtx = max(1024, (int) config('chat.num_ctx', 8192));
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
     * @param  array<int, array{role?: string, content?: string}>  $history
     * @return string|null            LLM response, or null if unavailable
     */
    public function chat(string $systemPrompt, string $userMessage, array $history = []): ?string
    {
        try {
            Log::info('Ollama chat() called, url: ' . $this->baseUrl . ', model: ' . $this->model);
            Log::info('Ollama timeout: ' . $this->timeout);

            $conversation = $this->prepareConversation($systemPrompt, $history, $userMessage);

            $response = Http::timeout($this->timeout)
                ->post("{$this->baseUrl}/api/chat", [
                    'model'  => $this->model,
                    'stream' => false,
                    'messages' => $conversation,
                    'options' => [
                        'temperature' => 0.3,
                        'num_predict' => 500,
                        'num_ctx' => $this->numCtx,
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
     * Keep the complete system prompt, then the newest configured number of
     * conversation messages. If the context estimate is still too large,
     * discard oldest history first while always preserving the current user
     * message and the unmodified system prompt/snapshot.
     *
     * @param  array<int, array{role?: string, content?: string}>  $history
     * @return array<int, array{role: string, content: string}>
     */
    private function prepareConversation(string $systemPrompt, array $history, string $userMessage): array
    {
        $messages = collect($history)
            ->filter(fn ($message) => is_array($message)
                && in_array($message['role'] ?? null, ['user', 'assistant'], true)
                && is_string($message['content'] ?? null)
                && trim($message['content']) !== '')
            ->map(fn (array $message) => [
                'role' => $message['role'],
                'content' => $message['content'],
            ])
            ->values()
            ->all();

        $messages[] = ['role' => 'user', 'content' => $userMessage];
        $messages = array_slice($messages, -$this->historyMessages);

        // Reserve generation room plus a small allowance for chat-template tokens.
        $inputBudget = max(1, $this->numCtx - 500 - 256);
        while (count($messages) > 1
            && $this->estimatedTokens($systemPrompt, $messages) > $inputBudget) {
            array_shift($messages);
        }

        return array_merge(
            [['role' => 'system', 'content' => $systemPrompt]],
            $messages,
        );
    }

    /** @param array<int, array{role: string, content: string}> $messages */
    private function estimatedTokens(string $systemPrompt, array $messages): int
    {
        $characters = mb_strlen($systemPrompt);
        foreach ($messages as $message) {
            $characters += mb_strlen($message['content']);
        }

        return (int) ceil($characters / 4) + ((count($messages) + 1) * 4);
    }

    /**
     * Build the full Bakwit system prompt for typhoon/barangay Q&A.
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
You are the Bakwit Assistant — a caring, knowledgeable typhoon safety assistant for Surigao City, Philippines, used by DRRMO operators and barangay officials.

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
You are the Bakwit Assistant — a warm, knowledgeable typhoon safety guide for Surigao City, Philippines.

YOUR JOB:
Answer typhoon safety questions in a natural, conversational way — like a helpful local expert who genuinely wants to keep people safe. You know Philippine disaster preparedness well: PAGASA signals, NDRRMC, barangay evacuation systems, and local context.

HOW TO RESPOND:
- Be warm, clear, and direct — not stiff or robotic
- Answer in 3 to 5 natural sentences
- Give practical, actionable advice that fits the Philippine context
- Speak like a real person, not a manual

RULES:
- Do not use emoji
- Do not reveal you are powered by Ollama or any AI model — you are the Bakwit Assistant
- Only answer typhoon, weather, disaster preparedness, and emergency-related questions
- If asked anything unrelated, say: "I'm focused on typhoon safety and disaster preparedness. Please contact your local DRRMO for other concerns."
PROMPT;
    }

    /**
     * Build the LGU/CDRRMO operations prompt with only the live data supplied
     * by the chat controller. Missing values are stated explicitly.
     */
    public function buildAdminSystemPrompt(
        ?string $barangayName = null,
        ?array $weatherData = null,
        ?string $severity = null,
        $evacuationCenter = null,
        ?array $citySnapshot = null
    ): string {
        $basePrompt = (string) config('chat.prompts.admin');

        if ($citySnapshot !== null) {
            return $basePrompt . $this->formatCitywideSnapshot($citySnapshot);
        }

        if (!$barangayName) {
            return $basePrompt . "\n\nOPERATIONAL DATA FOR THIS REQUEST:\n"
                . "- No barangay-specific live data was loaded.\n"
                . "- Citywide barangay risk rankings and center occupancy summaries were not supplied.\n"
                . "State these limitations if the question requires that data.";
        }

        $value = static function ($raw, int $precision = 1): string {
            if ($raw === null || $raw === '' || !is_numeric($raw)) {
                return 'unavailable';
            }

            return number_format((float) $raw, $precision, '.', '');
        };

        $wind = $value($weatherData['wind_speed'] ?? null);
        $rainfall = $value($weatherData['rainfall'] ?? null);
        $pressure = $value($weatherData['pressure'] ?? null, 0);
        $severityLabel = $severity ?: 'unavailable';

        $dataBlock = "\n\nOPERATIONAL DATA FOR THIS REQUEST:\n"
            . "- Barangay: {$barangayName}\n"
            . "- Computed current severity: {$severityLabel}\n"
            . "- Official PAGASA signal: unavailable for this request\n"
            . "- Wind: " . ($wind === 'unavailable' ? $wind : "{$wind} km/h") . "\n"
            . "- Rainfall: " . ($rainfall === 'unavailable' ? $rainfall : "{$rainfall} mm/hr") . "\n"
            . "- Pressure: " . ($pressure === 'unavailable' ? $pressure : "{$pressure} hPa");

        if (!$evacuationCenter) {
            return $basePrompt . $dataBlock
                . "\n- Evacuation center data: unavailable for this request.";
        }

        $center = is_array($evacuationCenter) ? (object) $evacuationCenter : $evacuationCenter;
        $capacity = isset($center->capacity) && is_numeric($center->capacity)
            ? (int) $center->capacity
            : null;
        $occupancy = isset($center->current_occupancy) && is_numeric($center->current_occupancy)
            ? (int) $center->current_occupancy
            : null;
        $remaining = $capacity !== null && $occupancy !== null
            ? max(0, $capacity - $occupancy)
            : null;

        $centerBlock = "\n- Evacuation center: " . ($center->name ?? 'unavailable')
            . "\n- Center capacity: " . ($capacity ?? 'unavailable')
            . "\n- Current occupancy: " . ($occupancy ?? 'unavailable')
            . "\n- Remaining capacity: " . ($remaining ?? 'unavailable')
            . "\n- Flood hazard class: " . ($center->flood_susceptibility ?? 'unavailable')
            . "\n- Landslide hazard class: " . ($center->landslide_susceptibility ?? 'unavailable')
            . "\n- Overall hazard class: " . ($center->hazard_level ?? 'unavailable');

        return $basePrompt . $dataBlock . $centerBlock;
    }

    /**
     * Keep city-wide data to one line per barangay and evacuation center.
     */
    private function formatCitywideSnapshot(array $snapshot): string
    {
        $value = static function ($raw, int $precision = 1, string $unit = ''): string {
            if ($raw === null || $raw === '' || !is_numeric($raw)) {
                return 'unavailable';
            }

            return number_format((float) $raw, $precision, '.', '') . $unit;
        };
        $text = static fn ($raw): string => $raw === null || $raw === ''
            ? 'unavailable'
            : (string) $raw;

        $lines = [
            "\n\nCITY-WIDE OPERATIONAL DATA FOR THIS REQUEST:",
            'Barangays (one line each):',
        ];

        $barangays = $snapshot['barangays'] ?? [];
        if ($barangays === []) {
            $lines[] = '- Barangay data: unavailable';
        } else {
            foreach ($barangays as $barangay) {
                $lines[] = '- ' . $text($barangay['name'] ?? null)
                    . ' | severity=' . $text($barangay['severity'] ?? null)
                    . '; wind=' . $value($barangay['wind_speed'] ?? null, 1, ' km/h')
                    . '; rainfall=' . $value($barangay['rainfall'] ?? null, 1, ' mm/hr')
                    . '; pressure=' . $value($barangay['pressure'] ?? null, 0, ' hPa')
                    . '; PAGASA signal=' . $text($barangay['pagasa_signal'] ?? null);
            }
        }

        $centerSummary = $snapshot['center_summary'] ?? [];
        $lines[] = 'Active evacuation center summary: count='
            . $value($centerSummary['count'] ?? null, 0)
            . '; total capacity=' . $value($centerSummary['total_capacity'] ?? null, 0);
        $lines[] = 'Evacuation centers (one line each):';
        $centers = $snapshot['centers'] ?? [];
        if ($centers === []) {
            $lines[] = '- Evacuation center data: unavailable';
        } else {
            foreach ($centers as $center) {
                $lines[] = '- ' . $text($center['name'] ?? null)
                    . ' | barangay=' . $text($center['barangay_name'] ?? null)
                    . '; capacity=' . $value($center['capacity'] ?? null, 0)
                    . '; occupancy=' . $value($center['current_occupancy'] ?? null, 0)
                    . '; occupancy%=' . $value($center['occupancy_percent'] ?? null, 0, '%')
                    . '; hazard=' . $text($center['hazard_class'] ?? null);
            }
        }

        return implode("\n", $lines);
    }
}
