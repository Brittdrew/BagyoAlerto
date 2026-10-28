<?php

namespace App\Console\Commands;

use App\Models\Barangay;
use App\Models\EvacuationCenter;
use App\Services\HazardLookupService;
use Illuminate\Console\Command;
use Illuminate\Support\Carbon;

class HazardLookupCommand extends Command
{
    protected $signature = 'hazard:lookup
                            {--only= : Limit to "barangays" or "centers"}
                            {--id= : Only process the row with this id (applies within --only scope)}
                            {--name= : Only process the row whose name contains this string (applies within --only scope)}
                            {--force : Re-query rows whose susceptibility columns are already filled}
                            {--dry-run : Print what would be written without saving anything}';

    protected $description = 'Fill flood and landslide susceptibility with 50m worst-case buffer and 100m proximity from GeoRisk MGB WMS';

    /** @var array<string, array{status:string,class:string|null,raw:string|null}> */
    private array $cache = [];

    public function handle(HazardLookupService $svc): int
    {
        $only   = $this->option('only');
        $force  = (bool) $this->option('force');
        $dryRun = (bool) $this->option('dry-run');
        $filterId   = $this->option('id');
        $filterName = $this->option('name');

        if ($dryRun) {
            $this->warn('[DRY RUN] No data will be saved.');
        }

        if ($filterId !== null || $filterName !== null) {
            $desc = $filterId !== null ? "id={$filterId}" : "name like '%{$filterName}%'";
            $this->info("Filtering: {$desc}");
        }

        $tableRows = [];

        if ($only !== 'centers') {
            $query = Barangay::whereNotNull('latitude')->whereNotNull('longitude');
            if ($filterId !== null) {
                $query->where('id', (int) $filterId);
            } elseif ($filterName !== null) {
                $query->where('name', 'like', "%{$filterName}%");
            }
            $this->processCollection($query->get(), 'barangay', $svc, $force, $dryRun, $tableRows);
        }

        if ($only !== 'barangays') {
            $query = EvacuationCenter::whereNotNull('latitude')->whereNotNull('longitude');
            if ($filterId !== null) {
                $query->where('id', (int) $filterId);
            } elseif ($filterName !== null) {
                $query->where('name', 'like', "%{$filterName}%");
            }
            $this->processCollection($query->get(), 'center', $svc, $force, $dryRun, $tableRows);
        }

        $this->table(
            ['Type', 'Name', 'Flood Before', 'Flood After', 'Landslide Before', 'Landslide After', 'Point (F/L)', 'Nearby (F/L)', 'Status'],
            $tableRows
        );

        return self::SUCCESS;
    }

