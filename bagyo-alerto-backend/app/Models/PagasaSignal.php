<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Cache;

class PagasaSignal extends Model
{
    public const CREATED_AT = 'created_at';
    public const UPDATED_AT = null;

    public const PAGASA_SIGNAL_FLOORS = [
        0 => 'none',
        1 => 'high',
        2 => 'high',
        3 => 'critical',
        4 => 'catastrophic',
        5 => 'catastrophic',
    ];

    public const SEVERITY_ORDER = [
        'low'          => 0,
        'moderate'     => 1,
        'high'         => 2,
        'critical'     => 3,
        'catastrophic' => 4,
    ];

    protected $fillable = [
        'signal',
        'set_by',
        'created_at',
    ];

    protected $casts = [
        'signal'     => 'integer',
        'set_by'     => 'integer',
        'created_at' => 'datetime',
    ];

    /**
     * Fetch the current signal with ONE query (latest row) and cache for 30s.
     */
    public static function current(): array
    {
        return Cache::remember('pagasa_signal.current', 30, function () {
            try {
                $latest = self::orderByDesc('id')->first();
            } catch (\Throwable $e) {
                $latest = null;
            }

            return [
                'signal' => $latest ? (int) $latest->signal : 0,
                'set_at' => $latest ? $latest->created_at?->toISOString() : null,
                'set_by' => $latest ? $latest->set_by : null,
            ];
        });
    }

    /**
     * Clear the cached PAGASA signal.
     */
    public static function clearCache(): void
    {
        Cache::forget('pagasa_signal.current');
        try {
            Cache::store('file')->forget('pagasa_signal.current');
        } catch (\Throwable $e) {
            // Ignore if file cache not configured
        }
    }
}
