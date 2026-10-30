<?php

namespace App\Services;

use App\Models\PagasaDetectedSignal;
use App\Models\PagasaSignal;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use InvalidArgumentException;

class PagasaSignalService
{
    public function setSignal(int $signal, string $source = 'manual', ?int $setBy = null): PagasaSignal
    {
        if ($signal < 0 || $signal > 5) {
            throw new InvalidArgumentException('PAGASA signal must be between 0 and 5.');
        }

        if (! in_array($source, ['manual', 'auto'], true)) {
            throw new InvalidArgumentException('PAGASA signal source must be manual or auto.');
        }

        $pagasaSignal = PagasaSignal::create([
            'signal' => $signal,
            'set_by' => $source === 'manual' ? $setBy : null,
            'source' => $source,
            'created_at' => now(),
        ]);

        PagasaSignal::clearCache();

        return $pagasaSignal;
    }

    /**
     * Apply a newly stored detection if it is newer than the last handled
     * bulletin. Returns the inserted floor row, or null for a safe no-op.
     */
    public function applyDetection(PagasaDetectedSignal $detection): ?PagasaSignal
    {
        if (! in_array($detection->status, ['detected', 'no_active_bulletin'], true)) {
            return null;
        }

        return DB::transaction(function () use ($detection): ?PagasaSignal {
            $current = PagasaSignal::query()->orderByDesc('id')->lockForUpdate()->first();
            $isClear = $detection->status === 'no_active_bulletin'
                || ($detection->status === 'detected' && $detection->sdn_signal === null);

            if ($isClear) {
                // Automated observations may only clear an automated floor.
                if ($current === null || $current->source !== 'auto') {
                    return null;
                }

                if (! $this->isNewerThanLastApplied($detection, $current)) {
                    return null;
                }

                if ((int) $current->signal === 0) {
                    $this->markApplied($detection);

                    return null;
                }

                $applied = $this->setSignal(0, 'auto');
                $this->markApplied($detection);

                return $applied;
            }

            if (! $this->isNewerThanLastApplied($detection, $current)) {
                return null;
            }

            $applied = $this->setSignal((int) $detection->sdn_signal, 'auto');
            $this->markApplied($detection);

            return $applied;
        });
    }

    private function isNewerThanLastApplied(
        PagasaDetectedSignal $detection,
        ?PagasaSignal $current
    ): bool {
        if ($detection->issued_at === null) {
            // A successful explicit no-active response may not carry bulletin
            // metadata. It may clear an auto floor, but never a manual one.
            return $detection->status === 'no_active_bulletin';
        }

        $threshold = null;
        $lastApplied = PagasaDetectedSignal::query()
            ->whereNotNull('applied_at')
            ->orderByRaw('COALESCE(issued_at, fetched_at) DESC')
            ->first();
        $lastAppliedIssuedAt = $lastApplied?->issued_at ?? $lastApplied?->fetched_at;

        if ($lastAppliedIssuedAt !== null) {
            $threshold = CarbonImmutable::parse($lastAppliedIssuedAt);
        }

        // A manual override establishes a newer threshold of its own. The
        // same/older bulletin cannot immediately overwrite the operator.
        if ($current?->source === 'manual' && $current->created_at !== null) {
            $manualAt = CarbonImmutable::instance($current->created_at);
            if ($threshold === null || $manualAt->gt($threshold)) {
                $threshold = $manualAt;
            }
        }

        return $threshold === null || $detection->issued_at->gt($threshold);
    }

    private function markApplied(PagasaDetectedSignal $detection): void
    {
        $detection->forceFill(['applied_at' => now()])->save();
    }
}
