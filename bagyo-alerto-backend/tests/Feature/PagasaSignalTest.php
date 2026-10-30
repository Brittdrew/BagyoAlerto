<?php

namespace Tests\Feature;

use App\Models\Admin;
use App\Models\Barangay;
use App\Models\EvacuationCenter;
use App\Models\PagasaSignal;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Schema;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class PagasaSignalTest extends TestCase
{
    use DatabaseTransactions;

    protected User $user;

    protected Admin $admin;

    protected Barangay $barangay;

    protected EvacuationCenter $center;

    protected function setUp(): void
    {
        parent::setUp();

        if (config('database.default') === 'sqlite') {
            if (! Schema::hasTable('users')) {
                Schema::create('users', function ($table) {
                    $table->increments('id');
                    $table->string('name');
                    $table->string('email')->unique();
                    $table->timestamp('email_verified_at')->nullable();
                    $table->string('password');
                    $table->rememberToken();
                    $table->timestamps();
                });
            }

            if (! Schema::hasTable('personal_access_tokens')) {
                Schema::create('personal_access_tokens', function ($table) {
                    $table->increments('id');
                    $table->morphs('tokenable');
                    $table->string('name');
                    $table->string('token', 64)->unique();
                    $table->text('abilities')->nullable();
                    $table->timestamp('last_used_at')->nullable();
                    $table->timestamp('expires_at')->nullable();
                    $table->timestamps();
                });
            }

            if (! Schema::hasTable('admins')) {
                Schema::create('admins', function ($table) {
                    $table->increments('id');
                    $table->string('name');
                    $table->string('username')->unique();
                    $table->string('password');
                    $table->timestamp('created_at')->nullable();
                });
            }

            if (! Schema::hasTable('barangays')) {
                Schema::create('barangays', function ($table) {
                    $table->increments('id');
                    $table->string('name', 100);
                    $table->string('city', 100)->nullable();
                    $table->decimal('latitude', 10, 8)->nullable();
                    $table->decimal('longitude', 11, 8)->nullable();
                    $table->string('risk_level', 20)->nullable();
                    $table->timestamp('created_at')->nullable();
                });
            }

            if (! Schema::hasTable('evacuation_centers_list')) {
                Schema::create('evacuation_centers_list', function ($table) {
                    $table->increments('id');
                    $table->string('name', 150);
                    $table->integer('barangay_id');
                    $table->string('address', 255)->nullable();
                    $table->decimal('latitude', 10, 8)->nullable();
                    $table->decimal('longitude', 11, 8)->nullable();
                    $table->integer('capacity')->default(0);
                    $table->unsignedInteger('current_occupancy')->default(0);
                    $table->boolean('is_active')->default(1);
                    $table->timestamp('created_at')->nullable();
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
                    $table->string('severity_level', 50);
                    $table->integer('score')->nullable();
                    $table->string('classification')->nullable();
                    $table->string('ml_prediction')->nullable();
                    $table->integer('barangay_id')->nullable();
                    $table->boolean('is_manual')->default(false);
                    $table->timestamp('logged_at')->useCurrent();
                });
            }

            if (! Schema::hasTable('recommendations')) {
                Schema::create('recommendations', function ($table) {
                    $table->increments('id');
                    $table->integer('barangay_id');
                    $table->integer('evacuation_center_id');
                    $table->integer('typhoon_log_id');
                    $table->timestamp('recommended_at')->useCurrent();
                });
            }

            if (! Schema::hasTable('pagasa_signals')) {
                Schema::create('pagasa_signals', function ($table) {
                    $table->increments('id');
                    $table->unsignedTinyInteger('signal');
                    $table->unsignedBigInteger('set_by')->nullable();
                    $table->string('source', 10)->default('manual');
                    $table->timestamp('created_at')->useCurrent();
                });
            }
        }

        $this->admin = Admin::firstOrCreate(
            ['username' => 'admin'],
            ['name' => 'Super Admin', 'password' => bcrypt('admin123')]
        );

        $this->user = User::firstOrCreate(
            ['email' => 'testuser@example.com'],
            ['name' => 'Test User', 'password' => bcrypt('password')]
        );

        $this->barangay = Barangay::create([
            'name' => 'Test Barangay '.uniqid(),
            'city' => 'Surigao City',
            'latitude' => 9.784000,
            'longitude' => 125.488000,
            'risk_level' => 'high',
        ]);

        $this->center = EvacuationCenter::create([
            'name' => 'Test Evac Center '.uniqid(),
            'barangay_id' => $this->barangay->id,
            'address' => '123 Test St',
            'latitude' => 9.785000,
            'longitude' => 125.489000,
            'capacity' => 500,
            'is_active' => true,
        ]);

        PagasaSignal::clearCache();
    }

    protected function tearDown(): void
    {
        PagasaSignal::clearCache();
        parent::tearDown();
    }

    private function lowSeverityPayload(): array
    {
        return [
            'wind_speed' => 10.0,
            'rainfall' => 0.0,
            'pressure' => 1010.0,
            'temperature' => 28.0,
            'humidity' => 80.0,
            'barangay_id' => $this->barangay->id,
        ];
    }

    private function highSeverityPayload(): array
    {
        return [
            'wind_speed' => 120.0, // Triggers Signal 4 override -> catastrophic
            'rainfall' => 40.0,
            'pressure' => 950.0,
            'temperature' => 25.0,
            'humidity' => 95.0,
            'barangay_id' => $this->barangay->id,
        ];
    }

    /**
     * floor raises a low computed severity to the floor level and sets floor_applied=true
     */
    public function test_floor_raises_low_computed_severity_to_floor_level_and_sets_floor_applied_true(): void
    {
        // Signal 1 has floor 'high' (0 => none, 1 => high, 2 => high, 3 => critical, 4 => catastrophic, 5 => catastrophic)
        PagasaSignal::create([
            'signal' => 1,
            'set_by' => $this->admin->id,
            'created_at' => now(),
        ]);
        PagasaSignal::clearCache();

        $response = $this->postJson('/api/typhoon/assess', $this->lowSeverityPayload());

        $response->assertOk();
        $response->assertJson([
            'severity' => 'high',
            'computed_severity' => 'low',
            'pagasa_signal' => 1,
            'floor_applied' => true,
        ]);
    }

    /**
     * with signal 3 set and calm weather, the response has severity=critical, floor_applied=true,
     * and a message that is NOT the "Conditions are normal" text
     */
    public function test_signal_three_with_calm_weather_sets_critical_and_non_normal_message(): void
    {
        // Signal 3 has floor 'critical'
        PagasaSignal::create([
            'signal' => 3,
            'set_by' => $this->admin->id,
            'created_at' => now(),
        ]);
        PagasaSignal::clearCache();

        $response = $this->postJson('/api/typhoon/assess', $this->lowSeverityPayload());

        $response->assertOk();
        $response->assertJson([
            'severity' => 'critical',
            'computed_severity' => 'low',
            'pagasa_signal' => 3,
            'floor_applied' => true,
        ]);

        $message = $response->json('message');
        $this->assertNotEmpty($message);
        $this->assertStringNotContainsString('Conditions are normal', $message);
    }

    /**
     * floor does not lower a higher computed severity, and floor_applied=false
     */
    public function test_floor_does_not_lower_higher_computed_severity_and_sets_floor_applied_false(): void
    {
        // Signal 1 has floor 'high'
        PagasaSignal::create([
            'signal' => 1,
            'set_by' => $this->admin->id,
            'created_at' => now(),
        ]);
        PagasaSignal::clearCache();

        $response = $this->postJson('/api/typhoon/assess', $this->highSeverityPayload());

        $response->assertOk();
        $data = $response->json();

        // Computed severity is catastrophic, which is above high floor
        $this->assertEquals('catastrophic', $data['severity']);
        $this->assertEquals('catastrophic', $data['computed_severity']);
        $this->assertEquals(1, $data['pagasa_signal']);
        $this->assertFalse($data['floor_applied']);
    }

    /**
     * signal 0 applies no floor
     */
    public function test_signal_zero_applies_no_floor(): void
    {
        PagasaSignal::create([
            'signal' => 0,
            'set_by' => $this->admin->id,
            'created_at' => now(),
        ]);
        PagasaSignal::clearCache();

        $response = $this->postJson('/api/typhoon/assess', $this->lowSeverityPayload());

        $response->assertOk();
        $response->assertJson([
            'severity' => 'low',
            'computed_severity' => 'low',
            'pagasa_signal' => 0,
            'floor_applied' => false,
        ]);
    }

    /**
     * POST requires auth, rejects signal 6 and -1 with 422
     */
    public function test_post_requires_auth_and_rejects_signal_6_and_minus_1_with_422(): void
    {
        // Unauthenticated request must fail with 401
        $unauth = $this->postJson('/api/admin/pagasa-signal', ['signal' => 3]);
        $unauth->assertStatus(401);

        // Authenticated request
        Sanctum::actingAs($this->admin);

        // Signal 6 must fail with 422
        $resp6 = $this->postJson('/api/admin/pagasa-signal', ['signal' => 6]);
        $resp6->assertStatus(422);
        $resp6->assertJsonValidationErrors('signal');

        // Signal -1 must fail with 422
        $respNegative = $this->postJson('/api/admin/pagasa-signal', ['signal' => -1]);
        $respNegative->assertStatus(422);
        $respNegative->assertJsonValidationErrors('signal');
    }

    /**
     * GET returns the latest signal after two POSTs
     */
    public function test_get_returns_the_latest_signal_after_two_posts(): void
    {
        Sanctum::actingAs($this->admin);

        // First POST: set signal 2
        $post1 = $this->postJson('/api/admin/pagasa-signal', ['signal' => 2]);
        $post1->assertOk();
        $post1->assertJson(['signal' => 2]);

        // Second POST: set signal 4
        $post2 = $this->postJson('/api/admin/pagasa-signal', ['signal' => 4]);
        $post2->assertOk();
        $post2->assertJson(['signal' => 4]);

        // Each change must insert a new row (not update in place)
        $this->assertEquals(2, PagasaSignal::count());

        // Public GET should return current signal 4
        $get = $this->getJson('/api/pagasa-signal');
        $get->assertOk();
        $get->assertJson([
            'signal' => 4,
        ]);
        $this->assertNotNull($get->json('set_at'));
    }
}
