<?php

namespace Tests\Feature;

use App\Models\Admin;
use App\Models\Barangay;
use App\Models\EvacuationCenter;
use App\Models\EvacuationLog;
use App\Services\OllamaService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ChatContextPromptTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();

        if (! Schema::hasTable('barangays')) {
            Schema::create('barangays', function ($table) {
                $table->increments('id');
                $table->string('name');
                $table->decimal('latitude', 10, 8)->nullable();
                $table->decimal('longitude', 11, 8)->nullable();
            });
        }

        if (! Schema::hasTable('evacuation_centers_list')) {
            Schema::create('evacuation_centers_list', function ($table) {
                $table->increments('id');
                $table->string('name');
                $table->unsignedInteger('barangay_id');
                $table->string('address')->nullable();
                $table->decimal('latitude', 10, 8)->nullable();
                $table->decimal('longitude', 11, 8)->nullable();
                $table->unsignedInteger('capacity')->nullable();
                $table->unsignedInteger('current_occupancy')->default(0);
                $table->boolean('is_active')->default(true);
                $table->string('flood_susceptibility')->nullable();
                $table->string('landslide_susceptibility')->nullable();
            });
        }

        if (! Schema::hasTable('evacuation_logs')) {
            Schema::create('evacuation_logs', function ($table) {
                $table->id();
                $table->unsignedInteger('evacuation_center_id');
                $table->string('type', 20);
                $table->unsignedInteger('headcount');
                $table->timestamps();
            });
        }

        if (! Schema::hasTable('chat_logs')) {
            Schema::create('chat_logs', function ($table) {
                $table->id();
                $table->string('barangay_name')->nullable();
                $table->text('question');
                $table->text('answer');
                $table->string('severity')->nullable();
                $table->float('wind')->nullable();
                $table->float('rainfall')->nullable();
                $table->float('pressure')->nullable();
                $table->float('temperature')->nullable();
                $table->float('humidity')->nullable();
                $table->string('asked_by')->default('admin');
                $table->timestamps();
            });
        }

        if (! Schema::hasTable('typhoon_logs')) {
            Schema::create('typhoon_logs', function ($table) {
                $table->increments('id');
                $table->decimal('wind_speed', 5, 2);
                $table->decimal('rainfall', 5, 2);
                $table->decimal('pressure', 6, 2);
                $table->decimal('temperature', 5, 2)->nullable();
                $table->decimal('humidity', 5, 2)->nullable();
                $table->string('severity_level');
                $table->integer('score')->nullable();
                $table->string('classification')->nullable();
                $table->string('ml_prediction')->nullable();
                $table->unsignedInteger('barangay_id')->nullable();
                $table->boolean('is_manual')->default(false);
                $table->timestamp('logged_at')->useCurrent();
            });
        }

        if (! Schema::hasTable('recommendations')) {
            Schema::create('recommendations', function ($table) {
                $table->increments('id');
                $table->unsignedInteger('barangay_id');
                $table->unsignedInteger('evacuation_center_id');
                $table->unsignedInteger('typhoon_log_id');
                $table->timestamps();
            });
        }
    }

    public function test_admin_citywide_prompt_includes_center_occupancy_while_resident_prompt_does_not(): void
    {
        $ollamaUrl = rtrim((string) config('ollama.url'), '/');

        $barangay = Barangay::create([
            'name' => 'Test Barangay',
            'latitude' => 9.789,
            'longitude' => 125.495,
        ]);
        $center = EvacuationCenter::create([
            'name' => 'City Hall Evacuation Center',
            'barangay_id' => $barangay->id,
            'capacity' => 100,
            'current_occupancy' => 0,
            'is_active' => true,
            'flood_susceptibility' => 'moderate',
            'landslide_susceptibility' => 'low',
        ]);
        EvacuationLog::create([
            'evacuation_center_id' => $center->id,
            'type' => 'arrival',
            'headcount' => 45,
        ]);
        EvacuationLog::create([
            'evacuation_center_id' => $center->id,
            'type' => 'departure',
            'headcount' => 5,
        ]);

        Http::fake([
            'https://api.open-meteo.com/v1/forecast*' => Http::response([
                'current' => [
                    'time' => '2026-10-30T12:00',
                    'wind_speed_10m' => 28.5,
                    'precipitation' => 3.2,
                    'surface_pressure' => 1007,
                    'temperature_2m' => 29,
                    'relative_humidity_2m' => 88,
                    'wind_gusts_10m' => 35,
                ],
                'hourly' => [
                    'time' => ['2026-10-30T12:00'],
                    'wind_speed_10m' => [28.5],
                    'temperature_2m' => [29],
                ],
            ], 200),
            "{$ollamaUrl}/api/tags" => Http::response(['models' => []], 200),
            "{$ollamaUrl}/api/chat" => Http::response([
                'message' => ['content' => 'Test assistant response.'],
            ], 200),
        ]);

        Sanctum::actingAs(new Admin([
            'name' => 'Super Admin',
            'username' => 'admin',
        ]));

        $this->postJson('/api/chat', [
            'question' => 'Summarize current conditions',
            'context' => 'admin',
        ])->assertOk();

        $this->postJson('/api/chat', [
            'question' => 'Explain how a typhoon eyewall affects wind conditions.',
        ])->assertOk();

        $chatRequests = collect(Http::recorded())
            ->filter(fn (array $pair) => $pair[0]->method() === 'POST'
                && $pair[0]->url() === "{$ollamaUrl}/api/chat")
            ->values();

        $this->assertCount(2, $chatRequests);

        $adminPrompt = $chatRequests[0][0]->data()['messages'][0]['content'];
        $residentPrompt = $chatRequests[1][0]->data()['messages'][0]['content'];

        $this->assertStringContainsString((string) config('chat.prompts.admin'), $adminPrompt);
        $this->assertStringContainsString('LGU and CDRRMO staff', $adminPrompt);
        $this->assertStringContainsString(
            '- City Hall Evacuation Center | barangay=Test Barangay; capacity=100; occupancy=40; occupancy%=40%; hazard=moderate',
            $adminPrompt
        );
        $this->assertStringContainsString('warm, knowledgeable typhoon safety guide', $residentPrompt);
        $this->assertStringNotContainsString('LGU and CDRRMO staff', $residentPrompt);
        $this->assertStringNotContainsString('City Hall Evacuation Center', $residentPrompt);
        $this->assertStringNotContainsString('occupancy%=40%', $residentPrompt);
    }

    public function test_citywide_snapshot_severity_and_capacity_match_assessment_and_dashboard(): void
    {
        $ollamaUrl = rtrim((string) config('ollama.url'), '/');
        $barangay = Barangay::create([
            'name' => 'Snapshot Totals Barangay',
            'latitude' => 9.789,
            'longitude' => 125.495,
        ]);

        EvacuationCenter::create([
            'name' => 'Active Snapshot Center',
            'barangay_id' => $barangay->id,
            'latitude' => 9.790,
            'longitude' => 125.496,
            'capacity' => 250,
            'is_active' => true,
        ]);
        EvacuationCenter::create([
            'name' => 'Inactive Snapshot Center',
            'barangay_id' => $barangay->id,
            'latitude' => 9.791,
            'longitude' => 125.497,
            'capacity' => 999,
            'is_active' => false,
        ]);

        Http::fake([
            'https://api.open-meteo.com/v1/forecast*' => Http::response([
                'current' => [
                    'time' => '2026-10-30T12:00',
                    'wind_speed_10m' => 30,
                    'precipitation' => 3.2,
                    'surface_pressure' => 1007,
                    'temperature_2m' => 29,
                    'relative_humidity_2m' => 88,
                    'wind_gusts_10m' => 35,
                ],
                'hourly' => [
                    'time' => ['2026-10-30T12:00'],
                    'wind_speed_10m' => [30],
                    'temperature_2m' => [29],
                ],
            ], 200),
            "{$ollamaUrl}/api/tags" => Http::response(['models' => []], 200),
            "{$ollamaUrl}/api/chat" => Http::response([
                'message' => ['content' => 'Test assistant response.'],
            ], 200),
        ]);

        Sanctum::actingAs(new Admin([
            'name' => 'Super Admin',
            'username' => 'admin',
        ]));

        $weather = $this->getJson("/api/barangays/{$barangay->id}/weather")
            ->assertOk()
            ->json('current');
        $assessment = $this->postJson('/api/typhoon/assess', [
            'wind_speed' => $weather['wind_speed'],
            'rainfall' => $weather['rainfall'],
            'pressure' => $weather['pressure'],
            'temperature' => $weather['temperature'],
            'humidity' => $weather['humidity'],
            'barangay_id' => $barangay->id,
            'manual_override' => true,
        ])->assertOk()->json();
        $dashboard = $this->getJson('/api/admin/stats')->assertOk()->json();
        $this->postJson('/api/chat', [
            'question' => 'Summarize current conditions',
            'context' => 'admin',
        ])->assertOk();

        $request = collect(Http::recorded())
            ->first(fn (array $pair) => $pair[0]->method() === 'POST'
                && $pair[0]->url() === "{$ollamaUrl}/api/chat")[0];
        $prompt = $request->data()['messages'][0]['content'];
        $centerSection = explode('Evacuation centers (one line each):', $prompt, 2)[1] ?? '';
        preg_match(
            '/Active evacuation center summary: count=([0-9,]+); total capacity=([0-9,]+)/',
            $prompt,
            $centerSummary,
        );
        preg_match(
            '/^- Snapshot Totals Barangay \| severity=([^;]+);/m',
            $prompt,
            $barangaySnapshot,
        );

        $this->assertSame($assessment['classification'], $barangaySnapshot[1] ?? null);
        $this->assertSame(
            (int) $dashboard['total_evacuation_centers'],
            (int) str_replace(',', '', $centerSummary[1] ?? ''),
        );
        $this->assertSame(
            (int) $dashboard['total_capacity'],
            (int) str_replace(',', '', $centerSummary[2] ?? ''),
        );
        $this->assertStringNotContainsString('Inactive Snapshot Center', $centerSection);
    }

    public function test_long_conversation_keeps_system_prompt_and_latest_ten_messages(): void
    {
        config()->set('chat.history_messages', 10);
        config()->set('chat.num_ctx', 8192);
        $ollamaUrl = rtrim((string) config('ollama.url'), '/');

        Http::fake([
            "{$ollamaUrl}/api/chat" => Http::response([
                'message' => ['content' => 'Latest response.'],
            ], 200),
        ]);

        $history = [];
        for ($number = 1; $number <= 12; $number++) {
            $history[] = [
                'role' => $number % 2 === 0 ? 'assistant' : 'user',
                'content' => "Conversation message {$number}",
            ];
        }

        $systemPrompt = 'SYSTEM PROMPT AND CITY-WIDE SNAPSHOT MUST REMAIN INTACT';
        (new OllamaService())->chat($systemPrompt, 'Conversation message 13', $history);

        $request = collect(Http::recorded())
            ->first(fn (array $pair) => $pair[0]->method() === 'POST'
                && $pair[0]->url() === "{$ollamaUrl}/api/chat")[0];
        $payload = $request->data();
        $messages = $payload['messages'];

        $this->assertCount(11, $messages);
        $this->assertSame(['role' => 'system', 'content' => $systemPrompt], $messages[0]);
        $this->assertSame(
            array_map(fn (int $number): string => "Conversation message {$number}", range(4, 13)),
            array_column(array_slice($messages, 1), 'content')
        );
        $this->assertSame(8192, $payload['options']['num_ctx']);
    }
}
