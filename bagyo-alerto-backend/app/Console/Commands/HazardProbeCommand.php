<?php

namespace App\Console\Commands;

use App\Services\HazardLookupService;
use Illuminate\Console\Command;

class HazardProbeCommand extends Command
{
    protected $signature = 'hazard:probe
                            {lat : Latitude in decimal degrees}
                            {lng : Longitude in decimal degrees}
                            {--radius=100 : Maximum probe radius in meters}';

    protected $description = 'Probe GeoRisk MGB WMS hazard susceptibility around a coordinate';

    public function handle(HazardLookupService $svc): int
    {
        $lat = (float) $this->argument('lat');
        $lng = (float) $this->argument('lng');
        $radius = (float) $this->option('radius');

        if ($radius < 0) {
            $radius = 100.0;
        }

        // Standard step distances up to --radius
        $baseSteps = [25, 50, 100];
        $steps = array_values(array_filter($baseSteps, fn($d) => $d <= $radius));
        if ($radius > 100 && !in_array((int) $radius, $steps, true)) {
            $steps[] = (int) $radius;
        }

        $directions = [
            'N' => 0.0,
            'S' => 180.0,
            'E' => 90.0,
            'W' => 270.0,
        ];

        // 1. Center / exact point
        $points = [
            [
                'offset'    => 0,
                'direction' => 'exact',
                'lat'       => $lat,
                'lng'       => $lng,
            ],
        ];

        // 2. Offsets at 25, 50, 100 m in N, S, E, W directions
        foreach ($steps as $dist) {
            foreach ($directions as $dir => $bearing) {
                [$pLat, $pLng] = $this->destinationPoint($lat, $lng, (float) $dist, $bearing);
                $points[] = [
                    'offset'    => $dist,
                    'direction' => $dir,
                    'lat'       => $pLat,
                    'lng'       => $pLng,
                ];
            }
        }

        $tableRows = [];
        $floodResults = [];
        $landslideResults = [];

        foreach ($points as $p) {
            if (! app()->runningUnitTests()) {
                usleep(150000); // 150 ms between network requests to be courteous to GeoRisk ArcGIS
            }

            $floodRes = $svc->lookup($p['lat'], $p['lng'], 'flood');

            if (! app()->runningUnitTests()) {
                usleep(150000);
            }

            $landslideRes = $svc->lookup($p['lat'], $p['lng'], 'landslide');

            $floodResults[] = $floodRes;
            $landslideResults[] = $landslideRes;

            $tableRows[] = [
                'offset'    => "{$p['offset']}m",
                'direction' => $p['direction'],
                'lat'       => number_format($p['lat'], 6, '.', ''),
                'lng'       => number_format($p['lng'], 6, '.', ''),
                'flood'     => $this->formatCell($floodRes),
                'landslide' => $this->formatCell($landslideRes),
            ];
        }

        $this->table(
            ['Offset', 'Direction', 'Lat', 'Lng', 'Flood Class', 'Landslide Class'],
            $tableRows
        );

        $floodVerdict = $this->computeVerdict($floodResults);
        $landslideVerdict = $this->computeVerdict($landslideResults);

        $this->newLine();
        $this->line("Flood: {$floodVerdict}");
        $this->line("Landslide: {$landslideVerdict}");

        return self::SUCCESS;
    }

    /**
     * Compute destination coordinate given start point, distance in meters, and bearing in degrees.
     *
     * @return array{0: float, 1: float} [lat, lng]
     */
    public function destinationPoint(float $lat, float $lng, float $distanceM, float $bearingDeg): array
    {
        $earthRadius = 6371000.0;
        $delta = $distanceM / $earthRadius;
        $theta = deg2rad($bearingDeg);

        $phi1 = deg2rad($lat);
        $lambda1 = deg2rad($lng);

        $phi2 = asin(sin($phi1) * cos($delta) + cos($phi1) * sin($delta) * cos($theta));
        $lambda2 = $lambda1 + atan2(
            sin($theta) * sin($delta) * cos($phi1),
            cos($delta) - sin($phi1) * sin($phi2)
        );

        return [
            rad2deg($phi2),
            fmod(rad2deg($lambda2) + 540.0, 360.0) - 180.0,
        ];
    }

    /**
     * Format a lookup result for table cell display.
     * Distinguishes: class returned, "no feature", and "request failed/timeout".
     *
     * @param  array{status: string, class: string|null, raw: string|null}  $res
     */
    public function formatCell(array $res): string
    {
        if ($res['status'] === 'ok' && ! empty($res['class'])) {
            return $res['class'];
        }

        if ($res['status'] === 'no_data') {
            return 'no feature';
        }

        return 'request failed/timeout';
    }

    /**
     * Compute summary verdict for a hazard layer.
     * Returns one of:
     * - "all points no feature"
     * - "same class everywhere"
     * - "class varies nearby (list classes)"
     *
     * @param  array<int, array{status: string, class: string|null, raw: string|null}>  $results
     */
    public function computeVerdict(array $results): string
    {
        $classes = [];
        $noFeatureCount = 0;
        $errorCount = 0;
        $okCount = 0;

        foreach ($results as $res) {
            if ($res['status'] === 'ok' && ! empty($res['class'])) {
                $okCount++;
                $classes[$res['class']] = true;
            } elseif ($res['status'] === 'no_data') {
                $noFeatureCount++;
            } elseif ($res['status'] === 'error') {
                $errorCount++;
            }
        }

        $total = count($results);
        if ($total === 0) {
            return 'no points queried';
        }

        if ($errorCount === $total) {
            return 'request failed/timeout';
        }

        if ($noFeatureCount === $total) {
            return 'all points no feature';
        }

        $uniqueClasses = array_keys($classes);
        sort($uniqueClasses);

        if ($okCount === $total && count($uniqueClasses) === 1) {
            return 'same class everywhere';
        }

        // Classes vary nearby
        $classList = $uniqueClasses;
        if ($noFeatureCount > 0) {
            $classList[] = 'no feature';
        }
        if ($errorCount > 0) {
            $classList[] = 'request failed';
        }

        return 'class varies nearby (' . implode(', ', $classList) . ')';
    }
}
