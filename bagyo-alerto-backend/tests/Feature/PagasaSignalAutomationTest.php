<?php

namespace Tests\Feature;

use App\Models\PagasaDetectedSignal;
use App\Models\PagasaSignal;
use App\Services\PagasaBulletinService;
use App\Services\PagasaSignalService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class PagasaSignalAutomationTest extends TestCase
{
    use DatabaseTransactions;

    private const TINO_URL = 'https://pubfiles.pagasa.dost.gov.ph/tamss/weather/bulletin/TCB%2310_tino.pdf';

    protected function setUp(): void
    {
        parent::setUp();
        Http::preventStrayRequests();

        if (! Schema::hasTable('pagasa_signals')) {
            Schema::create('pagasa_signals', function ($table) {
                $table->increments('id');
                $table->unsignedTinyInteger('signal');
                $table->unsignedBigInteger('set_by')->nullable();
                $table->string('source', 10)->default('manual');
                $table->timestamp('created_at')->useCurrent();
            });
        }

        if (! Schema::hasTable('pagasa_detected_signals')) {
            Schema::create('pagasa_detected_signals', function ($table) {
                $table->increments('id');
                $table->string('status', 32);
                $table->string('storm_name', 100)->nullable();
                $table->string('bulletin_no', 20)->nullable();
                $table->timestamp('issued_at')->nullable();
                $table->unsignedTinyInteger('sdn_signal')->nullable();
                $table->unsignedTinyInteger('siargao_signal')->nullable();
                $table->unsignedTinyInteger('bucas_grande_signal')->nullable();
                $table->text('source_url')->nullable();
                $table->timestamp('fetched_at');
                $table->text('raw_excerpt')->nullable();
                $table->timestamp('applied_at')->nullable();
            });
        }

        PagasaSignal::clearCache();
    }

    protected function tearDown(): void
    {
        PagasaSignal::clearCache();
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function tinoPdf(): string
    {
        return file_get_contents(base_path('tests/Fixtures/PAGASA_25-TC20_Tino_TCB_10.pdf'));
    }

    private function fakeTinoBulletin(): void
    {
        Http::fake([
            PagasaBulletinService::INDEX_URL => Http::response(
                '<a href="TCB%2310_tino.pdf">TCB#10_tino.pdf</a> 03-Nov-2025 15:00 363K',
                200
            ),
            self::TINO_URL => Http::response($this->tinoPdf(), 200, [
                'Content-Type' => 'application/pdf',
            ]),
        ]);
    }

    private function detection(array $overrides = []): PagasaDetectedSignal
    {
        return PagasaDetectedSignal::create(array_merge([
            'status' => 'detected',
            'storm_name' => 'TEST',
            'bulletin_no' => '1',
            'issued_at' => now(),
            'sdn_signal' => 3,
            'siargao_signal' => 3,
            'bucas_grande_signal' => 3,
            'source_url' => 'https://example.test/bulletin.pdf',
            'fetched_at' => now(),
        ], $overrides));
    }

    public function test_new_bulletin_is_automatically_applied_by_detect_command(): void
    {
        Carbon::setTestNow('2025-11-03 16:00:00');
        $this->fakeTinoBulletin();

        $this->artisan('pagasa:detect')->assertExitCode(0);

        $current = PagasaSignal::latest('id')->firstOrFail();
        $this->assertSame(3, $current->signal);
        $this->assertSame('auto', $current->source);
        $this->assertNull($current->set_by);
        $this->assertNotNull(PagasaDetectedSignal::latest('id')->firstOrFail()->applied_at);
    }

    public function test_same_bulletin_is_not_reapplied(): void
    {
        Carbon::setTestNow('2025-11-03 16:00:00');
        $this->fakeTinoBulletin();

        $this->artisan('pagasa:detect')->assertExitCode(0);
        $this->travel(10)->minutes();
        $this->artisan('pagasa:detect')->assertExitCode(0);

        $this->assertSame(1, PagasaSignal::count());
        $this->assertSame(2, PagasaDetectedSignal::count());
    }

    public function test_no_active_bulletin_clears_an_auto_floor(): void
    {
        Carbon::setTestNow('2026-10-29 10:00:00');
        $signals = app(PagasaSignalService::class);
        $signals->setSignal(3, 'auto');

        $detection = $this->detection([
            'status' => 'no_active_bulletin',
            'bulletin_no' => '2F',
            'issued_at' => now()->addHour(),
            'sdn_signal' => null,
        ]);
        $signals->applyDetection($detection);

        $current = PagasaSignal::latest('id')->firstOrFail();
        $this->assertSame(0, $current->signal);
        $this->assertSame('auto', $current->source);
    }

    public function test_no_active_bulletin_never_clears_a_manual_floor(): void
    {
        Carbon::setTestNow('2026-10-29 10:00:00');
        $signals = app(PagasaSignalService::class);
        $manual = $signals->setSignal(4, 'manual', 123);

        $detection = $this->detection([
            'status' => 'no_active_bulletin',
            'bulletin_no' => '2F',
            'issued_at' => now()->addHour(),
            'sdn_signal' => null,
        ]);
        $this->assertNull($signals->applyDetection($detection));

        $this->assertSame($manual->id, PagasaSignal::latest('id')->firstOrFail()->id);
        $this->assertSame(4, PagasaSignal::latest('id')->firstOrFail()->signal);
        $this->assertSame('manual', PagasaSignal::latest('id')->firstOrFail()->source);
    }

    public function test_detection_failure_keeps_current_floor(): void
    {
        $signals = app(PagasaSignalService::class);
        $current = $signals->setSignal(2, 'auto');
        $failure = $this->detection([
            'status' => 'parse_failed',
            'storm_name' => null,
            'bulletin_no' => null,
            'issued_at' => null,
            'sdn_signal' => null,
        ]);

        $this->assertNull($signals->applyDetection($failure));
        $this->assertSame($current->id, PagasaSignal::latest('id')->firstOrFail()->id);
        $this->assertSame(2, PagasaSignal::latest('id')->firstOrFail()->signal);
    }

    public function test_manual_override_remains_until_a_newer_bulletin_arrives(): void
    {
        Carbon::setTestNow('2026-10-29 10:00:00');
        $signals = app(PagasaSignalService::class);

        $first = $this->detection(['issued_at' => now(), 'sdn_signal' => 3]);
        $signals->applyDetection($first);

        $this->travel(30)->minutes();
        $manual = $signals->setSignal(1, 'manual', 123);

        $repeat = $this->detection(['issued_at' => now()->subMinutes(30), 'sdn_signal' => 3]);
        $this->assertNull($signals->applyDetection($repeat));
        $this->assertSame($manual->id, PagasaSignal::latest('id')->firstOrFail()->id);

        $newer = $this->detection(['issued_at' => now()->addMinutes(30), 'sdn_signal' => 4]);
        $signals->applyDetection($newer);

        $current = PagasaSignal::latest('id')->firstOrFail();
        $this->assertSame(4, $current->signal);
        $this->assertSame('auto', $current->source);
    }

    public function test_public_update_endpoint_shape_and_failure_flag(): void
    {
        Carbon::setTestNow('2026-10-29 12:00:00');
        $this->detection([
            'storm_name' => 'SAMPLE',
            'bulletin_no' => '8',
            'issued_at' => now()->subMinutes(10),
            'sdn_signal' => 3,
            'siargao_signal' => 4,
            'bucas_grande_signal' => 4,
            'fetched_at' => now()->subMinutes(10),
        ]);
        $this->detection([
            'status' => 'fetch_failed',
            'storm_name' => null,
            'bulletin_no' => null,
            'issued_at' => null,
            'sdn_signal' => null,
            'siargao_signal' => null,
            'bucas_grande_signal' => null,
            'fetched_at' => now(),
        ]);

        $this->getJson('/api/pagasa-update')
            ->assertOk()
            ->assertJsonStructure([
                'active',
                'storm_name',
                'bulletin_no',
                'issued_at',
                'sdn_signal',
                'siargao_signal',
                'bucas_grande_signal',
                'source_url',
                'last_checked_at',
                'is_stale',
                'detection_failed',
                'status',
            ])
            ->assertJson([
                'active' => true,
                'storm_name' => 'SAMPLE',
                'bulletin_no' => '8',
                'sdn_signal' => 3,
                'siargao_signal' => 4,
                'bucas_grande_signal' => 4,
                'is_stale' => false,
                'detection_failed' => true,
                'status' => 'fetch_failed',
            ]);
    }
}
