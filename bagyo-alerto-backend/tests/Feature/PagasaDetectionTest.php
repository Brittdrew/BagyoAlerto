<?php

namespace Tests\Feature;

use App\Models\Admin;
use App\Models\PagasaDetectedSignal;
use App\Services\PagasaBulletinService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class PagasaDetectionTest extends TestCase
{
    use DatabaseTransactions;

    private const TINO_URL = 'https://pubfiles.pagasa.dost.gov.ph/tamss/weather/bulletin/TCB%2310_tino.pdf';

    protected function setUp(): void
    {
        parent::setUp();
        Http::preventStrayRequests();
        Cache::flush();

        if (! Schema::hasTable('admins')) {
            Schema::create('admins', function ($table) {
                $table->increments('id');
                $table->string('name');
                $table->string('username')->unique();
                $table->string('password');
                $table->timestamp('created_at')->nullable();
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

    private function tinoPdf(): string
    {
        return file_get_contents(base_path('tests/Fixtures/PAGASA_25-TC20_Tino_TCB_10.pdf'));
    }

    private function indexWithBulletin(string $file = 'TCB#10_tino.pdf'): string
    {
        $href = str_replace('#', '%23', $file);

        return <<<HTML
            <html><body>
            <a href="{$href}">{$file}</a> 03-Nov-2025 15:00 363K
            </body></html>
            HTML;
    }

    public function test_archived_tino_bulletin_detects_separate_surigao_signals(): void
    {
        Http::fake([
            PagasaBulletinService::INDEX_URL => Http::response($this->indexWithBulletin(), 200, [
                'Content-Type' => 'text/html',
            ]),
            self::TINO_URL => Http::response($this->tinoPdf(), 200, [
                'Content-Type' => 'application/pdf',
            ]),
        ]);

        $this->artisan('pagasa:detect')->assertExitCode(0);

        $this->assertDatabaseHas('pagasa_detected_signals', [
            'status' => 'detected',
            'storm_name' => 'TINO',
            'bulletin_no' => '10',
            'sdn_signal' => 3,
            'siargao_signal' => 4,
            'bucas_grande_signal' => 4,
            'source_url' => self::TINO_URL,
        ]);

        $row = PagasaDetectedSignal::latest('id')->firstOrFail();
        $this->assertSame('2025-11-03 15:00:00', $row->issued_at->utc()->format('Y-m-d H:i:s'));
        $this->assertStringContainsString('Surigao del Norte', $row->raw_excerpt);
        Http::assertSentCount(2);
    }

    public function test_explicit_no_active_bulletin_response_is_stored_without_downloading_a_pdf(): void
    {
        Http::fake([
            PagasaBulletinService::INDEX_URL => Http::response(
                '<html><body>No Active Tropical Cyclone within the Philippine Area of Responsibility</body></html>',
                200,
                ['Content-Type' => 'text/html']
            ),
        ]);

        $this->artisan('pagasa:detect')->assertExitCode(0);

        $row = PagasaDetectedSignal::latest('id')->firstOrFail();
        $this->assertSame('no_active_bulletin', $row->status);
        $this->assertNull($row->sdn_signal);
        $this->assertNull($row->siargao_signal);
        $this->assertNull($row->bucas_grande_signal);
        Http::assertSentCount(1);
    }

    public function test_live_bulletin_endpoint_returns_and_caches_the_official_status(): void
    {
        Http::fake([
            PagasaBulletinService::INDEX_URL => Http::response(
                '<html><body>No Active Tropical Cyclone within the Philippine Area of Responsibility</body></html>',
                200,
                ['Content-Type' => 'text/html']
            ),
        ]);

        $this->getJson('/api/pagasa/bulletin')
            ->assertOk()
            ->assertJson([
                'active' => false,
                'status' => 'no_active_bulletin',
                'is_stale' => false,
                'error' => null,
            ]);

        $this->getJson('/api/pagasa/bulletin')->assertOk();

        Http::assertSentCount(1);
    }

    public function test_final_bulletin_with_spaced_number_is_recognized_as_no_active(): void
    {
        $text = <<<'TEXT'
            TROPICAL CYCLONE BULLETIN NR. 1 7F
            Typhoon ROSAL (CHAMPI)
            Issued at 11:00 AM, 24 October 2026

            TROPICAL CYCLONE WIND SIGNALS (TCWS) IN EFFECT
            No Wind Signal is currently hoisted

            TROPICAL CYCLONE BULLETIN NR. 1 7F
            TEXT;

        $result = app(PagasaBulletinService::class)->parseExtractedText(
            $text,
            'https://example.test/TCB%2317_rosal.pdf'
        );

        $this->assertSame('no_active_bulletin', $result['status']);
        $this->assertSame('ROSAL', $result['storm_name']);
        $this->assertSame('17F', $result['bulletin_no']);
        $this->assertNull($result['sdn_signal']);
    }

    public function test_garbled_active_bulletin_is_parse_failed_and_keeps_last_good_row(): void
    {
        $good = PagasaDetectedSignal::create([
            'status' => 'detected',
            'storm_name' => 'GOOD',
            'bulletin_no' => '1',
            'sdn_signal' => 1,
            'source_url' => 'https://example.test/good.pdf',
            'fetched_at' => now()->subMinutes(10),
        ]);

        Http::fake([
            PagasaBulletinService::INDEX_URL => Http::response($this->indexWithBulletin(), 200),
            self::TINO_URL => Http::response("%PDF-1.7\nthis is not a readable bulletin", 200, [
                'Content-Type' => 'application/pdf',
            ]),
        ]);
        Log::spy();

        $this->artisan('pagasa:detect')->assertExitCode(1);

        $this->assertDatabaseHas('pagasa_detected_signals', [
            'id' => $good->id,
            'status' => 'detected',
            'storm_name' => 'GOOD',
            'sdn_signal' => 1,
        ]);
        $this->assertSame('parse_failed', PagasaDetectedSignal::latest('id')->firstOrFail()->status);
        Log::shouldHaveReceived('error')->once();
    }

    public function test_http_failure_is_stored_as_fetch_failed(): void
    {
        Http::fake([
            PagasaBulletinService::INDEX_URL => Http::response('Service unavailable', 503),
        ]);
        Log::spy();

        $this->artisan('pagasa:detect')->assertExitCode(1);

        $this->assertDatabaseHas('pagasa_detected_signals', [
            'status' => 'fetch_failed',
            'source_url' => PagasaBulletinService::INDEX_URL,
        ]);
        Log::shouldHaveReceived('error')->once();
        Http::assertSentCount(1);
    }

    public function test_admin_endpoint_requires_authentication(): void
    {
        $this->getJson('/api/admin/pagasa-detected')->assertUnauthorized();
    }

    public function test_admin_endpoint_returns_latest_row_and_staleness(): void
    {
        $admin = Admin::create([
            'name' => 'Detection Admin',
            'username' => 'detection-admin',
            'password' => 'secret-password',
        ]);
        Sanctum::actingAs($admin);

        PagasaDetectedSignal::create([
            'status' => 'detected',
            'storm_name' => 'OLD',
            'bulletin_no' => '1',
            'source_url' => 'https://example.test/old.pdf',
            'fetched_at' => now()->subMinutes(31),
        ]);

        $this->getJson('/api/admin/pagasa-detected')
            ->assertOk()
            ->assertJson([
                'storm_name' => 'OLD',
                'is_stale' => true,
            ]);

        PagasaDetectedSignal::create([
            'status' => 'detected',
            'storm_name' => 'NEW',
            'bulletin_no' => '2',
            'sdn_signal' => 3,
            'source_url' => 'https://example.test/new.pdf',
            'fetched_at' => now()->subMinutes(5),
        ]);

        $this->getJson('/api/admin/pagasa-detected')
            ->assertOk()
            ->assertJson([
                'storm_name' => 'NEW',
                'sdn_signal' => 3,
                'is_stale' => false,
            ]);
    }
}
