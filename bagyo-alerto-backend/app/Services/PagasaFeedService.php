<?php

namespace App\Services;

use App\Contracts\PagasaDriver;
use App\Models\PagasaPost;
use App\Models\PagasaSyncStatus;
use App\Services\Pagasa\BulletinPagasaDriver;
use App\Services\Pagasa\FacebookPagasaDriver;
use Illuminate\Support\Facades\Log;
use RuntimeException;
use Throwable;

class PagasaFeedService
{
    public function __construct(
        private readonly BulletinPagasaDriver $bulletinDriver,
        private readonly FacebookPagasaDriver $facebookDriver
    ) {}

    /**
     * @return array{success: bool, driver: string, fallback: bool, post: ?PagasaPost, error: ?string}
     */
    public function sync(): array
    {
        $requestedDriver = strtolower((string) config('services.pagasa.driver', 'bulletin'));
        $fallback = false;

        try {
            $driver = $this->driver($requestedDriver);

            try {
                $payload = $driver->fetchLatest();
            } catch (Throwable $primaryError) {
                if ($requestedDriver !== 'facebook') {
                    throw $primaryError;
                }

                $fallback = true;
                Log::warning('PAGASA Facebook driver failed; trying bulletin fallback.', [
                    'error' => $primaryError->getMessage(),
                ]);

                try {
                    $driver = $this->bulletinDriver;
                    $payload = $driver->fetchLatest();
                } catch (Throwable $fallbackError) {
                    throw new RuntimeException(sprintf(
                        'Facebook driver: %s; bulletin fallback: %s',
                        $primaryError->getMessage(),
                        $fallbackError->getMessage()
                    ));
                }
            }

            $post = PagasaPost::firstOrCreate(
                ['fb_post_id' => $payload['fb_post_id']],
                [
                    'message' => $payload['message'] ?? null,
                    'image_url' => $payload['image_url'] ?? null,
                    'permalink_url' => $payload['permalink_url'] ?? null,
                    'posted_at' => $payload['posted_at'],
                    'source' => 'auto',
                    'is_active' => true,
                ]
            );

            $this->recordSuccess();
            Log::info('PAGASA feed sync completed.', [
                'driver' => $driver->name(),
                'fallback' => $fallback,
                'post_id' => $post->fb_post_id,
                'inserted' => $post->wasRecentlyCreated,
            ]);

            return [
                'success' => true,
                'driver' => $driver->name(),
                'fallback' => $fallback,
                'post' => $post,
                'error' => null,
            ];
        } catch (Throwable $e) {
            $this->recordFailure($e->getMessage());
            Log::error('PAGASA feed sync failed.', [
                'driver' => $requestedDriver,
                'error' => $e->getMessage(),
            ]);

            return [
                'success' => false,
                'driver' => $requestedDriver,
                'fallback' => $fallback,
                'post' => null,
                'error' => $e->getMessage(),
            ];
        }
    }

    private function driver(string $name): PagasaDriver
    {
        return match ($name) {
            'bulletin' => $this->bulletinDriver,
            'facebook' => $this->facebookDriver,
            default => throw new RuntimeException("Unsupported PAGASA_DRIVER: {$name}"),
        };
    }

    private function recordSuccess(): void
    {
        try {
            PagasaSyncStatus::updateOrCreate(
                ['id' => 1],
                [
                    'last_success_at' => now(),
                    'last_error' => null,
                    'last_error_at' => null,
                    'failure_started_at' => null,
                    'updated_at' => now(),
                ]
            );
        } catch (Throwable $e) {
            Log::error('PAGASA sync status could not be saved.', ['error' => $e->getMessage()]);
        }
    }

    private function recordFailure(string $error): void
    {
        try {
            $status = PagasaSyncStatus::find(1);
            PagasaSyncStatus::updateOrCreate(
                ['id' => 1],
                [
                    'last_success_at' => $status?->last_success_at,
                    'last_error' => $error,
                    'last_error_at' => now(),
                    'failure_started_at' => $status?->failure_started_at ?? now(),
                    'updated_at' => now(),
                ]
            );
        } catch (Throwable $e) {
            Log::error('PAGASA sync failure status could not be saved.', ['error' => $e->getMessage()]);
        }
    }
}
