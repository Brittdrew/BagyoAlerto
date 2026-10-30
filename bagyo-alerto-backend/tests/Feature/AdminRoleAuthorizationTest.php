<?php

namespace Tests\Feature;

use App\Models\Admin;
use App\Models\Barangay;
use App\Models\ChatLog;
use App\Models\EvacuationCenter;
use App\Models\Recommendation;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Schema;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AdminRoleAuthorizationTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        $this->createTables();
    }

    public function test_admin_is_forbidden_from_every_restricted_route_and_can_use_operational_routes(): void
    {
        $admin = $this->createAdmin(Admin::ROLE_ADMIN, 'operator@example.com');
        Sanctum::actingAs($admin);

        $restricted = [
            ['DELETE', '/api/recommendations/999', []],
            ['DELETE', '/api/chat/history/999', []],
            ['DELETE', '/api/chat/history', []],
            ['POST', '/api/admin/barangays', []],
            ['PUT', '/api/admin/barangays/999', []],
            ['DELETE', '/api/admin/barangays/999', []],
            ['POST', '/api/admin/evacuation-centers', []],
            ['PUT', '/api/admin/evacuation-centers/999', []],
            ['DELETE', '/api/admin/evacuation-centers/999', []],
            ['POST', '/api/admin/evacuation-centers/photo', []],
            ['DELETE', '/api/admin/evacuation-centers/photo/Test', []],
            ['POST', '/api/admin/pagasa-post', ['url' => null]],
            ['GET', '/api/admin/accounts', []],
            ['POST', '/api/admin/accounts', []],
            ['PUT', '/api/admin/accounts/999/role', []],
            ['DELETE', '/api/admin/accounts/999', []],
        ];

        foreach ($restricted as [$method, $uri, $data]) {
            $this->json($method, $uri, $data)->assertForbidden();
        }

        $barangay = $this->createBarangay();
        $center = $this->createCenter($barangay);

        $this->getJson('/api/admin/me')->assertOk()->assertJsonPath('role', Admin::ROLE_ADMIN);
        $this->getJson('/api/admin/stats')->assertOk();
        $this->getJson('/api/admin/barangays')->assertOk();
        $this->getJson('/api/admin/evacuation-centers')->assertOk();
        $this->getJson('/api/admin/hazard-map')->assertOk();
        $this->getJson('/api/evacuation-centers/overview')->assertOk();
        $this->getJson('/api/chat/history')->assertOk();
        $this->getJson('/api/admin/recommendations')->assertOk();

        $arrival = $this->postJson("/api/admin/evacuation-centers/{$center->id}/logs", [
            'type' => 'arrival',
            'headcount' => 2,
            'origin_barangay_id' => $barangay->id,
        ])->assertCreated();

        $this->deleteJson('/api/admin/evacuation-logs/'.$arrival->json('id'))->assertOk();
    }

    public function test_admin_can_change_only_own_password_and_must_supply_current_password(): void
    {
        $admin = $this->createAdmin(Admin::ROLE_ADMIN, 'operator@example.com');
        $otherAdmin = $this->createAdmin(Admin::ROLE_ADMIN, 'other@example.com');
        Sanctum::actingAs($admin);

        $this->putJson('/api/admin/password', [
            'current_password' => 'incorrect-password',
            'new_password' => 'updated-password',
            'new_password_confirmation' => 'updated-password',
        ])->assertUnprocessable()->assertJsonPath('message', 'Current password is incorrect');

        $this->assertTrue(Hash::check('password123', $admin->fresh()->password));

        $this->putJson('/api/admin/password', [
            'current_password' => 'password123',
            'new_password' => 'updated-password',
            'new_password_confirmation' => 'updated-password',
        ])->assertOk();

        $this->assertTrue(Hash::check('updated-password', $admin->fresh()->password));
        $this->assertTrue(Hash::check('password123', $otherAdmin->fresh()->password));
    }

    public function test_super_admin_can_use_all_restricted_features(): void
    {
        $superAdmin = $this->createAdmin(Admin::ROLE_SUPER_ADMIN, 'owner@example.com');
        Sanctum::actingAs($superAdmin);

        $barangay = $this->postJson('/api/admin/barangays', [
            'name' => 'Role Test Barangay',
            'city' => 'Surigao City',
            'latitude' => 9.78,
            'longitude' => 125.49,
            'risk_level' => 'low',
        ])->assertCreated()->json();

        $this->putJson('/api/admin/barangays/'.$barangay['id'], array_merge($barangay, [
            'flood_susceptibility' => 'moderate',
            'landslide_susceptibility' => 'low',
        ]))->assertOk();

        $center = $this->postJson('/api/admin/evacuation-centers', [
            'name' => 'Role Test Center',
            'barangay_id' => $barangay['id'],
            'address' => 'Test address',
            'latitude' => 9.78,
            'longitude' => 125.49,
            'capacity' => 100,
            'is_active' => true,
        ])->assertCreated()->json();

        $this->putJson('/api/admin/evacuation-centers/'.$center['id'], array_merge($center, [
            'barangay_id' => $barangay['id'],
            'flood_susceptibility' => 'high',
            'landslide_susceptibility' => 'moderate',
        ]))->assertOk();

        $recommendation = Recommendation::create([
            'barangay_id' => $barangay['id'],
            'evacuation_center_id' => $center['id'],
            'typhoon_log_id' => 1,
        ]);
        $this->deleteJson('/api/recommendations/'.$recommendation->id)->assertOk();

        $chatLog = ChatLog::create([
            'question' => 'Test question',
            'answer' => 'Test answer',
            'asked_by' => 'admin',
        ]);
        $this->deleteJson('/api/chat/history/'.$chatLog->id)->assertOk();
        $this->deleteJson('/api/chat/history')->assertOk();

        $this->postJson('/api/admin/pagasa-post', [
            'url' => 'https://www.facebook.com/PAGASA.DOST.GOV.PH/posts/123456',
        ])->assertOk();
        $this->postJson('/api/admin/pagasa-post', ['url' => null])->assertOk();

        $this->putJson('/api/admin/password', [
            'current_password' => 'password123',
            'new_password' => 'new-password',
            'new_password_confirmation' => 'new-password',
        ])->assertOk();

        $this->getJson('/api/admin/accounts')->assertOk();
        $managed = $this->postJson('/api/admin/accounts', [
            'name' => 'Managed Admin',
            'email' => 'managed@example.com',
            'password' => 'password123',
            'password_confirmation' => 'password123',
            'role' => Admin::ROLE_ADMIN,
        ])->assertCreated()->json();
        $this->putJson('/api/admin/accounts/'.$managed['id'].'/role', [
            'role' => Admin::ROLE_SUPER_ADMIN,
        ])->assertOk();
        $this->deleteJson('/api/admin/accounts/'.$managed['id'])->assertOk();

        $this->deleteJson('/api/admin/evacuation-centers/'.$center['id'])->assertOk();
        $this->deleteJson('/api/admin/barangays/'.$barangay['id'])->assertOk();
    }

    public function test_last_super_admin_and_current_account_cannot_be_removed_or_demoted(): void
    {
        $lastSuperAdmin = $this->createAdmin(Admin::ROLE_SUPER_ADMIN, 'last@example.com');
        $staleAuthenticatedSuperAdmin = new Admin([
            'name' => 'Authenticated Super Admin',
            'username' => 'stale@example.com',
            'role' => Admin::ROLE_SUPER_ADMIN,
        ]);
        $staleAuthenticatedSuperAdmin->id = 999999;
        Sanctum::actingAs($staleAuthenticatedSuperAdmin);

        $this->putJson('/api/admin/accounts/'.$lastSuperAdmin->id.'/role', [
            'role' => Admin::ROLE_ADMIN,
        ])->assertUnprocessable()->assertJsonPath('message', 'The last super admin cannot be demoted.');
        $this->deleteJson('/api/admin/accounts/'.$lastSuperAdmin->id)
            ->assertUnprocessable()->assertJsonPath('message', 'The last super admin cannot be deleted.');

        Sanctum::actingAs($lastSuperAdmin);
        $this->putJson('/api/admin/accounts/'.$lastSuperAdmin->id.'/role', [
            'role' => Admin::ROLE_ADMIN,
        ])->assertUnprocessable()->assertJsonPath('message', 'You cannot demote your own account.');
        $this->deleteJson('/api/admin/accounts/'.$lastSuperAdmin->id)
            ->assertUnprocessable()->assertJsonPath('message', 'You cannot delete your own account.');
    }

    public function test_migration_promotes_existing_accounts_and_defaults_new_accounts_to_admin(): void
    {
        Schema::dropIfExists('admins');
        Schema::create('admins', function ($table) {
            $table->id();
            $table->string('name');
            $table->string('username')->unique();
            $table->string('password');
            $table->timestamp('created_at')->nullable();
        });
        DB::table('admins')->insert([
            'name' => 'Existing Account',
            'username' => 'existing',
            'password' => Hash::make('password123'),
        ]);

        $migration = require database_path('migrations/2026_10_30_000000_add_role_to_admins_table.php');
        $migration->up();

        $this->assertSame(Admin::ROLE_SUPER_ADMIN, DB::table('admins')->where('username', 'existing')->value('role'));

        DB::table('admins')->insert([
            'name' => 'New Account',
            'username' => 'new',
            'password' => Hash::make('password123'),
        ]);
        $this->assertSame(Admin::ROLE_ADMIN, DB::table('admins')->where('username', 'new')->value('role'));
    }

    private function createAdmin(string $role, string $username): Admin
    {
        return Admin::create([
            'name' => ucfirst(str_replace('_', ' ', $role)),
            'username' => $username,
            'password' => 'password123',
            'role' => $role,
        ]);
    }

    private function createBarangay(): Barangay
    {
        return Barangay::create([
            'name' => 'Allowed Barangay',
            'city' => 'Surigao City',
            'latitude' => 9.78,
            'longitude' => 125.49,
            'risk_level' => 'low',
        ]);
    }

    private function createCenter(Barangay $barangay): EvacuationCenter
    {
        return EvacuationCenter::create([
            'name' => 'Allowed Center',
            'barangay_id' => $barangay->id,
            'address' => 'Allowed address',
            'latitude' => 9.78,
            'longitude' => 125.49,
            'capacity' => 100,
            'current_occupancy' => 0,
            'is_active' => true,
        ]);
    }

    private function createTables(): void
    {
        foreach (['admins', 'barangays', 'evacuation_centers_list', 'evacuation_logs', 'chat_logs', 'typhoon_logs', 'recommendations', 'pagasa_posts'] as $table) {
            Schema::dropIfExists($table);
        }

        Schema::create('admins', function ($table) {
            $table->id();
            $table->string('name');
            $table->string('username')->unique();
            $table->string('role')->default(Admin::ROLE_ADMIN);
            $table->string('password');
            $table->timestamp('created_at')->nullable();
        });
        Schema::create('barangays', function ($table) {
            $table->id();
            $table->string('name');
            $table->string('city')->nullable();
            $table->decimal('latitude', 10, 8)->nullable();
            $table->decimal('longitude', 11, 8)->nullable();
            $table->string('risk_level')->nullable();
            $table->string('flood_susceptibility')->nullable();
            $table->string('landslide_susceptibility')->nullable();
            $table->string('hazard_source')->nullable();
            $table->timestamp('hazard_checked_at')->nullable();
        });
        Schema::create('evacuation_centers_list', function ($table) {
            $table->id();
            $table->string('name');
            $table->unsignedBigInteger('barangay_id');
            $table->string('address')->nullable();
            $table->decimal('latitude', 10, 8)->nullable();
            $table->decimal('longitude', 11, 8)->nullable();
            $table->unsignedInteger('capacity')->default(0);
            $table->unsignedInteger('current_occupancy')->default(0);
            $table->boolean('is_active')->default(true);
            $table->string('flood_susceptibility')->nullable();
            $table->string('landslide_susceptibility')->nullable();
            $table->string('hazard_source')->nullable();
            $table->timestamp('hazard_checked_at')->nullable();
        });
        Schema::create('evacuation_logs', function ($table) {
            $table->id();
            $table->unsignedBigInteger('evacuation_center_id');
            $table->unsignedBigInteger('origin_barangay_id')->nullable();
            $table->string('type');
            $table->unsignedInteger('headcount');
            $table->string('source')->default('admin');
            $table->string('device_id')->nullable();
            $table->unsignedBigInteger('recorded_by')->nullable();
            $table->timestamps();
        });
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
        Schema::create('typhoon_logs', function ($table) {
            $table->id();
            $table->string('severity_level')->nullable();
            $table->boolean('is_manual')->default(false);
        });
        Schema::create('recommendations', function ($table) {
            $table->id();
            $table->unsignedBigInteger('barangay_id');
            $table->unsignedBigInteger('evacuation_center_id');
            $table->unsignedBigInteger('typhoon_log_id');
            $table->timestamp('recommended_at')->useCurrent();
        });
        Schema::create('pagasa_posts', function ($table) {
            $table->id();
            $table->string('fb_post_id')->unique();
            $table->text('message')->nullable();
            $table->text('image_url')->nullable();
            $table->text('permalink_url')->nullable();
            $table->timestamp('posted_at');
            $table->string('source')->default('auto');
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });
    }
}
