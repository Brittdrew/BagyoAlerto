<?php

namespace Tests\Feature;

use App\Services\HazardGridService;
use Tests\TestCase;

class RouteHazardScoreTest extends TestCase
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
            'width'        => 2,
            'height'       => 2,
            'cell_size_m'  => 25.0,
            'generated_at' => '2026-10-27T00:00:00Z',
            'source'       => 'Synthetic Test Fixture',
        ];

        $flood = pack('C*', 0, 1, 2, 3);
        $landslide = pack('C*', 0, 0, 1, 4);

        $gridService->setFixtureGrid($meta, $flood, $landslide);
    }

    public function test_missing_grid_returns_503(): void
    {
        HazardGridService::reset();

        // Bind mock service where isGridAvailable() returns false
        $mock = $this->createMock(HazardGridService::class);
        $mock->method('isGridAvailable')->willReturn(false);
        $this->app->instance(HazardGridService::class, $mock);

        $response = $this->postJson('/api/route-hazard-score', [
            'routes' => [
                [
                    'id'          => 'r1',
                    'coordinates' => [[9.71, 125.41], [9.72, 125.42]],
                ],
            ],
        ]);

        $response->assertStatus(503)
            ->assertJsonStructure(['message']);
    }

    public function test_validation_requires_routes_array(): void
    {
        $this->setSyntheticGrid();

        $response = $this->postJson('/api/route-hazard-score', []);
        $response->assertStatus(422)
            ->assertJsonValidationErrors(['routes']);

        $responseEmpty = $this->postJson('/api/route-hazard-score', ['routes' => []]);
        $responseEmpty->assertStatus(422)
            ->assertJsonValidationErrors(['routes']);
    }

    public function test_validation_enforces_max_routes_limit(): void
    {
        $this->setSyntheticGrid();

        $routes = [];
        for ($i = 1; $i <= 6; $i++) {
            $routes[] = [
                'id'          => "route_{$i}",
                'coordinates' => [[9.71, 125.41], [9.72, 125.42]],
            ];
        }

        $response = $this->postJson('/api/route-hazard-score', ['routes' => $routes]);
        $response->assertStatus(422)
            ->assertJsonValidationErrors(['routes']);
    }

    public function test_validation_enforces_coordinates_count_limits(): void
    {
        $this->setSyntheticGrid();

        // Less than 2 coordinates
        $response = $this->postJson('/api/route-hazard-score', [
            'routes' => [
                [
                    'id'          => 'r1',
                    'coordinates' => [[9.71, 125.41]],
                ],
            ],
        ]);
        $response->assertStatus(422)
            ->assertJsonValidationErrors(['routes.0.coordinates']);
    }

    public function test_validation_rejects_invalid_coordinate_format(): void
    {
        $this->setSyntheticGrid();

        $response = $this->postJson('/api/route-hazard-score', [
            'routes' => [
                [
                    'id'          => 'r1',
                    'coordinates' => [
                        [9.71, 125.41],
                        [199.0, 125.42], // invalid latitude > 90
                    ],
                ],
            ],
        ]);
        $response->assertStatus(422)
            ->assertJsonValidationErrors(['routes.0.coordinates.1.0']);
    }

    public function test_scoring_returns_expected_response_shape(): void
    {
        $this->setSyntheticGrid();

        $payload = [
            'routes' => [
                [
                    'id'          => 'route_fastest',
                    'coordinates' => [
                        [9.71, 125.41],
                        [9.72, 125.42],
                        [9.73, 125.43],
                    ],
                ],
                [
                    'id'          => 'route_safest',
                    'coordinates' => [
                        [9.705, 125.405],
                        [9.715, 125.415],
                    ],
                ],
            ],
        ];

        $response = $this->postJson('/api/route-hazard-score', $payload);

        $response->assertStatus(200)
            ->assertJsonStructure([
                'routes' => [
                    '*' => [
                        'id',
                        'length_m',
                        'exposure_index',
                        'meters_by_class' => [
                            'flood',
                            'landslide',
                            'worst',
                        ],
                        'segments',
                    ],
                ],
            ]);

        $data = $response->json('routes');
        $this->assertCount(2, $data);
        $this->assertSame('route_fastest', $data[0]['id']);
        $this->assertIsNumeric($data[0]['length_m']);
        $this->assertIsNumeric($data[0]['exposure_index']);
        $this->assertIsArray($data[0]['segments']);
    }
}
