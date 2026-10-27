<?php

namespace App\Http\Controllers;

use App\Services\HazardGridService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class RouteHazardScoreController extends Controller
{
    public function score(Request $request, HazardGridService $gridService): JsonResponse
    {
        if (! $gridService->isGridAvailable()) {
            return response()->json([
                'message' => 'Hazard grid is unavailable. Please run `php artisan hazard:grid` to precompute the grid.',
            ], 503);
        }

        $validated = $request->validate([
            'routes'                  => ['required', 'array', 'min:1', 'max:5'],
            'routes.*.id'             => ['required'],
            'routes.*.coordinates'    => ['required', 'array', 'min:2', 'max:3000'],
            'routes.*.coordinates.*'  => ['required', 'array', 'size:2'],
            'routes.*.coordinates.*.0' => ['required', 'numeric', 'between:-90,90'],
            'routes.*.coordinates.*.1' => ['required', 'numeric', 'between:-180,180'],
        ]);

        $scoredRoutes = [];
        foreach ($validated['routes'] as $routeInput) {
            $score = $gridService->scoreRoute($routeInput['coordinates']);
            $scoredRoutes[] = [
                'id'              => $routeInput['id'],
                'length_m'        => $score['length_m'],
                'exposure_index'  => $score['exposure_index'],
                'meters_by_class' => $score['meters_by_class'],
                'segments'        => $score['segments'],
            ];
        }

        return response()->json([
            'routes' => $scoredRoutes,
        ]);
    }
}
