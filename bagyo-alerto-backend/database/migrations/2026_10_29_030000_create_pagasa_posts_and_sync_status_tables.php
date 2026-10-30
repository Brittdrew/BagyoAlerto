<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('pagasa_posts', function (Blueprint $table) {
            $table->id();
            $table->string('fb_post_id', 128)->unique();
            $table->text('message')->nullable();
            $table->text('image_url')->nullable();
            $table->text('permalink_url')->nullable();
            $table->timestampTz('posted_at');
            $table->string('source', 10)->default('auto');
            $table->boolean('is_active')->default(true);
            $table->timestampsTz();
            $table->index(['is_active', 'posted_at']);
        });

        Schema::create('pagasa_sync_status', function (Blueprint $table) {
            $table->unsignedTinyInteger('id')->primary();
            $table->timestampTz('last_success_at')->nullable();
            $table->text('last_error')->nullable();
            $table->timestampTz('last_error_at')->nullable();
            $table->timestampTz('failure_started_at')->nullable();
            $table->timestampTz('updated_at')->nullable();
        });

        if (Schema::hasTable('pagasa_pinned_post')) {
            $legacy = DB::table('pagasa_pinned_post')
                ->whereNotNull('url')
                ->where('url', '!=', '')
                ->orderByDesc('updated_at')
                ->first();

            if ($legacy !== null) {
                $postedAt = $legacy->updated_at ?? now();
                DB::table('pagasa_posts')->insert([
                    'fb_post_id' => 'manual:'.hash('sha256', $legacy->url),
                    'message' => null,
                    'image_url' => null,
                    'permalink_url' => $legacy->url,
                    'posted_at' => $postedAt,
                    'source' => 'manual',
                    'is_active' => true,
                    'created_at' => $postedAt,
                    'updated_at' => $postedAt,
                ]);
            }
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('pagasa_sync_status');
        Schema::dropIfExists('pagasa_posts');
    }
};
