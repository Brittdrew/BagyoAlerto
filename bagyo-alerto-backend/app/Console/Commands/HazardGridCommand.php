<?php

namespace App\Console\Commands;

use App\Models\Barangay;
use App\Models\EvacuationCenter;
use Illuminate\Console\Command;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Http;

class HazardGridCommand extends Command
{
    protected $signature = 'hazard:grid
                            {--chunk-limit= : Maximum pixels per chunk side (default: 1000)}
                            {--tolerance= : Color distance tolerance (default from config: 80)}';

    protected $description = 'Precompute a binary hazard grid from GeoRisk MGB WMS and validate against stored barangay/center classes';

    private const EARTH_RADIUS = 6371000.0;
    private const DEG_LAT_METERS = 110574.0;

    public function handle(): int
    {
        $this->info('Starting Precomputed Hazard Grid generation...');
        $startTime = microtime(true);

        $chunkLimit = (int) ($this->option('chunk-limit') ?: config('hazard.grid.chunk_limit', 1000));
        $tolerance = (int) ($this->option('tolerance') ?: config('hazard.grid.tolerance', 80));
        $cellSizeM = (float) config('hazard.grid.cell_size_m', 25.0);
        $marginM = (float) config('hazard.grid.margin_m', 5000.0);

        $storagePath = config('hazard.grid.storage_path', storage_path('app/hazard-grid'));
        $debugPath = config('hazard.grid.debug_path', storage_path('app/hazard-debug'));

        File::ensureDirectoryExists($storagePath);
        File::ensureDirectoryExists($debugPath);

        // 1. Compute bounding box
        $barangays = Barangay::whereNotNull('latitude')->whereNotNull('longitude')->get();
        $centers = EvacuationCenter::whereNotNull('latitude')->whereNotNull('longitude')->get();

        if ($barangays->isEmpty() && $centers->isEmpty()) {
            $this->error('No barangays or evacuation centers with coordinates found in database.');
            return self::FAILURE;
        }

        $allLats = $barangays->pluck('latitude')->concat($centers->pluck('latitude'))->map(fn($v) => (float) $v);
        $allLngs = $barangays->pluck('longitude')->concat($centers->pluck('longitude'))->map(fn($v) => (float) $v);

        $rawMinLat = $allLats->min();
        $rawMaxLat = $allLats->max();
        $rawMinLng = $allLngs->min();
        $rawMaxLng = $allLngs->max();

        $meanLat = ($rawMinLat + $rawMaxLat) / 2.0;
        $degLngMeters = 111320.0 * cos(deg2rad($meanLat));

        $marginLat = $marginM / self::DEG_LAT_METERS;
        $marginLng = $marginM / $degLngMeters;

        $minLat = $rawMinLat - $marginLat;
        $maxLat = $rawMaxLat + $marginLat;
        $minLng = $rawMinLng - $marginLng;
        $maxLng = $rawMaxLng + $marginLng;

        $latSpan = $maxLat - $minLat;
        $lngSpan = $maxLng - $minLng;

        $heightMeters = $latSpan * self::DEG_LAT_METERS;
        $widthMeters = $lngSpan * $degLngMeters;

        $width = (int) round($widthMeters / $cellSizeM);
        $height = (int) round($heightMeters / $cellSizeM);

        $this->info("Bounding Box: Lat [{$minLat}, {$maxLat}], Lng [{$minLng}, {$maxLng}]");
        $this->info("Grid Dimensions: {$width} x {$height} pixels (~{$cellSizeM} m/cell)");

        $baseUrl = rtrim((string) config('hazard.base_url', 'https://ulap-hazards.georisk.gov.ph/arcgis/services/MGBPublic'), '/');
        $services = config('hazard.services', []);
        $colorConfig = config('hazard.colors', []);

        $binaryGrids = [];

        foreach ($services as $serviceKey => $svcConfig) {
            $this->line('');
            $this->info("Processing {$serviceKey} hazard layer...");

            // Fetch composite WMS image (chunked if width or height > chunkLimit)
            $canvas = imagecreatetruecolor($width, $height);
            imagealphablending($canvas, false);
            imagesavealpha($canvas, true);
            $transparent = imagecolorallocatealpha($canvas, 0, 0, 0, 127);
            imagefilledrectangle($canvas, 0, 0, $width, $height, $transparent);

            $numChunksX = (int) ceil($width / $chunkLimit);
            $numChunksY = (int) ceil($height / $chunkLimit);

            $this->line("Fetching WMS GetMap tiles ({$numChunksX}x{$numChunksY} chunks, chunk size <= {$chunkLimit}px)...");

            for ($cy = 0; $cy < $numChunksY; $cy++) {
                for ($cx = 0; $cx < $numChunksX; $cx++) {
                    $x0 = $cx * $chunkLimit;
                    $y0 = $cy * $chunkLimit;
                    $cw = min($chunkLimit, $width - $x0);
                    $ch = min($chunkLimit, $height - $y0);

                    $chunkMinLng = $minLng + ($x0 / $width) * $lngSpan;
                    $chunkMaxLng = $minLng + (($x0 + $cw) / $width) * $lngSpan;
                    $chunkMaxLat = $maxLat - ($y0 / $height) * $latSpan;
                    $chunkMinLat = $maxLat - (($y0 + $ch) / $height) * $latSpan;

                    $wmsUrl = "{$baseUrl}/{$svcConfig['path']}/MapServer/WMSServer";
                    $params = [
                        'service'     => 'WMS',
                        'version'     => '1.3.0',
                        'request'     => 'GetMap',
                        'layers'      => $svcConfig['layer'],
                        'styles'      => '',
                        'crs'         => 'CRS:84',
                        'bbox'        => "{$chunkMinLng},{$chunkMinLat},{$chunkMaxLng},{$chunkMaxLat}",
                        'width'       => $cw,
                        'height'      => $ch,
                        'format'      => 'image/png',
                        'transparent' => 'TRUE',
                    ];

                    $res = Http::withoutVerifying()
                        ->connectTimeout(30)
                        ->timeout(120)
                        ->retry(3, 1000)
                        ->get($wmsUrl, $params);

                    if (! $res->successful() || ! str_contains($res->header('Content-Type', ''), 'image')) {
                        $this->error("Failed to fetch chunk ({$cx},{$cy}) for {$serviceKey}: HTTP {$res->status()}");
                        return self::FAILURE;
                    }

                    $chunkImg = imagecreatefromstring($res->body());
                    if (! $chunkImg) {
                        $this->error("Failed to decode chunk image ({$cx},{$cy}) for {$serviceKey}");
                        return self::FAILURE;
                    }

                    imagecopy($canvas, $chunkImg, $x0, $y0, 0, 0, $cw, $ch);
                    imagedestroy($chunkImg);
                }
            }

            // Save sample debug image
            $samplePath = "{$debugPath}/{$serviceKey}_sample.png";
            imagepng($canvas, $samplePath);
            $this->info("Saved sample image to: [{$samplePath}]");

            // Analyze distinct colors
            $colorCounts = [];
            for ($y = 0; $y < $height; $y++) {
                for ($x = 0; $x < $width; $x++) {
                    $rgba = imagecolorat($canvas, $x, $y);
                    $alpha = ($rgba & 0x7F000000) >> 24;
                    if ($alpha > 100) {
                        continue;
                    }
                    $r = ($rgba >> 16) & 0xFF;
                    $g = ($rgba >> 8) & 0xFF;
                    $b = $rgba & 0xFF;
                    $hex = sprintf('#%02x%02x%02x', $r, $g, $b);
                    $colorCounts[$hex] = ($colorCounts[$hex] ?? 0) + 1;
                }
            }

            arsort($colorCounts);
            $this->line("Distinct non-transparent colors found for {$serviceKey}: " . count($colorCounts));
            $this->table(
                ['Hex', 'Pixels', '% of Colored'],
                collect($colorCounts)->take(10)->map(function ($count, $hex) use ($colorCounts) {
                    $total = array_sum($colorCounts);
                    $pct = $total > 0 ? round(($count / $total) * 100, 2) . '%' : '0%';
                    return [$hex, number_format($count), $pct];
                })->toArray()
            );

            // Classify each pixel
            $legendTable = $colorConfig[$serviceKey] ?? [];
            $binaryBuffer = '';

            for ($y = 0; $y < $height; $y++) {
                for ($x = 0; $x < $width; $x++) {
                    $rgba = imagecolorat($canvas, $x, $y);
                    $alpha = ($rgba & 0x7F000000) >> 24;

                    $class = 0;
                    if ($alpha <= 90) {
                        $r = ($rgba >> 16) & 0xFF;
                        $g = ($rgba >> 8) & 0xFF;
                        $b = $rgba & 0xFF;

                        $minDist = INF;
                        $bestClass = 0;

                        foreach ($legendTable as $clsNum => $def) {
                            $dist = sqrt(pow($r - $def['r'], 2) + pow($g - $def['g'], 2) + pow($b - $def['b'], 2));
                            if ($dist < $minDist) {
                                $minDist = $dist;
                                $bestClass = $clsNum;
                            }
                        }

                        if ($minDist <= $tolerance) {
                            $class = $bestClass;
                        }
                    }

                    $binaryBuffer .= chr($class);
                }
            }

            imagedestroy($canvas);

            $binPath = "{$storagePath}/{$serviceKey}.bin";
            file_put_contents($binPath, $binaryBuffer);
            $binSizeKb = round(filesize($binPath) / 1024, 1);
            $this->info("Saved binary grid: [{$binPath}] ({$binSizeKb} KB)");

            $binaryGrids[$serviceKey] = $binaryBuffer;
        }

        // 2. Save metadata JSON
        $meta = [
            'bbox' => [
                'min_lat' => round($minLat, 8),
                'min_lng' => round($minLng, 8),
                'max_lat' => round($maxLat, 8),
                'max_lng' => round($maxLng, 8),
            ],
            'width'        => $width,
            'height'       => $height,
            'cell_size_m'  => $cellSizeM,
            'generated_at' => Carbon::now()->toIso8601String(),
            'source'       => 'GeoRisk MGB Public WMS (Flood, RainInducedLandslide)',
        ];

        $metaPath = "{$storagePath}/meta.json";
        file_put_contents($metaPath, json_encode($meta, JSON_PRETTY_PRINT));
        $this->info("Saved metadata: [{$metaPath}]");

        // 3. Validation against DB
        $this->line('');
        $this->info('Validating grid against stored barangays and evacuation centers...');

        $classValues = config('hazard.class_values', [
            'none' => 0, 'low' => 1, 'moderate' => 2, 'high' => 3, 'very_high' => 4,
        ]);
        $classNames = config('hazard.classes', [
            0 => 'none', 1 => 'low', 2 => 'moderate', 3 => 'high', 4 => 'very_high',
        ]);

        $activeCenters = EvacuationCenter::whereNotNull('latitude')
            ->whereNotNull('longitude')
            ->where('is_active', true)
            ->get();

        $validationEntities = $barangays->map(fn($b) => ['type' => 'Barangay', 'model' => $b])
            ->concat($activeCenters->map(fn($c) => ['type' => 'Center', 'model' => $c]));

        foreach (['flood', 'landslide'] as $svc) {
            $gridData = $binaryGrids[$svc] ?? '';
            $matches = 0;
            $total = 0;
            $mismatches = [];

            foreach ($validationEntities as $item) {
                $m = $item['model'];
                $dbVal = $m->{"{$svc}_susceptibility"};
                $expectedClass = ! empty($dbVal) ? ($classValues[$dbVal] ?? 0) : 0;
                $expectedName = ! empty($dbVal) ? $dbVal : 'none';

                $lat = (float) $m->latitude;
                $lng = (float) $m->longitude;

                $col = (int) floor((($lng - $minLng) / $lngSpan) * $width);
                $row = (int) floor((($maxLat - $lat) / $latSpan) * $height);
                $col = max(0, min($width - 1, $col));
                $row = max(0, min($height - 1, $row));
                $offset = ($row * $width) + $col;

                $gridClass = isset($gridData[$offset]) ? ord($gridData[$offset]) : 0;
                $gridName = $classNames[$gridClass] ?? 'unknown';

                $isMatch = ($expectedClass === $gridClass);
                if ($isMatch) {
                    $matches++;
                } else {
                    $mismatches[] = [
                        $item['type'],
                        $m->name,
                        round($lat, 5) . ', ' . round($lng, 5),
                        $expectedName,
                        $gridName,
                    ];
                }
                $total++;
            }

            $rate = $total > 0 ? round(($matches / $total) * 100, 1) : 0;
            $this->info("Validation for {$svc}: {$matches}/{$total} matched ({$rate}%)");

            if (! empty($mismatches)) {
                $this->warn("Mismatches for {$svc} (" . count($mismatches) . "):");
                $this->table(['Type', 'Name', 'Coordinates', 'DB Stored', 'Grid Class'], $mismatches);
            }
        }

        $duration = round(microtime(true) - $startTime, 2);
        $this->info("Hazard grid precomputation finished in {$duration} seconds.");

        return self::SUCCESS;
    }
}
