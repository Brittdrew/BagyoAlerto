<?php

namespace App\Console\Commands;

use App\Models\PagasaDetectedSignal;
use App\Services\PagasaBulletinService;
use App\Services\PagasaSignalService;
use Illuminate\Console\Command;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\Log;
use Throwable;

class PagasaDetectCommand extends Command
{
    protected $signature = 'pagasa:detect';

    protected $description = 'Detect Surigao-area wind signals from the latest PAGASA bulletin';

    public function handle(
        PagasaBulletinService $service,
        PagasaSignalService $signalService
    ): int {
        $result = $service->detect();
        $status = $result['status'];

        if (in_array($status, ['fetch_failed', 'parse_failed'], true)) {
            Log::error('PAGASA signal auto-detection failed.', [
                'status' => $status,
                'source_url' => $result['source_url'] ?? null,
                'error' => $result['_error'] ?? 'Unknown detection failure',
            ]);
        }

        try {
            $row = PagasaDetectedSignal::create(Arr::only($result, [
                'status',
                'storm_name',
                'bulletin_no',
                'issued_at',
                'sdn_signal',
                'siargao_signal',
                'bucas_grande_signal',
                'source_url',
                'fetched_at',
                'raw_excerpt',
            ]));

            $appliedSignal = $signalService->applyDetection($row);
        } catch (Throwable $e) {
            Log::error('PAGASA signal detection result could not be stored.', [
                'status' => $status,
                'error' => $e->getMessage(),
            ]);
            $this->error('Detection ran, but its result could not be stored.');

            return self::FAILURE;
        }

        $this->line("Stored PAGASA detection #{$row->id}: {$row->status}");

        if ($row->status === 'detected') {
            $this->info(sprintf(
                'Surigao del Norte: %s; Siargao: %s; Bucas Grande: %s',
                $row->sdn_signal ?? 'none',
                $row->siargao_signal ?? 'none',
                $row->bucas_grande_signal ?? 'none'
            ));
        }

        if (isset($appliedSignal)) {
            $this->info("Automatically applied city-wide Signal {$appliedSignal->signal}.");
        }

        return in_array($status, ['fetch_failed', 'parse_failed'], true)
            ? self::FAILURE
            : self::SUCCESS;
    }
}
