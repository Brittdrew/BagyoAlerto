<?php

namespace Tests\Feature;

use App\Models\TyphoonLog;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class CurrentRiskTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();

        if (! Schema::hasTable('typhoon_logs')) {
            Schema::create('typhoon_logs', function ($table) {
                $table->increments('id');
                $table->decimal('wind_speed', 5, 2)->default(0);
                $table->decimal('rainfall', 5, 2)->default(0);
                $table->decimal('pressure', 6, 2)->default(1010);
                $table->string('severity_level', 50);
                $table->string('classification')->nullable();
                $table->unsignedInteger('barangay_id')->nullable();
                $table->boolean('is_manual')->default(false);
                $table->timestamp('logged_at')->useCurrent();
            });
        }
    }

    public function test_current_risk_uses_latest_non_manual_assessment_only(): void
    {
        TyphoonLog::create([
            'severity_level' => 'critical',
            'classification' => 'Signal 3',
            'barangay_id' => 1,
            'is_manual' => false,
            'logged_at' => now()->subHour(),
        ]);
        $latest = TyphoonLog::create([
            'severity_level' => 'low',
            'classification' => 'Normal',
            'barangay_id' => 2,
            'is_manual' => false,
            'logged_at' => now()->subMinute(),
        ]);
        TyphoonLog::create([
            'severity_level' => 'critical',
            'classification' => 'Signal 4',
            'barangay_id' => 3,
            'is_manual' => true,
            'logged_at' => now(),
        ]);

        $this->getJson('/api/risk/current')
            ->assertOk()
            ->assertJson([
                'severity' => 'low',
                'classification' => 'Normal',
                'barangay_id' => $latest->barangay_id,
                'source' => 'latest_non_manual_assessment',
            ]);
    }

    public function test_current_risk_classification_matches_the_effective_severity(): void
    {
        TyphoonLog::create([
            'severity_level' => 'critical',
            'classification' => 'Normal',
            'barangay_id' => 1,
            'is_manual' => false,
        ]);

        $this->getJson('/api/risk/current')
            ->assertOk()
            ->assertJson([
                'severity' => 'critical',
                'classification' => 'Critical',
            ]);
    }
}
