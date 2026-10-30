<?php

namespace App\Http\Controllers;

use App\Models\PagasaSignal;
use App\Services\PagasaSignalService;
use Illuminate\Http\Request;

class PagasaSignalController extends Controller
{
    /**
     * GET /api/pagasa-signal
     * Public endpoint: returns current signal, set_at.
     */
    public function show()
    {
        $current = PagasaSignal::current();

        return response()->json([
            'signal' => (int) $current['signal'],
            'set_at' => $current['set_at'],
            'source' => $current['source'] ?? 'manual',
        ]);
    }

    /**
     * POST /api/admin/pagasa-signal
     * Admin endpoint: body {signal: 0-5}.
     * Validate integer 0-5, return 422 otherwise.
     * Inserts a row, clears the cache, returns the new current signal.
     */
    public function store(Request $request, PagasaSignalService $signalService)
    {
        $validated = $request->validate([
            'signal' => 'required|integer|min:0|max:5',
        ]);

        $pagasaSignal = $signalService->setSignal(
            (int) $validated['signal'],
            'manual',
            $request->user()?->id
        );

        return response()->json([
            'signal' => (int) $pagasaSignal->signal,
            'set_at' => $pagasaSignal->created_at?->toISOString() ?? $pagasaSignal->created_at,
            'source' => $pagasaSignal->source,
        ]);
    }
}
