<?php

namespace Tests\Feature;

use App\Models\Barangay;
use App\Models\EvacuationCenter;
use App\Models\EvacuationLog;
use App\Models\Admin;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * Tests for POST /api/evacuation-centers/{centerId}/self-arrival
 *
 * Coverage:
 *   - success case (within radius, no prior log)
 *   - too far away → 422
 *   - duplicate device within cooldown → 409
 *   - invalid headcount (0 and 11) → 422
 *   - missing required fields → 422
 *   - no authentication required (unauthenticated request succeeds)
 *   - source = 'gps' is persisted
 *   - source appears in admin logs list
 */
class SelfArrivalTest extends TestCase
{
    use DatabaseTransactions;

    protected Admin $admin;
    protected Barangay $barangay;
    protected EvacuationCenter $center;

    /** Coordinates that place the device exactly at the center */
    private const CENTER_LAT = 9.7805;
    private const CENTER_LON = 125.4805;

    protected function setUp(): void
    {
        parent::setUp();

        // Ensure SQLite in-memory tables exist (mirrors EvacuationLogTest setup)
        if (config('database.default') === 'sqlite') {
            if (!Schema::hasTable('users')) {
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

            if (!Schema::hasTable('personal_access_tokens')) {
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

            if (!Schema::hasTable('barangays')) {
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

            if (!Schema::hasTable('evacuation_centers_list')) {
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

            if (!Schema::hasTable('admins')) {
                Schema::create('admins', function ($table) {
                    $table->increments('id');
                    $table->string('name');
                    $table->string('username')->unique();
                    $table->string('password');
                    $table->timestamp('created_at')->nullable();
                });
            }

            if (!Schema::hasTable('evacuation_logs')) {
                Schema::create('evacuation_logs', function ($table) {
                    $table->increments('id');
                    $table->unsignedInteger('evacuation_center_id');
                    $table->unsignedInteger('origin_barangay_id')->nullable();
                    $table->string('type', 20);
                    $table->unsignedInteger('headcount');
                    $table->string('source', 20)->default('admin');
                    $table->string('device_id', 255)->nullable();
                    $table->unsignedInteger('recorded_by')->nullable();
                    $table->timestamps();
                });
            } elseif (!Schema::hasColumn('evacuation_logs', 'source')) {
                Schema::table('evacuation_logs', function ($table) {
                    $table->string('source', 20)->default('admin');
                    $table->string('device_id', 255)->nullable()->index();
                });
            }
        }

        $this->admin = Admin::firstOrCreate(
            ['username' => 'admin_self'],
            ['name' => 'Self Admin', 'password' => bcrypt('admin123')]
        );

        $this->barangay = Barangay::create([
            'name'       => 'Self Barangay',
            'city'       => 'Surigao City',
            'latitude'   => self::CENTER_LAT,
            'longitude'  => self::CENTER_LON,
            'risk_level' => 'low',
        ]);

        // Center coordinates match the device "standing at the door" coords
        $this->center = EvacuationCenter::create([
            'name'              => 'Self-Arrival Test Center',
            'barangay_id'       => $this->barangay->id,
            'address'           => 'Self Street 1',
            'latitude'          => self::CENTER_LAT,
            'longitude'         => self::CENTER_LON,
            'capacity'          => 200,
            'current_occupancy' => 0,
            'is_active'         => true,
        ]);
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    /**
     * Coordinates that are effectively ~0 m from the center (same point).
     */
    private function nearPayload(array $overrides = []): array
    {
        return array_merge([
            'device_id' => 'device-test-001',
            'latitude'  => self::CENTER_LAT,
            'longitude' => self::CENTER_LON,
            'headcount' => 1,
        ], $overrides);
    }

    /**
     * Coordinates ~500 m north of the center — well outside the 100 m radius.
     */
    private function farPayload(array $overrides = []): array
    {
        return array_merge([
            'device_id' => 'device-far-001',
            // ~0.0045 degrees latitude ≈ 500 m
            'latitude'  => self::CENTER_LAT + 0.0045,
            'longitude' => self::CENTER_LON,
            'headcount' => 1,
        ], $overrides);
    }

    private function url(): string
    {
        return "/api/evacuation-centers/{$this->center->id}/self-arrival";
    }

    // -------------------------------------------------------------------------
    // Tests
    // -------------------------------------------------------------------------

    /**
     * Happy path: device is close, no prior log → 201 with slim occupancy payload.
     */
    public function test_self_arrival_success_returns_201_with_occupancy(): void
    {
        $response = $this->postJson($this->url(), $this->nearPayload());

        $response->assertStatus(201)
            ->assertJsonStructure(['message', 'current', 'capacity', 'free_space', 'status'])
            ->assertJson([
                'current'    => 1,
                'capacity'   => 200,
                'free_space' => 199,
                'status'     => 'available',
            ]);

        $this->assertStringContainsString('success', strtolower($response->json('message')));
    }

    /**
     * Device is further than the configured radius → 422.
     */
    public function test_self_arrival_too_far_returns_422(): void
    {
        $response = $this->postJson($this->url(), $this->farPayload());

        $response->assertStatus(422)
            ->assertJsonStructure(['message', 'distance_meters', 'radius_meters']);

        $this->assertStringContainsString('far', strtolower($response->json('message')));
    }

    /**
     * Same device_id tries again within the cooldown window → 409.
     */
    public function test_self_arrival_duplicate_device_within_cooldown_returns_409(): void
    {
        // First self-arrival succeeds
        $this->postJson($this->url(), $this->nearPayload(['device_id' => 'device-dup']))->assertStatus(201);

        // Immediate second attempt from the same device → 409
        $response = $this->postJson($this->url(), $this->nearPayload(['device_id' => 'device-dup']));

        $response->assertStatus(409);
        $this->assertStringContainsString('already', strtolower($response->json('message')));
    }

    /**
     * Same device after the cooldown window expires → 201 (allowed again).
     */
    public function test_self_arrival_duplicate_device_after_cooldown_is_allowed(): void
    {
        $cooldown = (int) config('evacuation.self_arrival_cooldown_hours', 12);
        $oldTime  = Carbon::now()->subHours($cooldown + 1)->toDateTimeString();

        // Insert directly so we can control created_at (Eloquent always sets it to now)
        DB::table('evacuation_logs')->insert([
            'evacuation_center_id' => $this->center->id,
            'type'                 => 'arrival',
            'headcount'            => 1,
            'source'               => 'gps',
            'device_id'            => 'device-old',
            'recorded_by'          => null,
            'created_at'           => $oldTime,
            'updated_at'           => $oldTime,
        ]);

        $response = $this->postJson($this->url(), $this->nearPayload(['device_id' => 'device-old']));

        $response->assertStatus(201);
    }

    /**
     * headcount of 0 → 422 validation error.
     */
    public function test_self_arrival_invalid_headcount_zero_returns_422(): void
    {
        $response = $this->postJson($this->url(), $this->nearPayload(['headcount' => 0]));

        $response->assertStatus(422)
            ->assertJsonValidationErrors('headcount');
    }

    /**
     * headcount of 11 (over max) → 422 validation error.
     */
    public function test_self_arrival_invalid_headcount_over_max_returns_422(): void
    {
        $response = $this->postJson($this->url(), $this->nearPayload(['headcount' => 11]));

        $response->assertStatus(422)
            ->assertJsonValidationErrors('headcount');
    }

    /**
     * Missing required fields (device_id, latitude, longitude) → 422.
     */
    public function test_self_arrival_missing_required_fields_returns_422(): void
    {
        // No device_id
        $this->postJson($this->url(), ['latitude' => self::CENTER_LAT, 'longitude' => self::CENTER_LON])
            ->assertStatus(422)
            ->assertJsonValidationErrors('device_id');

        // No latitude
        $this->postJson($this->url(), ['device_id' => 'dev', 'longitude' => self::CENTER_LON])
            ->assertStatus(422)
            ->assertJsonValidationErrors('latitude');

        // No longitude
        $this->postJson($this->url(), ['device_id' => 'dev', 'latitude' => self::CENTER_LAT])
            ->assertStatus(422)
            ->assertJsonValidationErrors('longitude');
    }

    /**
     * Route requires NO authentication — unauthenticated requests must succeed (201).
     */
    public function test_self_arrival_requires_no_authentication(): void
    {
        // withoutMiddleware ensures no Sanctum token is injected by test helpers
        $response = $this->postJson($this->url(), $this->nearPayload(['device_id' => 'device-noauth']));

        // Unauthenticated request must reach the handler and succeed
        $response->assertStatus(201);
    }

    /**
     * The created log must have source = 'gps' and recorded_by = null.
     */
    public function test_self_arrival_saves_source_gps_and_null_recorded_by(): void
    {
        $deviceId = 'device-source-check';

        $this->postJson($this->url(), $this->nearPayload(['device_id' => $deviceId]))
            ->assertStatus(201);

        $this->assertDatabaseHas('evacuation_logs', [
            'evacuation_center_id' => $this->center->id,
            'device_id'            => $deviceId,
            'source'               => 'gps',
            'type'                 => 'arrival',
            'recorded_by'          => null,
        ]);
    }

    /**
     * Admin logs list (GET /api/.../logs) must include the source field.
     */
    public function test_admin_logs_index_includes_source_field(): void
    {
        // Create a log directly
        EvacuationLog::create([
            'evacuation_center_id' => $this->center->id,
            'type'                 => 'arrival',
            'headcount'            => 3,
            'source'               => 'gps',
            'device_id'            => 'device-index-test',
            'recorded_by'          => null,
        ]);

        // Hit the admin-authenticated index route
        $token = $this->admin->createToken('admin-token')->plainTextToken;

        $response = $this->withHeader('Authorization', "Bearer {$token}")
            ->getJson("/api/admin/evacuation-centers/{$this->center->id}/logs");

        $response->assertStatus(200);

        $logs = $response->json();
        $this->assertNotEmpty($logs);

        // Every log in the list must expose the source field
        foreach ($logs as $log) {
            $this->assertArrayHasKey('source', $log);
        }

        // The GPS log must appear with source = 'gps'
        $gpsLog = collect($logs)->firstWhere('device_id', 'device-index-test');
        $this->assertNotNull($gpsLog);
        $this->assertEquals('gps', $gpsLog['source']);
    }

    /**
     * headcount defaults to 1 when omitted.
     */
    public function test_self_arrival_headcount_defaults_to_one(): void
    {
        $payload = [
            'device_id' => 'device-default-hc',
            'latitude'  => self::CENTER_LAT,
            'longitude' => self::CENTER_LON,
            // headcount intentionally omitted
        ];

        $this->postJson($this->url(), $payload)->assertStatus(201);

        $this->assertDatabaseHas('evacuation_logs', [
            'evacuation_center_id' => $this->center->id,
            'device_id'            => 'device-default-hc',
            'headcount'            => 1,
        ]);
    }
}
