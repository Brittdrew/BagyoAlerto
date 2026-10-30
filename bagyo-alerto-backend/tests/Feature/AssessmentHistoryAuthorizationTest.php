<?php

namespace Tests\Feature;

use App\Models\Admin;
use App\Models\Recommendation;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Schema;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AssessmentHistoryAuthorizationTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();

        if (! Schema::hasTable('recommendations')) {
            Schema::create('recommendations', function ($table) {
                $table->increments('id');
                $table->integer('barangay_id');
                $table->integer('evacuation_center_id');
                $table->integer('typhoon_log_id');
                $table->timestamp('recommended_at')->useCurrent();
            });
        }
    }

    public function test_guest_cannot_delete_assessment_history(): void
    {
        $recommendation = $this->createRecommendation();

        $this->deleteJson("/api/recommendations/{$recommendation->id}")
            ->assertUnauthorized();

        $this->assertDatabaseHas('recommendations', ['id' => $recommendation->id]);
    }

    public function test_authenticated_non_admin_cannot_delete_assessment_history(): void
    {
        $recommendation = $this->createRecommendation();
        Sanctum::actingAs(new User(['name' => 'Resident']));

        $this->deleteJson("/api/recommendations/{$recommendation->id}")
            ->assertForbidden();

        $this->assertDatabaseHas('recommendations', ['id' => $recommendation->id]);
    }

    public function test_authenticated_super_admin_can_delete_assessment_history(): void
    {
        $recommendation = $this->createRecommendation();
        Sanctum::actingAs(new Admin(['name' => 'Super Admin', 'username' => 'admin']));

        $this->deleteJson("/api/recommendations/{$recommendation->id}")
            ->assertOk();

        $this->assertDatabaseMissing('recommendations', ['id' => $recommendation->id]);
    }

    private function createRecommendation(): Recommendation
    {
        return Recommendation::create([
            'barangay_id' => 1,
            'evacuation_center_id' => 1,
            'typhoon_log_id' => 1,
        ]);
    }
}