    /**
     * @param  \Illuminate\Support\Collection<int, Barangay|EvacuationCenter> $rows
     * @param  array<int, array>   $tableRows  (by reference)
     */
    private function processCollection(
        \Illuminate\Support\Collection $rows,
        string $type,
        HazardLookupService $svc,
        bool $force,
        bool $dryRun,
        array &$tableRows
    ): void {
        foreach ($rows as $row) {
            $lat = (float) $row->latitude;
            $lng = (float) $row->longitude;

            $floodBefore     = $row->flood_susceptibility     ?? '—';
            $landslideBefore = $row->landslide_susceptibility ?? '—';
            $pointBefore     = ($row->flood_point_class ?? '—') . ' / ' . ($row->landslide_point_class ?? '—');
            $nearbyBefore    = $this->formatNearby($row->flood_mapped_nearby, $row->landslide_mapped_nearby);

            // 5. Never overwrite rows whose hazard source is "manual (admin)"
            if ($row->hazard_source === 'manual (admin)') {
                $tableRows[] = [
                    'type'             => $type,
                    'name'             => $row->name ?? '(no name)',
                    'flood_before'     => $floodBefore,
                    'flood_after'      => $floodBefore,
                    'landslide_before' => $landslideBefore,
                    'landslide_after'  => $landslideBefore,
                    'point'            => $pointBefore,
                    'nearby'           => $nearbyBefore,
                    'status'           => 'skipped (manual admin)',
                ];
                continue;
            }

            // Skip if already filled and --force not set
            if (! $force && ! empty($row->flood_susceptibility) && ! empty($row->landslide_susceptibility)) {
                $tableRows[] = [
                    'type'             => $type,
                    'name'             => $row->name ?? '(no name)',
                    'flood_before'     => $floodBefore,
                    'flood_after'      => $floodBefore,
                    'landslide_before' => $landslideBefore,
                    'landslide_after'  => $landslideBefore,
                    'point'            => $pointBefore,
                    'nearby'           => $nearbyBefore,
                    'status'           => 'skipped',
                ];
                continue;
            }

            // Query radius samples for flood & landslide
            $floodRes     = $svc->lookupWithRadius($lat, $lng, 'flood', $this->cache);
            $landslideRes = $svc->lookupWithRadius($lat, $lng, 'landslide', $this->cache);

            // 4. A failed or timed-out request must never be stored as no_data. Skip that row and report it.
            if ($floodRes['status'] === 'error' || $landslideRes['status'] === 'error') {
                $failedLayers = [];
                if ($floodRes['status'] === 'error') {
                    $failedLayers[] = 'flood';
                }
                if ($landslideRes['status'] === 'error') {
                    $failedLayers[] = 'landslide';
                }
                $failedDesc = implode(' & ', $failedLayers);

                $this->warn("Failed request for {$type} '{$row->name}' ({$failedDesc}) - skipped row.");

                $tableRows[] = [
                    'type'             => $type,
                    'name'             => $row->name ?? '(no name)',
                    'flood_before'     => $floodBefore,
                    'flood_after'      => '(request failed)',
                    'landslide_before' => $landslideBefore,
                    'landslide_after'  => '(request failed)',
                    'point'            => '— / —',
                    'nearby'           => '— / —',
                    'status'           => "skipped ({$failedDesc} error)",
                ];
                continue;
            }

            // Extract results
            $floodWorst     = $floodRes['worst_class'];
            $floodPoint     = $floodRes['point_class'];
            $floodNearby    = $floodRes['mapped_nearby'];

            $landslideWorst  = $landslideRes['worst_class'];
            $landslidePoint  = $landslideRes['point_class'];
            $landslideNearby = $landslideRes['mapped_nearby'];

            $floodAfter     = $floodWorst     ?? 'no_data';
            $landslideAfter = $landslideWorst ?? 'no_data';

            if (! $dryRun) {
                $row->flood_susceptibility     = $floodWorst;
                $row->flood_point_class        = $floodPoint;
                $row->flood_mapped_nearby      = $floodNearby;

                $row->landslide_susceptibility = $landslideWorst;
                $row->landslide_point_class    = $landslidePoint;
                $row->landslide_mapped_nearby  = $landslideNearby;

                $row->hazard_source            = 'MGB via GeoRisk WMS';
                $row->hazard_checked_at        = Carbon::now();
                $row->save();
            }

            $tableRows[] = [
                'type'             => $type,
                'name'             => $row->name ?? '(no name)',
                'flood_before'     => $floodBefore,
                'flood_after'      => $floodAfter,
                'landslide_before' => $landslideBefore,
                'landslide_after'  => $landslideAfter,
                'point'            => ($floodPoint ?? '—') . ' / ' . ($landslidePoint ?? '—'),
                'nearby'           => $this->formatNearby($floodNearby, $landslideNearby),
                'status'           => $dryRun ? 'dry-run' : 'updated',
            ];
        }
    }

    private function formatNearby(?bool $f, ?bool $l): string
    {
        $fStr = $f === true ? 'yes' : ($f === false ? 'no' : '—');
        $lStr = $l === true ? 'yes' : ($l === false ? 'no' : '—');
        return "{$fStr} / {$lStr}";
    }
}
