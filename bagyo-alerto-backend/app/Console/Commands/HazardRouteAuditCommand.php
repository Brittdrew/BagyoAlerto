<?php

namespace App\Console\Commands;

use App\Models\Barangay;
use App\Models\EvacuationCenter;
use App\Services\HazardGridService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Http;

class HazardRouteAuditCommand extends Command
{
    protected $signature = 'hazard:route-audit
                            {--foot-url= : Override OSRM foot service URL}
                            {--car-url= : Override OSRM car service URL}
                            {--detours : Generate and score detour candidate routes via detourPoints}';

    protected $description = 'Audit OSRM candidate routes and hazard scoring across all barangays and centers';

    public function handle(HazardGridService $gridService): int
    {
        if (! $gridService->isGridAvailable()) {
            $this->error('Hazard grid is unavailable. Please run `php artisan hazard:grid` first.');
            return 1;
        }

        $withDetours = (bool) $this->option('detours');

        [$footUrl, $carUrl] = $this->resolveOsrmUrls();
        $this->info("Using OSRM Foot: {$footUrl}");
        $this->info("Using OSRM Car: {$carUrl}");
        $this->info("Detour candidates: " . ($withDetours ? "ENABLED" : "DISABLED"));

        $barangays = Barangay::whereNotNull('latitude')
            ->whereNotNull('longitude')
            ->orderBy('name')
            ->get();

        $allCenters = EvacuationCenter::where('is_active', true)
            ->whereNotNull('latitude')
            ->whereNotNull('longitude')
            ->get();

        if ($barangays->isEmpty() || $allCenters->isEmpty()) {
            $this->error('No barangays or active evacuation centers found with coordinates.');
            return 1;
        }

        $this->info("Found {$barangays->count()} barangays and {$allCenters->count()} active centers.");

        $rows = [];
        $allScoredRoutes = [];

        $progressBar = $this->output->createProgressBar($barangays->count() * 4);
        $progressBar->start();

        foreach ($barangays as $b) {
            // (a) Assigned evacuation center
            $assigned = EvacuationCenter::where('barangay_id', $b->id)
                ->where('is_active', true)
                ->whereNotNull('latitude')
                ->whereNotNull('longitude')
                ->get()
                ->sortBy(fn($c) => $c->getDistanceTo($b->latitude, $b->longitude))
                ->first();

            // (b) Nearest 2 active centers by straight line distance
            $sortedCenters = $allCenters->map(function ($c) use ($b) {
                $clone = clone $c;
                $clone->dist = $c->getDistanceTo($b->latitude, $b->longitude);
                return $clone;
            })->sortBy('dist')->values();

            $nearest2 = $sortedCenters->take(2);

            $targets = collect();
            if ($assigned) {
                $targets->push($assigned);
            }
            foreach ($nearest2 as $nc) {
                if (! $targets->contains('id', $nc->id)) {
                    $targets->push($nc);
                }
            }

            foreach ($targets as $dest) {
                foreach (['foot', 'car'] as $mode) {
                    $progressBar->advance();

                    // 1s throttle between pairs
                    sleep(1);

                    $result = $this->fetchAndScorePair(
                        $b,
                        $dest,
                        $mode,
                        $mode === 'car' ? $carUrl : $footUrl,
                        $gridService,
                        $withDetours
                    );

                    if ($result === null) {
                        continue;
                    }

                    $rows[] = $result['row'];

                    foreach ($result['candidates'] as $cand) {
                        $allScoredRoutes[] = [
                            'barangay'       => $b->name,
                            'destination'    => $dest->name,
                            'mode'           => $mode,
                            'exposure_index' => $cand['exposure_index'],
                            'duration_min'   => round($cand['durationSec'] / 60),
                            'distance_km'    => round($cand['distanceMeters'] / 1000, 2),
                        ];
                    }
                }
            }
        }

        $progressBar->finish();
        $this->newLine(2);

        // Compute summary metrics
        $totalPairs = count($rows);
        $pairsWithMultipleCandidates = 0;
        $pairsOfferingSafestBefore = 0;
        $pairsOfferingSafestAfter = 0;
        $reductions = [];
        $extraTimesMin = [];

        foreach ($rows as $r) {
            if ($r['candidates'] >= 2) {
                $pairsWithMultipleCandidates++;
            }
            if ($r['base_safest_offered'] === 'Yes') {
                $pairsOfferingSafestBefore++;
            }
            if ($r['safest_offered'] === 'Yes') {
                $pairsOfferingSafestAfter++;
                $reductions[] = $r['improvement_ratio'] * 100;
                $extraTimesMin[] = round($r['extra_sec'] / 60, 1);
            }
        }

        $pctBefore = $totalPairs > 0 ? round(($pairsOfferingSafestBefore / $totalPairs) * 100, 1) : 0.0;
        $pctAfter = $totalPairs > 0 ? round(($pairsOfferingSafestAfter / $totalPairs) * 100, 1) : 0.0;
        $medianReduction = $this->calculateMedian($reductions);
        $medianExtraTime = $this->calculateMedian($extraTimesMin);

        // Better center analysis
        $betterCenterRows = [];
        $rankMap = ['none' => 0, 'low' => 1, 'moderate' => 2, 'high' => 3, 'very_high' => 4];
        $highHazardAssignedCount = 0;

        foreach ($barangays as $b) {
            $assigned = EvacuationCenter::where('barangay_id', $b->id)
                ->where('is_active', true)
                ->whereNotNull('latitude')
                ->whereNotNull('longitude')
                ->get()
                ->sortBy(fn($c) => $c->getDistanceTo($b->latitude, $b->longitude))
                ->first();

            if (! $assigned) continue;

            $assignedHazard = $assigned->hazard_level ?? 'none';
            $assignedRank = $rankMap[$assignedHazard] ?? 0;

            if ($assignedRank >= 3) { // high or very_high
                $highHazardAssignedCount++;
                $assignedDist = $assigned->getDistanceTo($b->latitude, $b->longitude);
                $better = $allCenters->filter(function ($c) use ($assigned, $assignedRank, $assignedDist, $b, $rankMap) {
                    if ($c->id === $assigned->id) return false;
                    $cRank = $rankMap[$c->hazard_level ?? 'none'] ?? 0;
                    if ($cRank >= $assignedRank) return false;
                    $cDist = $c->getDistanceTo($b->latitude, $b->longitude);
                    return $cDist <= max(5.0, $assignedDist + 2.5);
                })->sortBy(fn($c) => $c->getDistanceTo($b->latitude, $b->longitude))->first();

                if ($better) {
                    $betterDist = $better->getDistanceTo($b->latitude, $b->longitude);
                    $betterCenterRows[] = [
                        'barangay'       => $b->name,
                        'current_center' => $assigned->name,
                        'current_hazard' => $assignedHazard,
                        'better_center'  => $better->name,
                        'better_hazard'  => $better->hazard_level ?? 'none',
                        'distance_diff'  => sprintf('%+.2f km', $betterDist - $assignedDist),
                    ];
                }
            }
        }

        // Sort all routes by exposure_index descending for top 5 worst
        usort($allScoredRoutes, fn($a, $b) => $b['exposure_index'] <=> $a['exposure_index']);
        $worst5 = array_slice($allScoredRoutes, 0, 5);

        // Build Markdown Output
        $md = "# Hazard-Aware Route Audit Report\n\n";
        $md .= "Generated at: " . now()->toIso8601String() . "\n\n";

        $md .= "## Summary\n\n";
        $md .= "- **Pairs tested:** {$totalPairs}\n";
        $md .= "- **Pairs with 2+ candidates:** {$pairsWithMultipleCandidates} (" . ($totalPairs > 0 ? round(($pairsWithMultipleCandidates / $totalPairs) * 100, 1) : 0) . "%)\n";
        $md .= "- **Pairs offering 'Safest' (before detours):** {$pairsOfferingSafestBefore} ({$pctBefore}%)\n";
        $md .= "- **Pairs offering 'Safest' (after detours):** {$pairsOfferingSafestAfter} ({$pctAfter}%)\n";
        $md .= "- **Median exposure reduction where offered:** " . number_format($medianReduction, 1) . "%\n";
        $md .= "- **Median extra time where offered:** +" . number_format($medianExtraTime, 1) . " min\n\n";

        $md .= "### Better Center Summary\n\n";
        $md .= "Found {$highHazardAssignedCount} barangays where the assigned evacuation center has high or very_high hazard susceptibility:\n";
        $md .= "- **Better center alternatives available:** " . count($betterCenterRows) . ($highHazardAssignedCount > 0 ? " (" . round((count($betterCenterRows) / $highHazardAssignedCount) * 100, 1) . "%)" : "") . "\n\n";
        if (! empty($betterCenterRows)) {
            $md .= "| Barangay | Current Center | Current Hazard | Better Center | Better Hazard | Distance Diff |\n";
            $md .= "|---|---|---|---|---|---|\n";
            foreach ($betterCenterRows as $bc) {
                $md .= "| {$bc['barangay']} | {$bc['current_center']} | {$bc['current_hazard']} | {$bc['better_center']} | {$bc['better_hazard']} | {$bc['distance_diff']} |\n";
            }
            $md .= "\n";
        }

        $md .= "### 5 Worst Routes by Exposure Index\n\n";
        $md .= "| # | Barangay | Destination | Mode | Distance | ETA | Exposure Index |\n";
        $md .= "|---|---|---|---|---|---|---|\n";
        foreach ($worst5 as $idx => $w) {
            $rank = $idx + 1;
            $exp = number_format($w['exposure_index'], 2);
            $md .= "| {$rank} | {$w['barangay']} | {$w['destination']} | {$w['mode']} | {$w['distance_km']} km | ~{$w['duration_min']} min | {$exp} |\n";
        }
        $md .= "\n";

        $md .= "## Detailed Audit Table\n\n";
        $md .= "| Barangay | Destination | Stored Class | Mode | Candidates | Fastest Min | Fastest Exposure | Safest Offered? | Safest Min | Safest Exposure | % Exposure Reduction |\n";
        $md .= "|---|---|---|---|---|---|---|---|---|---|---|\n";

        foreach ($rows as $r) {
            $md .= sprintf(
                "| %s | %s | %s | %s | %d | %s | %s | %s | %s | %s | %s |\n",
                $r['barangay'],
                $r['destination'],
                $r['stored_class'],
                $r['mode'],
                $r['candidates'],
                $r['fastest_min'],
                $r['fastest_exposure'],
                $r['safest_offered'],
                $r['safest_min'],
                $r['safest_exposure'],
                $r['exposure_reduction']
            );
        }

        $outFile = storage_path('app/route-audit.md');
        file_put_contents($outFile, $md);
        $this->info("Report saved to: {$outFile}");

        // Print Console Summary
        $this->newLine();
        $this->line("==================================================");
        $this->info("ROUTE AUDIT SUMMARY");
        $this->line("==================================================");
        $this->line("• Pairs tested:                   {$totalPairs}");
        $this->line("• Pairs offering 'Safest' before: {$pairsOfferingSafestBefore} ({$pctBefore}%)");
        $this->line("• Pairs offering 'Safest' after:  {$pairsOfferingSafestAfter} ({$pctAfter}%)");
        $this->line("• Median exposure reduction:      " . number_format($medianReduction, 1) . "%");
        $this->line("• Median extra time:              +" . number_format($medianExtraTime, 1) . " min");
        $this->newLine();

        if (! empty($betterCenterRows)) {
            $this->info("Better Center Alternatives ({$highHazardAssignedCount} high/very-high centers):");
            foreach ($betterCenterRows as $bc) {
                $this->line(sprintf("  • %s: %s (%s) -> %s (%s, %s)",
                    $bc['barangay'], $bc['current_center'], $bc['current_hazard'],
                    $bc['better_center'], $bc['better_hazard'], $bc['distance_diff']
                ));
            }
            $this->newLine();
        }

        $this->line("Top 5 Worst Routes by Exposure Index:");
        foreach ($worst5 as $idx => $w) {
            $rank = $idx + 1;
            $this->line(sprintf(
                "  %d. %s -> %s (%s): %s km, %s min, exposure %s",
                $rank,
                $w['barangay'],
                $w['destination'],
                $w['mode'],
                $w['distance_km'],
                $w['duration_min'],
                number_format($w['exposure_index'], 2)
            ));
        }
        $this->newLine();

        return 0;
    }

