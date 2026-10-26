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
                            {--force : Re-query rows whose susceptibility columns are already filled}
                            {--dry-run : Print what would be written without saving anything}';

    protected $description = 'Fill flood_susceptibility and landslide_susceptibility from the GeoRisk MGB WMS';

    /** @var array<string, array{status:string,class:string|null,raw:string|null}> */
    private array $cache = [];

    public function handle(HazardLookupService $svc): int
    {
        $only   = $this->option('only');
        $force  = (bool) $this->option('force');
        $dryRun = (bool) $this->option('dry-run');

        if ($dryRun) {
            $this->warn('[DRY RUN] No data will be saved.');
        }

        $services  = array_keys((array) config('hazard.services', []));
        $tableRows = [];

        if ($only !== 'centers') {
            $this->processCollection(
                Barangay::whereNotNull('latitude')->whereNotNull('longitude')->get(),
                'barangay',
                $services,
                $svc,
                $force,
                $dryRun,
                $tableRows
            );
        }

        if ($only !== 'barangays') {
            $this->processCollection(
                EvacuationCenter::whereNotNull('latitude')->whereNotNull('longitude')->get(),
                'center',
                $services,
                $svc,
                $force,
                $dryRun,
                $tableRows
            );
        }

        $this->table(
            ['Type', 'Name', 'Lat', 'Lng', 'Flood', 'Landslide', 'Status'],
            $tableRows
        );

        return self::SUCCESS;
    }

    /**
     * @param  \Illuminate\Support\Collection<int, Barangay|EvacuationCenter> $rows
     * @param  array<int, string>  $services
     * @param  array<int, array>   $tableRows  (by reference)
     */
    private function processCollection(
        \Illuminate\Support\Collection $rows,
        string $type,
        array $services,
        HazardLookupService $svc,
        bool $force,
        bool $dryRun,
        array &$tableRows
    ): void {
        foreach ($rows as $row) {
            $lat = (float) $row->latitude;
            $lng = (float) $row->longitude;

            $colResults = [];    // service => result array
            $statusParts = [];
            $anyChange   = false;

            foreach ($services as $service) {
                $col = "{$service}_susceptibility";

                // Skip if already filled and --force not set
                if (! $force && ! empty($row->{$col})) {
                    $colResults[$service] = ['status' => 'skipped', 'class' => $row->{$col}, 'raw' => null];
                    continue;
                }

                // Cache key: service + rounded coords (6 decimal places ≈ 0.1 m)
                $cacheKey = "{$service}:" . round($lat, 6) . ':' . round($lng, 6);

                if (! isset($this->cache[$cacheKey])) {
                    usleep(300000); // 300 ms between real network calls
                    $this->cache[$cacheKey] = $svc->lookup($lat, $lng, $service);
                }

                $result = $this->cache[$cacheKey];
                $colResults[$service] = $result;

                if ($result['status'] === 'ok') {
                    if (! $dryRun) {
                        $row->{$col} = $result['class'];
                        $anyChange   = true;
                    }
                    $statusParts[] = "{$service}=ok";
                } elseif ($result['status'] === 'no_data') {
                    $statusParts[] = "{$service}=no_data";
                } else {
                    $statusParts[] = "{$service}=error";
                }
            }

            if ($anyChange && ! $dryRun) {
                $row->hazard_source     = 'MGB via GeoRisk WMS';
                $row->hazard_checked_at = Carbon::now();
                $row->save();
            }

            $tableRows[] = [
                'type'      => $type,
                'name'      => $row->name ?? '(no name)',
                'lat'       => round($lat, 6),
                'lng'       => round($lng, 6),
                'flood'     => $colResults['flood']['class']     ?? ($colResults['flood']['status']     ?? '—'),
                'landslide' => $colResults['landslide']['class'] ?? ($colResults['landslide']['status'] ?? '—'),
                'status'    => implode(', ', $statusParts) ?: 'skipped',
            ];
        }
    }
}
