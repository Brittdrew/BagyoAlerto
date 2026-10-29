<?php

namespace Tests\Unit;

use App\Services\TyphoonMLService;
use Tests\TestCase;
use ReflectionClass;

class TyphoonMLServiceTest extends TestCase
{
    private TyphoonMLService $service;
    private array $trainingData;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = new TyphoonMLService();

        $ref = new ReflectionClass(TyphoonMLService::class);
        $method = $ref->getMethod('trainingData');
        $method->setAccessible(true);
        $this->trainingData = $method->invoke($this->service);
    }

    public function test_training_data_features_and_labels_count_match(): void
    {
        $features = [];
        $labels = [];

        foreach ($this->trainingData as $row) {
            $this->assertCount(6, $row, 'Each training row must have 5 features + 1 label');
            $features[] = array_slice($row, 0, 5);
            $labels[]   = $row[5];
        }

        $this->assertSame(count($features), count($labels));
        $this->assertNotEmpty($features);
    }

    public function test_every_label_is_a_key_in_signal_rank(): void
    {
        $validRanks = TyphoonMLService::SIGNAL_RANK;

        foreach ($this->trainingData as $row) {
            $label = $row[5];
            $this->assertArrayHasKey(
                $label,
                $validRanks,
                "Label '{$label}' must be a valid key in SIGNAL_RANK"
            );
        }
    }

    public function test_every_non_elevated_row_matches_its_wind_bracket(): void
    {
        $thresholds = TyphoonMLService::SIGNAL_THRESHOLDS;

        foreach ($this->trainingData as $row) {
            $wind = $row[0];
            $rain = $row[1];
            $label = $row[5];

            if ($label === 'Elevated') {
                $this->assertLessThan(39, $wind, "Elevated row must have wind < 39 km/h (got {$wind})");
                $this->assertGreaterThanOrEqual(7.5, $rain, "Elevated row must have rainfall >= 7.5 mm/hr (got {$rain})");
                $this->assertLessThan(30.0, $rain, "Elevated row must have rainfall < 30 mm/hr (got {$rain})");
                continue;
            }

            $this->assertArrayHasKey($label, $thresholds, "Thresholds must define range for {$label}");
            [$minWind, $maxWind] = $thresholds[$label];

            $this->assertGreaterThanOrEqual(
                $minWind,
                $wind,
                "Row labeled '{$label}' with wind {$wind} km/h is below bracket min {$minWind} km/h"
            );
            $this->assertLessThanOrEqual(
                $maxWind,
                $wind,
                "Row labeled '{$label}' with wind {$wind} km/h exceeds bracket max {$maxWind} km/h"
            );
        }
    }

    public function test_predict_returns_valid_label_for_calm_input(): void
    {
        // Calm weather: wind 10 km/h, 0 rain, 1013 hPa, 30°C, 70% humidity
        $result = $this->service->predict(10.0, 0.0, 1013.0, 30.0, 70.0);

        $this->assertArrayHasKey($result, TyphoonMLService::SIGNAL_RANK);
        $this->assertSame('Normal', $result);
    }

    public function test_predict_for_wind_92_rain_80_returns_at_least_signal_3(): void
    {
        // Severe test case from requirements: wind 92, rain 80, pressure 1013.1
        $result = $this->service->predict(92.0, 80.0, 1013.1, 28.0, 85.0);

        $this->assertArrayHasKey($result, TyphoonMLService::SIGNAL_RANK);
        $actualRank = TyphoonMLService::SIGNAL_RANK[$result];
        $minRank = TyphoonMLService::SIGNAL_RANK['Signal 3'];

        $this->assertGreaterThanOrEqual(
            $minRank,
            $actualRank,
            "Expected at least Signal 3 for wind 92, rain 80, pressure 1013.1, got '{$result}'"
        );
    }
}
