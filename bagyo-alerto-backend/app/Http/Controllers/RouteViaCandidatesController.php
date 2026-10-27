<?php

namespace App\Http\Controllers;

use App\Services\HazardGridService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class RouteViaCandidatesController extends Controller
{
    public function candidates(Request $request, HazardGridService $gridService): JsonResponse
    {
        if (! $gridService->isGridAvailable()) {
            return response()->json([
                'message' => 'Hazard grid is unavailable. Please run `php artisan hazard:grid` to precompute the grid.',
            ], 503);
        }

        $validated = $request->validate([
            'coordinates'     => ['required_without:route_coords', 'array', 'min:2', 'max:3000'],
            'coordinates.*'   => ['array', 'size:2'],
            'coordinates.*.0' => ['numeric', 'between:-90,90'],
            'coordinates.*.1' => ['numeric', 'between:-180,180'],
            'route_coords'    => ['required_without:coordinates', 'array', 'min:2', 'max:3000'],
            'route_coords.*'  => ['array', 'size:2'],
            'route_coords.*.0' => ['numeric', 'between:-90,90'],
            'route_coords.*.1' => ['numeric', 'between:-180,180'],
            'mode'            => ['nullable', 'string', 'in:foot,car'],
        ]);

        $coords = $validated['coordinates'] ?? $validated['route_coords'];
        $mode = $validated['mode'] ?? 'foot';

        $viaPoints = $gridService->detourPoints($coords, $mode);

        return response()->json([
            'via_points' => $viaPoints,
            'points'     => $viaPoints,
        ]);
    }
}
