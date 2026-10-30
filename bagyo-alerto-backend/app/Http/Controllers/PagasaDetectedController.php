<?php

namespace App\Http\Controllers;

use App\Models\PagasaDetectedSignal;
use App\Services\PagasaBulletinService;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Cache\Repository;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Cache;
use Throwable;

class PagasaDetectedController extends Controller
{
    public function liveBulletin(PagasaBulletinService $service): JsonResponse
    {
        $cache = app()->environment('testing') ? Cache::store() : Cache::store('file');
        $freshKey = 'pagasa.live-bulletin.v1';
        $lastGoodKey = 'pagasa.live-bulletin.last-good.v1';

        $cached = $cache->get($freshKey);
        if (is_array($cached)) {
            return response()->json($cached);
        }

        $lastGood = $cache->get($lastGoodKey);
        if (! is_array($lastGood)) {
            $lastGood = $this->storedBulletinPayload();
            if (is_array($lastGood)) {
                $cache->put($lastGoodKey, $lastGood, now()->addDay());
            }
        }

        if (is_array($lastGood)) {
            // Return known official data immediately, then refresh after the
            // response so a slow PAGASA server never blocks the dashboard.
            defer(function () use ($service, $cache, $freshKey, $lastGoodKey): void {
                $this->refreshLiveBulletin($service, $cache, $freshKey, $lastGoodKey);
            }, 'pagasa.live-bulletin.refresh', true);

            return response()->json([
                ...$lastGood,
                'is_stale' => $this->payloadIsStale($lastGood),
                'refreshing' => true,
            ]);
        }

        return response()->json(
            $this->refreshLiveBulletin($service, $cache, $freshKey, $lastGoodKey)
        );
    }

    public function publicUpdate(): JsonResponse
    {
        $latestCheck = PagasaDetectedSignal::query()
            ->orderByDesc('fetched_at')
            ->orderByDesc('id')
            ->first();

        $latestGood = PagasaDetectedSignal::query()
            ->whereIn('status', ['detected', 'no_active_bulletin'])
            ->orderByDesc('fetched_at')
            ->orderByDesc('id')
            ->first();

        $detectionFailed = in_array($latestCheck?->status, ['fetch_failed', 'parse_failed'], true);
        $isStale = $latestGood === null
            || $latestGood->fetched_at === null
            || $latestGood->fetched_at->lt(now()->subMinutes(30));

        return response()->json([
            'active' => $latestGood?->status === 'detected',
            'storm_name' => $latestGood?->storm_name,
            'bulletin_no' => $latestGood?->bulletin_no,
            'issued_at' => $latestGood?->issued_at?->toISOString(),
            'sdn_signal' => $latestGood?->sdn_signal,
            'siargao_signal' => $latestGood?->siargao_signal,
            'bucas_grande_signal' => $latestGood?->bucas_grande_signal,
            'source_url' => $latestGood?->source_url,
            'last_checked_at' => $latestCheck?->fetched_at?->toISOString(),
            'is_stale' => $isStale,
            'detection_failed' => $detectionFailed,
            'status' => $latestCheck?->status ?? 'never_checked',
        ]);
    }

    public function show(): JsonResponse
    {
        $latest = PagasaDetectedSignal::query()
            ->orderByDesc('fetched_at')
            ->orderByDesc('id')
            ->first();

        if ($latest === null) {
            return response()->json([
                'data' => null,
                'is_stale' => true,
            ]);
        }

        return response()->json([
            ...$latest->toArray(),
            'is_stale' => $latest->fetched_at === null
                || $latest->fetched_at->lt(now()->subMinutes(30)),
        ]);
    }

    /**
     * @param  array<string, mixed>  $result
     * @return array<string, mixed>
     */
    private function bulletinPayload(array $result, bool $stale = false): array
    {
        $status = (string) ($result['status'] ?? 'fetch_failed');

        return [
            'active' => $status === 'detected',
            'status' => $status,
            'storm_name' => $result['storm_name'] ?? null,
            'bulletin_no' => $result['bulletin_no'] ?? null,
            'issued_at' => $result['issued_at']?->toISOString(),
            'sdn_signal' => $result['sdn_signal'] ?? null,
            'siargao_signal' => $result['siargao_signal'] ?? null,
            'bucas_grande_signal' => $result['bucas_grande_signal'] ?? null,
            'source_url' => $result['source_url'] ?? null,
            'last_checked_at' => $result['fetched_at']?->toISOString(),
            'is_stale' => $stale,
            'error' => $result['_error'] ?? null,
            'refreshing' => false,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function refreshLiveBulletin(
        PagasaBulletinService $service,
        Repository $cache,
        string $freshKey,
        string $lastGoodKey
    ): array {
        $result = $service->detect();
        $successful = in_array($result['status'] ?? null, ['detected', 'no_active_bulletin'], true);

        if ($successful) {
            $payload = $this->bulletinPayload($result);
            $cache->put($freshKey, $payload, now()->addMinutes(5));
            $cache->put($lastGoodKey, $payload, now()->addDay());

            return $payload;
        }

        $lastGood = $cache->get($lastGoodKey);
        if (is_array($lastGood)) {
            $payload = [
                ...$lastGood,
                'status' => $result['status'] ?? 'fetch_failed',
                'last_checked_at' => $result['fetched_at']?->toISOString(),
                'is_stale' => true,
                'error' => $result['_error'] ?? 'The official PAGASA bulletin could not be refreshed.',
                'refreshing' => false,
            ];
        } else {
            $payload = $this->bulletinPayload($result, true);
        }

        // Briefly cache failures so concurrent resident requests do not hammer PAGASA.
        $cache->put($freshKey, $payload, now()->addMinute());

        return $payload;
    }

    /**
     * @return array<string, mixed>|null
     */
    private function storedBulletinPayload(): ?array
    {
        try {
            $latest = PagasaDetectedSignal::query()
                ->whereIn('status', ['detected', 'no_active_bulletin'])
                ->orderByDesc('fetched_at')
                ->orderByDesc('id')
                ->first();
        } catch (Throwable) {
            return null;
        }

        if ($latest === null) {
            return null;
        }

        return $this->bulletinPayload([
            'status' => $latest->status,
            'storm_name' => $latest->storm_name,
            'bulletin_no' => $latest->bulletin_no,
            'issued_at' => $latest->issued_at,
            'sdn_signal' => $latest->sdn_signal,
            'siargao_signal' => $latest->siargao_signal,
            'bucas_grande_signal' => $latest->bucas_grande_signal,
            'source_url' => $latest->source_url,
            'fetched_at' => $latest->fetched_at,
        ], true);
    }

    /** @param array<string, mixed> $payload */
    private function payloadIsStale(array $payload): bool
    {
        $lastChecked = $payload['last_checked_at'] ?? null;
        if (! is_string($lastChecked) || $lastChecked === '') {
            return true;
        }

        try {
            return CarbonImmutable::parse($lastChecked)->lt(now()->subMinutes(30));
        } catch (Throwable) {
            return true;
        }
    }
}
