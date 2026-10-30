<?php

namespace App\Http\Controllers;

use App\Models\PagasaPost;
use App\Models\PagasaSyncStatus;
use Illuminate\Http\JsonResponse;

class PagasaFeedController extends Controller
{
    public function latest(): JsonResponse
    {
        // Newest posted_at wins, so a manual pin remains the override until
        // an official auto post with a later timestamp arrives.
        $post = PagasaPost::query()
            ->where('is_active', true)
            ->orderByDesc('posted_at')
            ->orderByDesc('id')
            ->first();

        if ($post === null) {
            return response()->json(null);
        }

        return response()->json([
            'id' => $post->id,
            'fb_post_id' => $post->fb_post_id,
            'message' => $post->message,
            'image_url' => $post->image_url,
            'permalink_url' => $post->permalink_url,
            'posted_at' => $post->posted_at?->toISOString(),
            'source' => $post->source,
        ]);
    }

    public function status(): JsonResponse
    {
        $status = PagasaSyncStatus::find(1);
        $failingTooLong = $status?->last_error !== null
            && $status->failure_started_at !== null
            && $status->failure_started_at->lte(now()->subMinutes(10));

        return response()->json([
            'last_successful_sync_at' => $status?->last_success_at?->toISOString(),
            'last_error' => $status?->last_error,
            'last_error_at' => $status?->last_error_at?->toISOString(),
            'failing_for_more_than_10_minutes' => $failingTooLong,
        ]);
    }
}