    private function fetchAndScorePair(
        Barangay $b,
        EvacuationCenter $dest,
        string $mode,
        string $osrmUrl,
        HazardGridService $gridService,
        bool $withDetours
    ): ?array {
        $fromLat = (float) $b->latitude;
        $fromLng = (float) $b->longitude;
        $toLat = (float) $dest->latitude;
        $toLng = (float) $dest->longitude;

        $coords = "{$fromLng},{$fromLat};{$toLng},{$toLat}";
        $profile = $mode === 'car' ? 'car' : 'foot';

        $primaryUrl = rtrim($osrmUrl, '/') . "/route/v1/{$profile}/{$coords}?overview=full&geometries=geojson&alternatives=true";
        $backupUrl = "https://router.project-osrm.org/route/v1/driving/{$coords}?overview=full&geometries=geojson&alternatives=true";

        $routes = [];

        try {
            $res = Http::timeout(15)->get($primaryUrl);
            if ($res->ok() && isset($res['code']) && $res['code'] === 'Ok' && !empty($res['routes'])) {
                $routes = $res['routes'];
            }
        } catch (\Throwable $e) {
            // try backup
        }

        if (empty($routes)) {
            try {
                $res = Http::timeout(15)->get($backupUrl);
                if ($res->ok() && isset($res['code']) && $res['code'] === 'Ok' && !empty($res['routes'])) {
                    $routes = $res['routes'];
                }
            } catch (\Throwable $e) {
                $this->warn("\n[OSRM Error] Could not fetch route for {$b->name} -> {$dest->name} ({$mode}): " . $e->getMessage());
                return null;
            }
        }

        if (empty($routes)) {
            $this->warn("\n[OSRM Empty] No routes returned for {$b->name} -> {$dest->name} ({$mode})");
            return null;
        }

        $routes = array_slice($routes, 0, 3);

        $candidates = [];
        foreach ($routes as $idx => $r) {
            $geoCoords = $r['geometry']['coordinates'] ?? [];
            if (empty($geoCoords)) continue;

            $latLngCoords = array_map(fn($pt) => [(float)$pt[1], (float)$pt[0]], $geoCoords);
            $score = $gridService->scoreRoute($latLngCoords);

            $candidates[] = [
                'id'             => "base_{$idx}",
                'durationSec'    => (float) ($r['duration'] ?? 0),
                'distanceMeters' => (float) ($r['distance'] ?? 0),
                'exposure_index' => (float) ($score['exposure_index'] ?? 0),
                'coords'         => $latLngCoords,
            ];
        }

        if (empty($candidates)) {
            return null;
        }

        // Evaluate baseline before detours
        [$baseFastest, $baseSafest, $baseSafestOffered] = $this->evaluateCandidates($candidates);

        // Generate detour candidates if --detours is active
        if ($withDetours && ! empty($baseFastest['coords'])) {
            $viaPoints = $gridService->detourPoints($baseFastest['coords'], $mode);
            $vIdx = 0;
            foreach ($viaPoints as $vp) {
                $vLat = $vp[0];
                $vLng = $vp[1];
                $viaCoords = "{$fromLng},{$fromLat};{$vLng},{$vLat};{$toLng},{$toLat}";

                $viaPrimaryUrl = rtrim($osrmUrl, '/') . "/route/v1/{$profile}/{$viaCoords}?overview=full&geometries=geojson&alternatives=false";
                $viaBackupUrl = "https://router.project-osrm.org/route/v1/driving/{$viaCoords}?overview=full&geometries=geojson&alternatives=false";

                $viaRoutes = [];
                // 1s throttle between via calls
                sleep(1);

                try {
                    $res = Http::timeout(15)->get($viaPrimaryUrl);
                    if ($res->ok() && isset($res['code']) && $res['code'] === 'Ok' && !empty($res['routes'])) {
                        $viaRoutes = $res['routes'];
                    }
                } catch (\Throwable $e) {}

                if (empty($viaRoutes)) {
                    try {
                        $res = Http::timeout(15)->get($viaBackupUrl);
                        if ($res->ok() && isset($res['code']) && $res['code'] === 'Ok' && !empty($res['routes'])) {
                            $viaRoutes = $res['routes'];
                        }
                    } catch (\Throwable $e) {}
                }

                if (! empty($viaRoutes)) {
                    $vr = $viaRoutes[0];
                    $vGeo = $vr['geometry']['coordinates'] ?? [];
                    if (! empty($vGeo)) {
                        $vLatLng = array_map(fn($pt) => [(float)$pt[1], (float)$pt[0]], $vGeo);
                        $isDup = false;
                        foreach ($candidates as $existing) {
                            if ($this->isDuplicateRoute($existing['coords'], $vLatLng, 0.90)) {
                                $isDup = true;
                                break;
                            }
                        }
                        $doublesBack = $this->isDoublingBack($vLatLng);

                        if (! $isDup && ! $doublesBack) {
                            $score = $gridService->scoreRoute($vLatLng);
                            $candidates[] = [
                                'id'             => "via_{$vIdx}",
                                'durationSec'    => (float) ($vr['duration'] ?? 0),
                                'distanceMeters' => (float) ($vr['distance'] ?? 0),
                                'exposure_index' => (float) ($score['exposure_index'] ?? 0),
                                'coords'         => $vLatLng,
                            ];
                            $vIdx++;
                        }
                    }
                }
            }
        }

        // Cap candidates to 5 total
        $candidates = array_slice($candidates, 0, 5);

        // Evaluate after detours
        [$fastest, $safest, $safestOffered, $improvementRatio] = $this->evaluateCandidates($candidates);

        $extraSec = $safestOffered ? max(0, $safest['durationSec'] - $fastest['durationSec']) : 0.0;
        $storedClass = $dest->hazard_level ?? 'none';

        return [
            'candidates' => $candidates,
            'row'        => [
                'barangay'           => $b->name,
                'destination'        => $dest->name,
                'stored_class'       => $storedClass,
                'mode'               => $mode,
                'candidates'         => count($candidates),
                'fastest_min'        => (string) round($fastest['durationSec'] / 60),
                'fastest_exposure'   => number_format($fastest['exposure_index'], 2),
                'safest_offered'     => $safestOffered ? 'Yes' : 'No',
                'safest_min'         => $safestOffered ? (string) round($safest['durationSec'] / 60) : '-',
                'safest_exposure'    => $safestOffered ? number_format($safest['exposure_index'], 2) : '-',
                'exposure_reduction' => $safestOffered ? (number_format($improvementRatio * 100, 1) . '%') : '-',
                'improvement_ratio'  => $improvementRatio,
                'extra_sec'          => $extraSec,
                'base_safest_offered'=> $baseSafestOffered ? 'Yes' : 'No',
            ],
        ];
    }

