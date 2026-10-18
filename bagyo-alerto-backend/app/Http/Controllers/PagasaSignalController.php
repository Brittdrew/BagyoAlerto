<?php

namespace App\Http\Controllers;

use App\Models\PagasaSignal;
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
        ]);
    }

    /**
     * POST /api/admin/pagasa-signal
     * Admin endpoint: body {signal: 0-5}.
     * Validate integer 0-5, return 422 otherwise.
     * Inserts a row, clears the cache, returns the new current signal.
     */
    public function store(Request $request)
    {
        $validated = $request->validate([
            'signal' => 'required|integer|min:0|max:5',
        ]);

        $pagasaSignal = PagasaSignal::create([
            'signal'     => (int) $validated['signal'],
            'set_by'     => $request->user()?->id,
            'created_at' => now(),
        ]);

        PagasaSignal::clearCache();

        return response()->json([
            'signal' => (int) $pagasaSignal->signal,
            'set_at' => $pagasaSignal->created_at?->toISOString() ?? $pagasaSignal->created_at,
        ]);
    }
}
