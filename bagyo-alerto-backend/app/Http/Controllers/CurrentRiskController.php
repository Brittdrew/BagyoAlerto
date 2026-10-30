<?php

namespace App\Http\Controllers;

use App\Models\TyphoonLog;
use Illuminate\Http\JsonResponse;

class CurrentRiskController extends Controller
{
    public function show(): JsonResponse
    {
        $latest = TyphoonLog::query()
            ->where('is_manual', false)
            ->orderByDesc('logged_at')
            ->orderByDesc('id')
            ->first();
        $severity = $latest?->severity_level ?? 'low';
        $classification = match ($severity) {
            'catastrophic' => 'Catastrophic',
            'critical' => 'Critical',
            'high' => 'High',
            'moderate' => 'Moderate',
            default => 'Normal',
        };

        return response()->json([
            'severity' => $severity,
            'classification' => $classification,
            'barangay_id' => $latest?->barangay_id,
            'updated_at' => $latest?->logged_at?->toISOString(),
            'source' => $latest ? 'latest_non_manual_assessment' : 'default',
        ]);
    }
}