    private function evaluateCandidates(array $candidates): array
    {
        usort($candidates, fn($a, $b) => $a['durationSec'] <=> $b['durationSec']);
        $fastest = $candidates[0];

        $numCandidates = count($candidates);
        $safestOffered = false;
        $safest = $fastest;
        $improvementRatio = 0.0;

        if ($numCandidates >= 2) {
            $maxAllowedDuration = min($fastest['durationSec'] * 1.5, $fastest['durationSec'] + 900.0);
            $eligible = array_values(array_filter($candidates, fn($c) => $c['durationSec'] <= $maxAllowedDuration));

            usort($eligible, function ($a, $b) {
                if (abs($a['exposure_index'] - $b['exposure_index']) > 0.01) {
                    return $a['exposure_index'] <=> $b['exposure_index'];
                }
                return $a['durationSec'] <=> $b['durationSec'];
            });

            $safest = $eligible[0] ?? $fastest;
            $isDifferent = ($safest['id'] !== $fastest['id']);
            $exposureDiff = $fastest['exposure_index'] - $safest['exposure_index'];
            $improvementRatio = $fastest['exposure_index'] > 0 ? ($exposureDiff / $fastest['exposure_index']) : 0.0;
            $safestOffered = $isDifferent && ($improvementRatio >= 0.10);
        }

        return [$fastest, $safest, $safestOffered, $improvementRatio];
    }

