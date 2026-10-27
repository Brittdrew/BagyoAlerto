<?php

namespace Tests\Unit;

use App\Services\HazardGridService;
use Tests\TestCase;

class HazardGridServiceTest extends TestCase
{
    private HazardGridService $service;

    protected function setUp(): void
    {
        parent::setUp();
        HazardGridService::reset();
        $this->service = new HazardGridService();

        // 4x4 synthetic grid
        // Lat: 9.70 to 9.74 (span 0.04 deg, row 0 is 9.74, row 3 is 9.70)
        // Lng: 125.40 to 125.44 (span 0.04 deg, col 0 is 125.40, col 3 is 125.44)
        $meta = [
            'bbox' => [
                'min_lat' => 9.70,
                'max_lat' => 9.74,
                'min_lng' => 125.40,
                'max_lng' => 125.44,
            ],
            'width'        => 4,
            'height'       => 4,
            'cell_size_m'  => 25.0,
            'generated_at' => '2026-10-27T00:00:00Z',
            'source'       => 'Synthetic Test Fixture',
        ];

        // Flood 4x4:
        // [0, 0, 1, 1]
        // [0, 2, 2, 1]
        // [3, 3, 2, 0]
        // [4, 4, 0, 0]
        $flood = pack('C*',
            0, 0, 1, 1,
            0, 2, 2, 1,
            3, 3, 2, 0,
            4, 4, 0, 0
        );

        // Landslide 4x4:
        // [0, 1, 1, 0]
        // [0, 0, 2, 2]
        // [0, 1, 3, 3]
        // [0, 0, 0, 4]
        $landslide = pack('C*',
            0, 1, 1, 0,
            0, 0, 2, 2,
            0, 1, 3, 3,
            0, 0, 0, 4
        );

        $this->service->setFixtureGrid($meta, $flood, $landslide);
    }

    protected function tearDown(): void
    {
        HazardGridService::reset();
        parent::tearDown();
    }

    public function test_lookup_returns_expected_classes(): void
    {
        // row 0, col 0 (top-left: lat ~9.735, lng ~125.405)
        [$f, $l] = $this->service->lookup(9.735, 125.405);
        $this->assertSame(0, $f);
        $this->assertSame(0, $l);

        // row 0, col 2 (lat ~9.735, lng ~125.425) -> flood: 1, landslide: 1
        [$f, $l] = $this->service->lookup(9.735, 125.425);
        $this->assertSame(1, $f);
        $this->assertSame(1, $l);

        // row 2, col 0 (lat ~9.715, lng ~125.405) -> flood: 3, landslide: 0
        [$f, $l] = $this->service->lookup(9.715, 125.405);
        $this->assertSame(3, $f);
        $this->assertSame(0, $l);

        // row 3, col 0 (bottom-left: lat ~9.705, lng ~125.405) -> flood: 4, landslide: 0
        [$f, $l] = $this->service->lookup(9.705, 125.405);
        $this->assertSame(4, $f);
        $this->assertSame(0, $l);

        // row 3, col 3 (bottom-right: lat ~9.705, lng ~125.435) -> flood: 0, landslide: 4
        [$f, $l] = $this->service->lookup(9.705, 125.435);
        $this->assertSame(0, $f);
        $this->assertSame(4, $l);
    }

    public function test_lookup_returns_zero_outside_bbox(): void
    {
        // North of max_lat
        $res = $this->service->lookup(9.75, 125.42);
        $this->assertSame(0, $res[0]);
        $this->assertSame(0, $res[1]);

        // South of min_lat
        $res = $this->service->lookup(9.65, 125.42);
        $this->assertSame(0, $res[0]);
        $this->assertSame(0, $res[1]);

        // West of min_lng
        $res = $this->service->lookup(9.72, 125.35);
        $this->assertSame(0, $res[0]);
        $this->assertSame(0, $res[1]);

        // East of max_lng
        $res = $this->service->lookup(9.72, 125.50);
        $this->assertSame(0, $res[0]);
        $this->assertSame(0, $res[1]);
    }

    public function test_score_route_calculates_length_and_exposure(): void
    {
        // Route from row 0, col 0 (safe) to row 3, col 0 (very_high flood)
        $coords = [
            [9.735, 125.405], // row 0: flood 0, landslide 0 -> worst 0
            [9.725, 125.405], // row 1: flood 0, landslide 0 -> worst 0
            [9.715, 125.405], // row 2: flood 3, landslide 0 -> worst 3
            [9.705, 125.405], // row 3: flood 4, landslide 0 -> worst 4
        ];

        $result = $this->service->scoreRoute($coords);

        $this->assertArrayHasKey('length_m', $result);
        $this->assertArrayHasKey('exposure_index', $result);
        $this->assertArrayHasKey('meters_by_class', $result);
        $this->assertArrayHasKey('segments', $result);

        $this->assertGreaterThan(0, $result['length_m']);
        // Exposure index should be > 0 because row 2 is high (weight 3) and row 3 is very_high (weight 5)
        $this->assertGreaterThan(0, $result['exposure_index']);

        // Check meters by class has only string keys
        $this->assertArrayNotHasKey(0, $result['meters_by_class']['worst']);
        $this->assertArrayHasKey('none', $result['meters_by_class']['worst']);
        $this->assertArrayHasKey('low', $result['meters_by_class']['worst']);
        $this->assertArrayHasKey('moderate', $result['meters_by_class']['worst']);
        $this->assertArrayHasKey('high', $result['meters_by_class']['worst']);
        $this->assertArrayHasKey('very_high', $result['meters_by_class']['worst']);
        $this->assertGreaterThan(0, $result['meters_by_class']['worst']['high']);
        $this->assertGreaterThan(0, $result['meters_by_class']['worst']['very_high']);

        // Segments should index the original submitted coordinates (0 to 3)
        $this->assertNotEmpty($result['segments']);
        $this->assertSame(0, $result['segments'][0][0]); // first startVertexIdx is 0
        $lastSeg = end($result['segments']);
        $this->assertSame(3, $lastSeg[1]); // last endVertexIdx is 3 (original coords count - 1)
    }

    public function test_score_route_outside_bbox_has_zero_exposure(): void
    {
        $coords = [
            [9.80, 125.50],
            [9.81, 125.51],
        ];

        $result = $this->service->scoreRoute($coords);

        $this->assertGreaterThan(0, $result['length_m']);
        $this->assertEquals(0, $result['exposure_index']);
        $this->assertEquals($result['length_m'], $result['meters_by_class']['worst']['none']);
        $this->assertSame(0, $result['segments'][0][2]);
    }

    public function test_score_route_empty_or_single_coord(): void
    {
        $empty = $this->service->scoreRoute([]);
        $this->assertEquals(0.0, $empty['length_m']);
        $this->assertEquals(0.0, $empty['exposure_index']);

        $single = $this->service->scoreRoute([[9.72, 125.42]]);
        $this->assertEquals(0.0, $single['length_m']);
        $this->assertEquals(0.0, $single['exposure_index']);
    }
}
