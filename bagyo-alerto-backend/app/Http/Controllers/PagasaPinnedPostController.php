<?php

namespace App\Http\Controllers;

use App\Models\PagasaPost;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class PagasaPinnedPostController extends Controller
{
    private const ALLOWED_PREFIXES = [
        'https://www.facebook.com/',
        'https://web.facebook.com/',
        'https://fb.watch/',
    ];

    public function show(): JsonResponse
    {
        $post = PagasaPost::query()
            ->where('source', 'manual')
            ->where('is_active', true)
            ->orderByDesc('posted_at')
            ->orderByDesc('id')
            ->first();

        return response()->json($this->publicPayload($post));
    }

    public function store(Request $request): JsonResponse
    {
        $url = $request->input('url');
        if (is_string($url)) {
            $request->merge(['url' => trim($url) ?: null]);
        }

        $validated = $request->validate([
            'url' => [
                'nullable',
                'string',
                'max:2048',
                'url',
                function (string $attribute, mixed $value, \Closure $fail): void {
                    if ($value !== null && (! is_string($value) || ! Str::startsWith($value, self::ALLOWED_PREFIXES))) {
                        $fail('The URL must be a supported Facebook post URL.');
                    }
                },
            ],
        ]);

        $url = $validated['url'] ?? null;
        $post = DB::transaction(function () use ($url): ?PagasaPost {
            PagasaPost::query()
                ->where('source', 'manual')
                ->where('is_active', true)
                ->update(['is_active' => false]);

            if ($url === null) {
                return null;
            }

            return PagasaPost::updateOrCreate(
                ['fb_post_id' => 'manual:'.hash('sha256', $url)],
                [
                    'message' => null,
                    'image_url' => null,
                    'permalink_url' => $url,
                    'posted_at' => now(),
                    'source' => 'manual',
                    'is_active' => true,
                ]
            );
        });

        return response()->json($this->publicPayload($post));
    }

    /**
     * @return array{url: ?string, updated_at: ?string}
     */
    private function publicPayload(?PagasaPost $post): array
    {
        if ($post?->permalink_url === null) {
            return [
                'url' => null,
                'updated_at' => null,
            ];
        }

        return [
            'url' => $post->permalink_url,
            'updated_at' => $post->posted_at?->toISOString(),
        ];
    }
}
