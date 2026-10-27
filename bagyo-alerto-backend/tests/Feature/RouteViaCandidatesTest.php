<?php

namespace Tests\Feature;

use App\Services\HazardGridService;
use Tests\TestCase;

class RouteViaCandidatesTest extends TestCase
{
    protected function tearDown(): void
    {
        HazardGridService::reset();
        parent::tearDown();
    }

    private function setSyntheticGrid(): void
    {
        $gridService = app(HazardGridService::class);
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

        // Row 2: col 0 has high flood (3)
        $flood = pack('C*',
            0, 0, 1, 1,
            0, 2, 2, 1,
            3, 3, 2, 0,
            4, 4, 0, 0
        );

        $landslide = pack('C*',
            0, 1, 1, 0,
            0, 0, 2, 2,
            0, 1, 3, 3,
            0, 0, 0, 4
        );

        $gridService->setFixtureGrid($meta, $flood, $landslide);
    }

    public function test_missing_grid_returns_503(): void
    {
        HazardGridService::reset();

        $mock = $this->createMock(HazardGridService::class);
        $mock->method('isGridAvailable')->willReturn(false);
        $this->app->instance(HazardGridService::class, $mock);

        $response = $this->postJson('/api/route-via-candidates', [
            'coordinates' => [[9.718, 125.405], [9.712, 125.405]],
            'mode'        => 'foot',
        ]);

        $response->assertStatus(503)
            ->assertJsonStructure(['message']);
    }

    public function test_validation_requires_coordinates(): void
    {
        $this->setSyntheticGrid();

        $response = $this->postJson('/api/route-via-candidates', []);
        $response->assertStatus(422)
            ->assertJsonValidationErrors(['coordinates']);

        $responseEmpty = $this->postJson('/api/route-via-candidates', ['coordinates' => []]);
        $responseEmpty->assertStatus(422)
            ->assertJsonValidationErrors(['coordinates']);
    }

    public function test_validation_rejects_invalid_coordinates(): void
    {
        $this->setSyntheticGrid();

        // Single coord
        $response = $this->postJson('/api/route-via-candidates', [
            'coordinates' => [[9.71, 125.41]],
        ]);
        $response->assertStatus(422)
            ->assertJsonValidationErrors(['coordinates']);

        // Invalid lat
        $response = $this->postJson('/api/route-via-candidates', [
            'coordinates' => [[100.0, 125.41], [9.72, 125.42]],
        ]);
        $response->assertStatus(422)
            ->assertJsonValidationErrors(['coordinates.0.0']);
    }

    public function test_validation_rejects_invalid_mode(): void
    {
        $this->setSyntheticGrid();

        $response = $this->postJson('/api/route-via-candidates', [
            'coordinates' => [[9.718, 125.405], [9.712, 125.405]],
            'mode'        => 'airplane',
        ]);
        $response->assertStatus(422)
            ->assertJsonValidationErrors(['mode']);
    }

    public function test_endpoint_returns_expected_structure(): void
    {
        $this->setSyntheticGrid();

        $response = $this->postJson('/api/route-via-candidates', [
            'coordinates' => [[9.718, 125.405], [9.712, 125.405]],
            'mode'        => 'foot',
        ]);

        $response->assertStatus(200)
            ->assertJsonStructure([
                'via_points',
                'points',
            ]);

        $data = $response->json();
        $this->assertIsArray($data['via_points']);
        $this->assertLessThanOrEqual(3, count($data['via_points']));

        if (! empty($data['via_points'])) {
            $first = $data['via_points'][0];
            $this->assertIsNumeric($first[0]);
            $this->assertIsNumeric($first[1]);
        }
    }
}
