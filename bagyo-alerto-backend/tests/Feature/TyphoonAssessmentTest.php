<?php

namespace Tests\Feature;

use App\Models\Barangay;
use App\Models\EvacuationCenter;
use App\Models\Recommendation;
use App\Models\TyphoonLog;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class TyphoonAssessmentTest extends TestCase
{
    use DatabaseTransactions;

    private Barangay $barangay;
    private EvacuationCenter $center;

    protected function setUp(): void
    {
        parent::setUp();

        if (config('database.default') === 'sqlite') {
            if (!Schema::hasTable('barangays')) {
                Schema::create('barangays', function ($table) {
                    $table->increments('id');
                    $table->string('name', 100);
                    $table->string('city', 100)->nullable();
                    $table->decimal('latitude', 10, 8);
                    $table->decimal('longitude', 11, 8);
                    $table->string('risk_level', 20)->nullable();
                    $table->timestamp('created_at')->nullable();
                });
            }

            if (!Schema::hasTable('evacuation_centers_list')) {
                Schema::create('evacuation_centers_list', function ($table) {
                    $table->increments('id');
                    $table->string('name', 150);
                    $table->integer('barangay_id');
                    $table->string('address', 255)->nullable();
                    $table->decimal('latitude', 10, 8);
                    $table->decimal('longitude', 11, 8);
                    $table->integer('capacity')->default(0);
                    $table->unsignedInteger('current_occupancy')->default(0);
                    $table->boolean('is_active')->default(1);
                    $table->timestamp('created_at')->nullable();
                });
            }

            if (!Schema::hasTable('typhoon_logs')) {
                Schema::create('typhoon_logs', function ($table) {
                    $table->increments('id');
                    $table->decimal('wind_speed', 5, 2);
                    $table->decimal('rainfall', 5, 2);
                    $table->decimal('pressure', 6, 2);
                    $table->decimal('temperature', 5, 2)->nullable();
                    $table->decimal('humidity', 5, 2)->nullable();
                    $table->string('severity_level', 50);
                    $table->integer('score')->nullable();
                    $table->string('classification')->nullable();
                    $table->string('ml_prediction')->nullable();
                    $table->integer('barangay_id')->nullable();
                    $table->boolean('is_manual')->default(false);
                    $table->timestamp('logged_at')->useCurrent();
                });
            }

            if (!Schema::hasTable('recommendations')) {
                Schema::create('recommendations', function ($table) {
                    $table->increments('id');
                    $table->integer('barangay_id');
                    $table->integer('evacuation_center_id');
                    $table->integer('typhoon_log_id');
                    $table->timestamp('recommended_at')->useCurrent();
                });
            }
        }

        $this->barangay = Barangay::create([
            'name'       => 'Test Barangay ' . uniqid(),
            'city'       => 'Surigao City',
            'latitude'   => 9.784000,
            'longitude'  => 125.488000,
            'risk_level' => 'high',
        ]);

        $this->center = EvacuationCenter::create([
            'name'        => 'Test Evac Center ' . uniqid(),
            'barangay_id' => $this->barangay->id,
            'address'     => '123 Test St',
            'latitude'    => 9.785000,
            'longitude'   => 125.489000,
            'capacity'    => 500,
            'is_active'   => true,
        ]);
    }

    private function normalAssessmentPayload(array $overrides = []): array
    {
        return array_merge([
            'wind_speed'  => 10.0,
            'rainfall'    => 0.0,
            'pressure'    => 1010.0,
            'temperature' => 28.0,
            'humidity'    => 80.0,
            'barangay_id' => $this->barangay->id,
        ], $overrides);
    }

    private function createTyphoonLog(array $overrides = []): int
    {
        return TyphoonLog::query()->insertGetId(array_merge([
            'wind_speed'     => 10.0,
            'rainfall'       => 0.0,
            'pressure'       => 1010.0,
            'temperature'    => 28.0,
            'humidity'       => 80.0,
            'severity_level' => 'low',
            'score'          => 1,
            'classification' => 'Normal',
            'ml_prediction'  => 'Normal',
            'barangay_id'    => $this->barangay->id,
            'is_manual'      => false,
            'logged_at'      => now()->subMinute(),
        ], $overrides));
    }

    private function assertAssessmentJsonShape($response): void
    {
        $response->assertJsonStructure([
            'severity',
            'score',
            'weather',
            'factors' => [
                'wind',
                'pressure',
                'rain',
                'humidity',
                'temp',
            ],
            'classification',
            'ml_prediction',
            'ml_explanation',
            'agreement',
            'message',
            'evacuation_center',
        ]);
    }

    public function test_assess_returns_computed_sub_scores_in_response_and_logs_them(): void
    {
        $payload = [
            'wind_speed'  => 6.7,
            'rainfall'    => 0.0,
            'pressure'    => 1008.5,
            'temperature' => 28.4,
            'humidity'    => 83.0,
            'barangay_id' => $this->barangay->id,
        ];

        $response = $this->postJson('/api/typhoon/assess', $payload);

        $response->assertStatus(200);
        $response->assertJsonStructure([
            'severity',
            'score',
            'weather',
            'factors' => [
                'wind',
                'pressure',
                'rain',
                'humidity',
                'temp',
            ],
            'classification',
            'ml_prediction',
            'ml_explanation',
            'agreement',
            'message',
            'evacuation_center',
        ]);

        $data = $response->json();

        // Exact backend formulas:
        // wind: (6.7 - 30)/320 * 100 clamped -> 0
        // rain: 0.0/60 * 100 -> 0
        // pressure: (1013 - 1008.5)/93 * 100 = 4.8387 -> round to 5
        // humidity: (83 - 85)/15 * 100 clamped -> 0
        // temp: (30 - 28.4)/10 * 100 = 16
        $this->assertEquals(0, $data['factors']['wind']);
        $this->assertEquals(0, $data['factors']['rain']);
        $this->assertEquals(5, $data['factors']['pressure']);
        $this->assertEquals(0, $data['factors']['humidity']);
        $this->assertEquals(16, $data['factors']['temp']);

        // Composite score = round(0*0.35 + 4.8387*0.30 + 0*0.20 + 0*0.10 + 16*0.05) = round(2.2516) = 2
        $this->assertEquals(2, $data['score']);
        $this->assertEquals('low', $data['severity']);
        $this->assertEquals('Normal', $data['classification']);

        // Verify logged in typhoon_logs with all columns
        $this->assertDatabaseHas('typhoon_logs', [
            'wind_speed'     => 6.7,
            'rainfall'       => 0.0,
            'pressure'       => 1008.5,
            'temperature'    => 28.4,
            'humidity'       => 83.0,
            'severity_level' => 'low',
            'score'          => 2,
            'classification' => 'Normal',
            'barangay_id'    => $this->barangay->id,
        ]);
    }

    public function test_source_auto_without_prior_log_for_barangay_creates_one_row(): void
    {
        $before = TyphoonLog::count();

        $response = $this->postJson('/api/typhoon/assess', $this->normalAssessmentPayload([
            'source' => 'auto',
        ]));

        $response->assertStatus(200);
        $this->assertSame($before + 1, TyphoonLog::count());
        $this->assertDatabaseHas('typhoon_logs', [
            'barangay_id'    => $this->barangay->id,
            'severity_level' => 'low',
            'wind_speed'     => 10.0,
        ]);
    }

    public function test_source_auto_with_latest_log_same_severity_creates_no_row_and_returns_assessment_shape(): void
    {
        $this->createTyphoonLog([
            'severity_level' => 'low',
            'logged_at'      => now(),
        ]);
        $before = TyphoonLog::count();

        $response = $this->postJson('/api/typhoon/assess', $this->normalAssessmentPayload([
            'source' => 'auto',
        ]));

        $response->assertStatus(200);
        $this->assertAssessmentJsonShape($response);
        $this->assertSame($before, TyphoonLog::count());
    }

    public function test_source_auto_with_latest_log_different_severity_creates_row(): void
    {
        $this->createTyphoonLog([
            'severity_level' => 'high',
            'logged_at'      => now(),
        ]);
        $before = TyphoonLog::count();

        $response = $this->postJson('/api/typhoon/assess', $this->normalAssessmentPayload([
            'source' => 'auto',
        ]));

        $response->assertStatus(200);
        $this->assertSame($before + 1, TyphoonLog::count());
        $this->assertDatabaseHas('typhoon_logs', [
            'barangay_id'    => $this->barangay->id,
            'severity_level' => 'low',
            'wind_speed'     => 10.0,
        ]);
    }

    public function test_source_manual_with_same_severity_as_latest_log_always_creates_row(): void
    {
        $this->createTyphoonLog([
            'severity_level' => 'low',
            'logged_at'      => now(),
        ]);
        $before = TyphoonLog::count();

        $response = $this->postJson('/api/typhoon/assess', $this->normalAssessmentPayload([
            'source' => 'manual',
        ]));

        $response->assertStatus(200);
        $this->assertSame($before + 1, TyphoonLog::count());
    }

    public function test_missing_or_unknown_source_is_treated_as_manual_and_creates_rows(): void
    {
        $this->createTyphoonLog([
            'severity_level' => 'low',
            'logged_at'      => now(),
        ]);
        $before = TyphoonLog::count();

        $missingSourceResponse = $this->postJson('/api/typhoon/assess', $this->normalAssessmentPayload());
        $unknownSourceResponse = $this->postJson('/api/typhoon/assess', $this->normalAssessmentPayload([
            'source' => 'weather-station',
        ]));

        $missingSourceResponse->assertStatus(200);
        $unknownSourceResponse->assertStatus(200);
        $this->assertSame($before + 2, TyphoonLog::count());
    }

    public function test_source_auto_ignores_existing_log_for_different_barangay_and_creates_row(): void
    {
        $otherBarangay = Barangay::create([
            'name'       => 'Other Test Barangay ' . uniqid(),
            'city'       => 'Surigao City',
            'latitude'   => 9.790000,
            'longitude'  => 125.490000,
            'risk_level' => 'low',
        ]);

        $this->createTyphoonLog([
            'barangay_id' => $otherBarangay->id,
            'logged_at'   => now(),
        ]);
        $before = TyphoonLog::count();

        $response = $this->postJson('/api/typhoon/assess', $this->normalAssessmentPayload([
            'source' => 'auto',
        ]));

        $response->assertStatus(200);
        $this->assertSame($before + 1, TyphoonLog::count());
        $this->assertDatabaseHas('typhoon_logs', [
            'barangay_id'    => $this->barangay->id,
            'severity_level' => 'low',
            'wind_speed'     => 10.0,
        ]);
    }

    public function test_source_auto_skipped_write_creates_no_recommendation_row(): void
    {
        $this->createTyphoonLog([
            'severity_level' => 'low',
            'logged_at'      => now(),
        ]);
        $beforeLogs = TyphoonLog::count();
        $beforeRecommendations = Recommendation::count();

        $response = $this->postJson('/api/typhoon/assess', $this->normalAssessmentPayload([
            'source' => 'auto',
        ]));

        $response->assertStatus(200);
        $this->assertSame($beforeLogs, TyphoonLog::count());
        $this->assertSame($beforeRecommendations, Recommendation::count());
    }

    public function test_catastrophic_severity_triggers_evacuation_behavior_matching_critical(): void
    {
        // 1. Critical assessment (wind 105 km/h -> Signal 3 [89-117] -> rank 5 -> critical)
        $criticalPayload = [
            'wind_speed'  => 105.0,
            'rainfall'    => 20.0,
            'pressure'    => 970.0,
            'temperature' => 24.0,
            'humidity'    => 90.0,
            'barangay_id' => $this->barangay->id,
        ];

        $criticalResponse = $this->postJson('/api/typhoon/assess', $criticalPayload);
        $criticalResponse->assertStatus(200);
        $criticalData = $criticalResponse->json();

        $this->assertEquals('critical', $criticalData['severity']);
        $this->assertEquals('Signal 3', $criticalData['classification']);
        $this->assertNotNull($criticalData['evacuation_center']);
        $this->assertEquals($this->center->id, $criticalData['evacuation_center']['id']);

        // 2. Catastrophic assessment (wind 230 km/h -> Signal 5 [>=185] -> rank 7 -> catastrophic)
        $catastrophicPayload = [
            'wind_speed'  => 230.0,
            'rainfall'    => 50.0,
            'pressure'    => 930.0,
            'temperature' => 22.0,
            'humidity'    => 98.0,
            'barangay_id' => $this->barangay->id,
        ];

        $catastrophicResponse = $this->postJson('/api/typhoon/assess', $catastrophicPayload);
        $catastrophicResponse->assertStatus(200);
        $catastrophicData = $catastrophicResponse->json();

        // Verify catastrophic severity is returned and handled cleanly
        $this->assertEquals('catastrophic', $catastrophicData['severity']);
        $this->assertEquals('Signal 5', $catastrophicData['classification']);
        $this->assertNotNull($catastrophicData['evacuation_center']);
        $this->assertEquals($this->center->id, $catastrophicData['evacuation_center']['id']);

        // Verify database persistence for catastrophic
        $this->assertDatabaseHas('typhoon_logs', [
            'wind_speed'     => 230.0,
            'severity_level' => 'catastrophic',
            'barangay_id'    => $this->barangay->id,
        ]);

        // Verify recommendation created for both critical and catastrophic
        $catastrophicLog = TyphoonLog::where('severity_level', 'catastrophic')
            ->orderBy('id', 'desc')
            ->first();

        $this->assertNotNull($catastrophicLog);
        $this->assertDatabaseHas('recommendations', [
            'barangay_id'          => $this->barangay->id,
            'evacuation_center_id' => $this->center->id,
            'typhoon_log_id'       => $catastrophicLog->id,
        ]);
    }

    public function test_wind_driven_classification_matches_pagasa_thresholds(): void
    {
        $cases = [
            ['wind' => 25.0,  'expected' => 'Normal'],
            ['wind' => 45.0,  'expected' => 'Signal 1'], // 39-61
            ['wind' => 75.0,  'expected' => 'Signal 2'], // 62-88
            ['wind' => 100.0, 'expected' => 'Signal 3'], // 89-117
            ['wind' => 140.0, 'expected' => 'Signal 4'], // 118-184
            ['wind' => 200.0, 'expected' => 'Signal 5'], // >= 185
        ];

        foreach ($cases as $case) {
            $payload = [
                'wind_speed'  => $case['wind'],
                'rainfall'    => 0.0,
                'pressure'    => 1010.0,
                'temperature' => 29.0,
                'humidity'    => 80.0,
                'barangay_id' => $this->barangay->id,
            ];

            $res = $this->postJson('/api/typhoon/assess', $payload);
            $res->assertStatus(200);
            $data = $res->json();
            $this->assertEquals($case['expected'], $data['classification'], "Failed for wind {$case['wind']}");
        }
    }

    // ── New: input validation (422) ───────────────────────────────────────────

    public function test_422_returned_for_out_of_range_wind_speed(): void
    {
        $response = $this->postJson('/api/typhoon/assess', [
            'wind_speed'  => 500,   // > 400 max
            'rainfall'    => 0.0,
            'pressure'    => 1010.0,
            'temperature' => 28.0,
            'humidity'    => 80.0,
            'barangay_id' => $this->barangay->id,
        ]);
        $response->assertStatus(422);
        $response->assertJsonValidationErrors(['wind_speed']);
    }

    public function test_422_returned_for_out_of_range_rainfall(): void
    {
        $response = $this->postJson('/api/typhoon/assess', [
            'wind_speed'  => 10.0,
            'rainfall'    => 400,   // > 300 max
            'pressure'    => 1010.0,
            'temperature' => 28.0,
            'humidity'    => 80.0,
            'barangay_id' => $this->barangay->id,
        ]);
        $response->assertStatus(422);
        $response->assertJsonValidationErrors(['rainfall']);
    }

    public function test_422_returned_for_out_of_range_pressure(): void
    {
        $response = $this->postJson('/api/typhoon/assess', [
            'wind_speed'  => 10.0,
            'rainfall'    => 0.0,
            'pressure'    => 700,   // < 850 min
            'temperature' => 28.0,
            'humidity'    => 80.0,
            'barangay_id' => $this->barangay->id,
        ]);
        $response->assertStatus(422);
        $response->assertJsonValidationErrors(['pressure']);
    }

    public function test_422_returned_for_out_of_range_temperature(): void
    {
        $response = $this->postJson('/api/typhoon/assess', [
            'wind_speed'  => 10.0,
            'rainfall'    => 0.0,
            'pressure'    => 1010.0,
            'temperature' => 99,   // > 50 max
            'humidity'    => 80.0,
            'barangay_id' => $this->barangay->id,
        ]);
        $response->assertStatus(422);
        $response->assertJsonValidationErrors(['temperature']);
    }

    public function test_422_returned_for_out_of_range_humidity(): void
    {
        $response = $this->postJson('/api/typhoon/assess', [
            'wind_speed'  => 10.0,
            'rainfall'    => 0.0,
            'pressure'    => 1010.0,
            'temperature' => 28.0,
            'humidity'    => 150,   // > 100 max
            'barangay_id' => $this->barangay->id,
        ]);
        $response->assertStatus(422);
        $response->assertJsonValidationErrors(['humidity']);
    }

    public function test_422_returned_for_nonexistent_barangay_id(): void
    {
        $response = $this->postJson('/api/typhoon/assess', [
            'wind_speed'  => 10.0,
            'rainfall'    => 0.0,
            'pressure'    => 1010.0,
            'temperature' => 28.0,
            'humidity'    => 80.0,
            'barangay_id' => 999999,  // does not exist
        ]);
        $response->assertStatus(422);
        $response->assertJsonValidationErrors(['barangay_id']);
    }

    public function test_422_error_body_contains_clear_messages(): void
    {
        $response = $this->postJson('/api/typhoon/assess', [
            'wind_speed'  => -5,    // < 0 min
            'rainfall'    => 0.0,
            'pressure'    => 1010.0,
            'temperature' => 28.0,
            'humidity'    => 80.0,
            'barangay_id' => $this->barangay->id,
        ]);
        $response->assertStatus(422);
        $data = $response->json();
        $this->assertArrayHasKey('errors', $data);
        $this->assertNotEmpty($data['errors']['wind_speed'] ?? []);
        // Custom message: "Wind speed must be at least 0 km/h."
        $this->assertStringContainsStringIgnoringCase('wind speed', $data['errors']['wind_speed'][0]);
    }

    // ── New: throttle test ────────────────────────────────────────────────────

    public function test_throttle_returns_429_after_20_requests(): void
    {
        $payload = [
            'wind_speed'  => 10.0,
            'rainfall'    => 0.0,
            'pressure'    => 1010.0,
            'temperature' => 28.0,
            'humidity'    => 80.0,
            'barangay_id' => $this->barangay->id,
        ];

        // Fire 20 requests (the limit) – all should succeed
        for ($i = 0; $i < 20; $i++) {
            $this->postJson('/api/typhoon/assess', $payload)->assertStatus(200);
        }

        // The 21st request should be throttled
        $response = $this->postJson('/api/typhoon/assess', $payload);
        $response->assertStatus(429);
    }

    // ── New: is_manual storage ───────────────────────────────────────────────

    public function test_is_manual_true_stored_when_manual_override_sent(): void
    {
        $response = $this->postJson('/api/typhoon/assess', [
            'wind_speed'      => 10.0,
            'rainfall'        => 0.0,
            'pressure'        => 1010.0,
            'temperature'     => 28.0,
            'humidity'        => 80.0,
            'barangay_id'     => $this->barangay->id,
            'manual_override' => true,
        ]);
        $response->assertStatus(200);

        $this->assertDatabaseHas('typhoon_logs', [
            'barangay_id' => $this->barangay->id,
            'is_manual'   => true,
            'wind_speed'  => 10.0,
        ]);
    }

    public function test_is_manual_false_stored_by_default(): void
    {
        $response = $this->postJson('/api/typhoon/assess', [
            'wind_speed'  => 10.0,
            'rainfall'    => 0.0,
            'pressure'    => 1010.0,
            'temperature' => 28.0,
            'humidity'    => 80.0,
            'barangay_id' => $this->barangay->id,
            // no manual_override key
        ]);
        $response->assertStatus(200);

        $this->assertDatabaseHas('typhoon_logs', [
            'barangay_id' => $this->barangay->id,
            'is_manual'   => false,
            'wind_speed'  => 10.0,
        ]);
    }

    // ── New: no recommendation for manual runs ───────────────────────────────

    public function test_no_recommendation_row_created_for_manual_assessment(): void
    {
        $before = Recommendation::count();

        $this->postJson('/api/typhoon/assess', [
            'wind_speed'      => 50.0,
            'rainfall'        => 5.0,
            'pressure'        => 1005.0,
            'temperature'     => 28.0,
            'humidity'        => 80.0,
            'barangay_id'     => $this->barangay->id,
            'manual_override' => true,
        ])->assertStatus(200);

        $this->assertSame(
            $before,
            Recommendation::count(),
            'No Recommendation row should be created for manual assessments'
        );
    }

    public function test_recommendation_row_created_for_real_assessment(): void
    {
        $before = Recommendation::count();

        $this->postJson('/api/typhoon/assess', [
            'wind_speed'  => 50.0,
            'rainfall'    => 5.0,
            'pressure'    => 1005.0,
            'temperature' => 28.0,
            'humidity'    => 80.0,
            'barangay_id' => $this->barangay->id,
            // manual_override omitted → real assessment
        ])->assertStatus(200);

        $this->assertSame(
            $before + 1,
            Recommendation::count(),
            'A Recommendation row should be created for real assessments'
        );
    }

    // ── New: History endpoint excludes manual rows ───────────────────────────

    public function test_recommendations_endpoint_excludes_manual_rows(): void
    {
        // Real assessment → Recommendation row created
        $this->postJson('/api/typhoon/assess', [
            'wind_speed'  => 50.0,
            'rainfall'    => 5.0,
            'pressure'    => 1005.0,
            'temperature' => 28.0,
            'humidity'    => 80.0,
            'barangay_id' => $this->barangay->id,
        ])->assertStatus(200);

        // Manual assessment → no Recommendation row at all
        $this->postJson('/api/typhoon/assess', [
            'wind_speed'      => 60.0,
            'rainfall'        => 10.0,
            'pressure'        => 995.0,
            'temperature'     => 26.0,
            'humidity'        => 85.0,
            'barangay_id'     => $this->barangay->id,
            'manual_override' => true,
        ])->assertStatus(200);

        // GET /recommendations should contain only non-manual entries
        $history = $this->getJson('/api/recommendations');
        $history->assertStatus(200);

        $data = $history->json();

        // Every returned recommendation must link to a non-manual typhoon_log
        foreach ($data as $rec) {
            $logId = $rec['typhoon_log_id'];
            $log   = TyphoonLog::find($logId);
            $this->assertNotNull($log);
            $this->assertFalse(
                (bool) $log->is_manual,
                "Recommendation {$rec['id']} links to a manual log (id: {$logId})"
            );
        }

        // The real assessment's recommendation should appear in history
        $realLog = TyphoonLog::where('is_manual', false)
            ->where('barangay_id', $this->barangay->id)
            ->where('wind_speed', 50.0)
            ->first();
        $this->assertNotNull($realLog);
        $this->assertTrue(
            collect($data)->contains('typhoon_log_id', $realLog->id),
            'Real assessment should appear in history'
        );
    }
}