    private function isDuplicateRoute(array $coordsA, array $coordsB, float $threshold = 0.90): bool
    {
        if (empty($coordsA) || empty($coordsB)) return false;
        $sharedCount = 0;
        foreach ($coordsB as $ptB) {
            foreach ($coordsA as $ptA) {
                $dLat = $ptB[0] - $ptA[0];
                $dLng = $ptB[1] - $ptA[1];
                if (($dLat * $dLat + $dLng * $dLng) < 0.00000005) {
                    $sharedCount++;
                    break;
                }
            }
        }
        return ($sharedCount / count($coordsB)) > $threshold;
    }

    private function isDoublingBack(array $coords): bool
    {
        $n = count($coords);
        if ($n < 6) return false;
        for ($i = 0; $i < $n - 6; $i++) {
            $latA = $coords[$i][0];
            $lngA = $coords[$i][1];
            for ($j = $i + 6; $j < $n; $j++) {
                $latB = $coords[$j][0];
                $lngB = $coords[$j][1];
                $dLat = $latB - $latA;
                $dLng = $lngB - $lngA;
                if (($dLat * $dLat + $dLng * $dLng) < 0.00000005) {
                    return true;
                }
            }
        }
        return false;
    }

    private function calculateMedian(array $values): float
    {
        if (empty($values)) {
            return 0.0;
        }
        sort($values);
        $count = count($values);
        $mid = (int) floor($count / 2);
        if ($count % 2 === 1) {
            return (float) $values[$mid];
        }
        return (float) (($values[$mid - 1] + $values[$mid]) / 2.0);
    }

    private function resolveOsrmUrls(): array
    {
        $footUrl = $this->option('foot-url');
        $carUrl = $this->option('car-url');

        $frontendEnvPath = base_path('../bagyo-alerto-frontend/.env');
        if (file_exists($frontendEnvPath)) {
            $lines = file($frontendEnvPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
            foreach ($lines as $line) {
                $line = trim($line);
                if (str_starts_with($line, '#')) continue;
                if (str_contains($line, '=')) {
                    [$k, $v] = explode('=', $line, 2);
                    $k = trim($k);
                    $v = trim($v);
                    if (!$footUrl && in_array($k, ['VITE_OSRM_URL_FOOT', 'VITE_OSRM_URL'])) {
                        $footUrl = $v;
                    }
                    if (!$carUrl && $k === 'VITE_OSRM_URL_CAR') {
                        $carUrl = $v;
                    }
                }
            }
        }

        $footUrl = $footUrl ?: 'https://routing.openstreetmap.de/routed-foot';
        $carUrl = $carUrl ?: 'https://routing.openstreetmap.de/routed-car';

        return [$footUrl, $carUrl];
    }
}
