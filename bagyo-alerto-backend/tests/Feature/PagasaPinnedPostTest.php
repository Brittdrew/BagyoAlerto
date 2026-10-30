<?php

namespace Tests\Feature;

use App\Models\Admin;
use App\Models\PagasaPost;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Schema;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class PagasaPinnedPostTest extends TestCase
{
    use DatabaseTransactions;

    private Admin $admin;

    protected function setUp(): void
    {
        parent::setUp();

        if (! Schema::hasTable('admins')) {
            Schema::create('admins', function ($table) {
                $table->increments('id');
                $table->string('name');
                $table->string('username')->unique();
                $table->string('password');
                $table->timestamp('created_at')->nullable();
            });
        }

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

        $this->admin = Admin::create([
            'name' => 'PAGASA Post Admin',
            'username' => 'pagasa-post-'.uniqid(),
            'password' => 'secret-password',
        ]);
    }

    public function test_admin_can_pin_each_supported_facebook_url_format(): void
    {
        Sanctum::actingAs($this->admin);

        $urls = [
            'https://www.facebook.com/PAGASA.DOST.GOV.PH/posts/123456',
            'https://web.facebook.com/PAGASA.DOST.GOV.PH/posts/123456',
            'https://fb.watch/example123/',
        ];

        foreach ($urls as $url) {
            $this->postJson('/api/admin/pagasa-post', ['url' => $url])
                ->assertOk()
                ->assertJson([
                    'url' => $url,
                ])
                ->assertJsonStructure(['url', 'updated_at']);

            $this->assertDatabaseHas('pagasa_posts', [
                'permalink_url' => $url,
                'source' => 'manual',
                'is_active' => true,
            ]);
        }

        $this->assertSame(3, PagasaPost::count());
        $this->assertSame(1, PagasaPost::where('is_active', true)->count());
    }

    public function test_invalid_facebook_url_is_rejected(): void
    {
        Sanctum::actingAs($this->admin);

        $this->postJson('/api/admin/pagasa-post', [
            'url' => 'https://example.com/not-pagasa',
        ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('url');

        $this->assertDatabaseCount('pagasa_posts', 0);
    }

    public function test_admin_can_clear_the_pinned_post(): void
    {
        Sanctum::actingAs($this->admin);
        $url = 'https://www.facebook.com/PAGASA.DOST.GOV.PH/posts/123456';

        $this->postJson('/api/admin/pagasa-post', ['url' => $url])->assertOk();

        $this->postJson('/api/admin/pagasa-post', ['url' => null])
            ->assertOk()
            ->assertExactJson([
                'url' => null,
                'updated_at' => null,
            ]);

        $this->assertSame(0, PagasaPost::where('source', 'manual')->where('is_active', true)->count());

        $this->getJson('/api/pagasa-post')->assertExactJson([
            'url' => null,
            'updated_at' => null,
        ]);
    }

    public function test_public_endpoint_returns_the_current_post_without_authentication(): void
    {
        $url = 'https://www.facebook.com/PAGASA.DOST.GOV.PH/posts/654321';
        PagasaPost::create([
            'fb_post_id' => 'manual:test',
            'permalink_url' => $url,
            'posted_at' => now(),
            'source' => 'manual',
            'is_active' => true,
        ]);

        $this->getJson('/api/pagasa-post')
            ->assertOk()
            ->assertJson([
                'url' => $url,
            ])
            ->assertJsonStructure(['url', 'updated_at']);
    }

    public function test_admin_endpoint_requires_authentication(): void
    {
        $this->postJson('/api/admin/pagasa-post', [
            'url' => 'https://www.facebook.com/PAGASA.DOST.GOV.PH/posts/123456',
        ])->assertUnauthorized();
    }
}
