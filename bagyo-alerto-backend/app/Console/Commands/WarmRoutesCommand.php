<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use App\Models\Barangay;
use App\Models\EvacuationCenter;
use App\Services\RouteService;

class WarmRoutesCommand extends Command
{
    protected $signature = 'routes:warm';
    protected $description = 'Pre-warm cached routes from barangay centroids to their evacuation centers';

    public function handle(RouteService $routeService): int
    {
        $barangays = Barangay::all();
        $this->info("Warming routes for {$barangays->count()} barangays...");

        $success = 0;
        foreach ($barangays as $b) {
            $center = EvacuationCenter::where('barangay_id', $b->id)
                ->where('is_active', true)
                ->first();

            if (!$center) {
                $center = EvacuationCenter::where('is_active', true)->first();
            }

            if (!$center || !$b->latitude || !$b->longitude || !$center->latitude || !$center->longitude) {
                continue;
            }

            $this->line("Fetching route: {$b->name} -> {$center->name}...");
            $res = $routeService->getRoute(
                (float)$b->latitude,
                (float)$b->longitude,
                (float)$center->latitude,
                (float)$center->longitude
            );

            if ($res) {
                $this->info("✓ Cached route for {$b->name}");
                $success++;
            } else {
                $this->warn("✗ Could not fetch route for {$b->name}");
            }
        }

        $this->info("Completed: {$success} routes cached.");
        return 0;
    }
}
