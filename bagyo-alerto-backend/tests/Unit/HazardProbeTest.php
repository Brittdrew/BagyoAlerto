<?php

namespace Tests\Unit;

use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class HazardProbeTest extends TestCase
{
    private function floodFeature(string $label): array
    {
        return [
            'type'     => 'FeatureCollection',
            'features' => [[
                'type'       => 'Feature',
                'geometry'   => null,
                'properties' => ['Flood Susceptibility' => $label],
                'layerName'  => 'Flood',
            ]],
        ];
    }

    private function landslideFeature(string $label): array
    {
        return [
            'type'     => 'FeatureCollection',
            'features' => [[
                'type'       => 'Feature',
                'geometry'   => null,
                'properties' => ['RIL Susceptibility' => $label],
                'layerName'  => 'Rainfall Induced Landslide',
            ]],
        ];
    }

    private function emptyFeatureCollection(): array
    {
        return ['type' => 'FeatureCollection', 'features' => []];
    }

    /**
     * Outcome 1: All points return "no feature" (empty GeoJSON features).
     */
    public function test_outcome_all_points_no_feature(): void
    {
        Http::fake(function () {
            return Http::response($this->emptyFeatureCollection(), 200);
        });

        $exitCode = Artisan::call('hazard:probe', [
            'lat'      => 9.785000,
            'lng'      => 125.490000,
            '--radius' => 25,
        ]);
        $output = Artisan::output();

        $this->assertSame(0, $exitCode);
        $this->assertStringContainsString('no feature', $output);
        $this->assertStringContainsString('Flood: all points no feature', $output);
        $this->assertStringContainsString('Landslide: all points no feature', $output);
    }

    /**
     * Outcome 2: All points return the exact same susceptibility class.
     */
    public function test_outcome_same_class_everywhere(): void
    {
        Http::fake(function ($request) {
            if (str_contains($request->url(), 'RainInducedLandslide')) {
                return Http::response($this->landslideFeature('Low Susceptibility'), 200);
            }
            return Http::response($this->floodFeature('High Susceptibility'), 200);
        });

        $exitCode = Artisan::call('hazard:probe', [
            'lat'      => 9.785000,
            'lng'      => 125.490000,
            '--radius' => 25,
        ]);
        $output = Artisan::output();

        $this->assertSame(0, $exitCode);
        $this->assertStringContainsString('high', $output);
        $this->assertStringContainsString('low', $output);
        $this->assertStringContainsString('Flood: same class everywhere', $output);
        $this->assertStringContainsString('Landslide: same class everywhere', $output);
    }

    /**
     * Outcome 3: Susceptibility class varies nearby across probed points.
     */
    public function test_outcome_class_varies_nearby(): void
    {
        $floodIndex = 0;
        $landslideIndex = 0;

        Http::fake(function ($request) use (&$floodIndex, &$landslideIndex) {
            if (str_contains($request->url(), 'RainInducedLandslide')) {
                $landslideIndex++;
                $label = ($landslideIndex <= 2) ? 'High Susceptibility' : 'Moderate Susceptibility';
                return Http::response($this->landslideFeature($label), 200);
            }

            $floodIndex++;
            $label = ($floodIndex <= 2) ? 'High Susceptibility' : 'Low Susceptibility';
            return Http::response($this->floodFeature($label), 200);
        });

        $exitCode = Artisan::call('hazard:probe', [
            'lat'      => 9.785000,
            'lng'      => 125.490000,
            '--radius' => 25,
        ]);
        $output = Artisan::output();

        $this->assertSame(0, $exitCode);
        $this->assertStringContainsString('Flood: class varies nearby (high, low)', $output);
        $this->assertStringContainsString('Landslide: class varies nearby (high, moderate)', $output);
    }

    /**
     * Test distinguishing request failure / timeout from "no feature".
     */
    public function test_distinguishes_request_failed_from_no_feature(): void
    {
        Http::fake(function ($request) {
            if (str_contains($request->url(), 'Flood')) {
                return Http::response([], 500);
            }
            return Http::response($this->emptyFeatureCollection(), 200);
        });

        $exitCode = Artisan::call('hazard:probe', [
            'lat'      => 9.785000,
            'lng'      => 125.490000,
            '--radius' => 25,
        ]);
        $output = Artisan::output();

        $this->assertSame(0, $exitCode);
        $this->assertStringContainsString('request failed/timeout', $output);
        $this->assertStringContainsString('no feature', $output);
        $this->assertStringContainsString('Flood: request failed/timeout', $output);
        $this->assertStringContainsString('Landslide: all points no feature', $output);
    }

    /**
     * Test --radius option limits points probed.
     */
    public function test_radius_option_limits_probed_points(): void
    {
        $requests = 0;
        Http::fake(function () use (&$requests) {
            $requests++;
            return Http::response($this->emptyFeatureCollection(), 200);
        });

        // --radius=50 queries exact point (1) + 25m (4) + 50m (4) = 9 points * 2 services = 18 requests
        $exitCode = Artisan::call('hazard:probe', [
            'lat'      => 9.785000,
            'lng'      => 125.490000,
            '--radius' => 50,
        ]);

        $this->assertSame(0, $exitCode);
        $this->assertSame(18, $requests);
    }
}
