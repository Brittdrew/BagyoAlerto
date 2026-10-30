<?php

namespace Tests\Feature;

use App\Models\PagasaPost;
use App\Models\PagasaSyncStatus;
use App\Services\Pagasa\BulletinPagasaDriver;
use App\Services\Pagasa\FacebookPagasaDriver;
use App\Services\PagasaFeedService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class PagasaFeedTest extends TestCase
{
    use DatabaseTransactions;

    private const PAGE_URL = 'https://www.pagasa.dost.gov.ph/tropical-cyclone/severe-weather-bulletin';

    private const PDF_URL = 'https://pubfiles.pagasa.dost.gov.ph/tamss/weather/bulletin/TCB%232_test.pdf';

    protected function setUp(): void
    {
        parent::setUp();
        Http::preventStrayRequests();

        config()->set('services.pagasa.bulletin_url', self::PAGE_URL);
        config()->set('services.pagasa.facebook', [
            'graph_version' => 'v21.0',
            'page_id' => 'PAGASA.DOST.GOV.PH',
            'app_id' => 'test-app-id',
            'app_secret' => 'test-app-secret',
        ]);

        if (! Schema::hasTable('pagasa_posts')) {
            Schema::create('pagasa_posts', function ($table) {
                $table->increments('id');
                $table->string('fb_post_id')->unique();
                $table->text('message')->nullable();
                $table->text('image_url')->nullable();
                $table->text('permalink_url')->nullable();
                $table->timestamp('posted_at');
                $table->string('source', 10)->default('auto');
                $table->boolean('is_active')->default(true);
                $table->timestamps();
            });
        }

        if (! Schema::hasTable('pagasa_sync_status')) {
            Schema::create('pagasa_sync_status', function ($table) {
                $table->unsignedTinyInteger('id')->primary();
                $table->timestamp('last_success_at')->nullable();
                $table->text('last_error')->nullable();
                $table->timestamp('last_error_at')->nullable();
                $table->timestamp('failure_started_at')->nullable();
                $table->timestamp('updated_at')->nullable();
            });
        }
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function bulletinHtml(): string
    {
        return <<<'HTML'
            <html><body>
                <main>
                    <h1>Tropical Cyclone Bulletin</h1>
                    <article>
                        <img src="/images/latest-bulletin.jpg" alt="Bulletin">
                        <p>Latest official bulletin summary for TEST.</p>
                        <a href="https://pubfiles.pagasa.dost.gov.ph/tamss/weather/bulletin/TCB%232_test.pdf">TCB#2_test.pdf</a>
                    </article>
                    <h2>Archive</h2>
                    <a href="https://pubfiles.pagasa.dost.gov.ph/tamss/weather/bulletin/TCB%231_old.pdf">TCB#1_old.pdf</a>
                </main>
            </body></html>
            HTML;
    }

    private function fakeBulletin(): void
    {
        Http::fake([
            self::PAGE_URL => Http::response($this->bulletinHtml(), 200, [
                'Last-Modified' => 'Thu, 29 Oct 2026 02:00:00 GMT',
            ]),
            self::PDF_URL => Http::response('PDF metadata unavailable', 500),
        ]);
    }

    public function test_bulletin_driver_parses_latest_active_link_and_page_content(): void
    {
        $this->fakeBulletin();

        $post = app(BulletinPagasaDriver::class)->fetchLatest();

        $this->assertSame(self::PDF_URL, $post['permalink_url']);
        $this->assertSame('https://www.pagasa.dost.gov.ph/images/latest-bulletin.jpg', $post['image_url']);
        $this->assertStringContainsString('PAGASA Tropical Cyclone Bulletin #2', $post['message']);
        $this->assertStringContainsString('Latest official bulletin summary', $post['message']);
        $this->assertSame('2026-10-29T02:00:00+00:00', $post['posted_at']->toIso8601String());
    }

    public function test_facebook_driver_uses_app_token_and_maps_latest_post(): void
    {
        Http::fake([
            'https://graph.facebook.com/*' => Http::response([
                'data' => [[
                    'id' => 'page_123',
                    'message' => 'Latest PAGASA Facebook update',
                    'full_picture' => 'https://example.test/image.jpg',
                    'permalink_url' => 'https://www.facebook.com/PAGASA.DOST.GOV.PH/posts/123',
                    'created_time' => '2026-10-29T10:00:00+0800',
                ]],
            ]),
        ]);

        $post = app(FacebookPagasaDriver::class)->fetchLatest();

        $this->assertSame('page_123', $post['fb_post_id']);
        $this->assertSame('Latest PAGASA Facebook update', $post['message']);
        Http::assertSent(function (Request $request): bool {
            return $request['access_token'] === 'test-app-id|test-app-secret'
                && $request['limit'] === 1;
        });
    }

    public function test_facebook_failure_falls_back_to_bulletin_and_does_not_duplicate(): void
    {
        config()->set('services.pagasa.driver', 'facebook');
        Http::fake([
            'https://graph.facebook.com/*' => Http::response([
                'error' => ['message' => 'Unsupported get request', 'code' => 100],
            ], 400),
            self::PAGE_URL => Http::response($this->bulletinHtml(), 200, [
                'Last-Modified' => 'Thu, 29 Oct 2026 02:00:00 GMT',
            ]),
            self::PDF_URL => Http::response('PDF metadata unavailable', 500),
        ]);

        $first = app(PagasaFeedService::class)->sync();
        $second = app(PagasaFeedService::class)->sync();

        $this->assertTrue($first['success']);
        $this->assertTrue($first['fallback']);
        $this->assertSame('bulletin', $first['driver']);
        $this->assertTrue($second['success']);
        $this->assertSame(1, PagasaPost::count());
        $this->assertNotNull(PagasaSyncStatus::find(1)?->last_success_at);
    }

    public function test_latest_endpoint_uses_newest_posted_at_across_manual_and_auto(): void
    {
        Carbon::setTestNow('2026-10-29 10:00:00');
        PagasaPost::create([
            'fb_post_id' => 'auto-old',
            'message' => 'Old automatic post',
            'posted_at' => now()->subHour(),
            'source' => 'auto',
            'is_active' => true,
        ]);
        $manual = PagasaPost::create([
            'fb_post_id' => 'manual-current',
            'message' => 'Manual override',
            'posted_at' => now(),
            'source' => 'manual',
            'is_active' => true,
        ]);

        $this->getJson('/api/pagasa/latest')
            ->assertOk()
            ->assertJson(['id' => $manual->id, 'source' => 'manual']);

        $newAuto = PagasaPost::create([
            'fb_post_id' => 'auto-new',
            'message' => 'New automatic post',
            'posted_at' => now()->addMinute(),
            'source' => 'auto',
            'is_active' => true,
        ]);

        $this->getJson('/api/pagasa/latest')
            ->assertOk()
            ->assertJson(['id' => $newAuto->id, 'source' => 'auto']);
    }

    public function test_status_reports_a_failure_older_than_ten_minutes(): void
    {
        Carbon::setTestNow('2026-10-29 10:20:00');
        PagasaSyncStatus::create([
            'id' => 1,
            'last_success_at' => now()->subHour(),
            'last_error' => 'PAGASA unavailable',
            'last_error_at' => now(),
            'failure_started_at' => now()->subMinutes(11),
            'updated_at' => now(),
        ]);

        $this->getJson('/api/pagasa/status')
            ->assertOk()
            ->assertJson([
                'last_error' => 'PAGASA unavailable',
                'failing_for_more_than_10_minutes' => true,
            ]);
    }
}
