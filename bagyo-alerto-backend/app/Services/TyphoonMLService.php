<?php

namespace App\Services;

use Phpml\Classification\Ensemble\RandomForest;

class TyphoonMLService
{
    public const FOREST_TREES = 25;

    private RandomForest $classifier;

    private string $modelPath;

    private string $metadataPath;

    private bool $classifierLoaded = false;

    public const SIGNAL_THRESHOLDS = [
        'Normal' => [0, 29],
        'Watch' => [30, 38],
        'Signal 1' => [39, 61],
        'Signal 2' => [62, 88],
        'Signal 3' => [89, 117],
        'Signal 4' => [118, 184],
        'Signal 5' => [185, PHP_INT_MAX],
    ];

    public const SIGNAL_RANK = [
        'Normal' => 0,
        'Watch' => 1,
        'Elevated' => 2,
        'Signal 1' => 3,
        'Signal 2' => 4,
        'Signal 3' => 5,
        'Signal 4' => 6,
        'Signal 5' => 7,
    ];

    public function __construct(
        private ?ModelStorage $modelStorage = null,
        private ?HistoricalTyphoonDataset $historicalDataset = null,
    ) {
        $this->modelPath = storage_path('app/typhoon_model.phpml');
        $this->metadataPath = storage_path('app/typhoon_model.meta.json');
        $this->modelStorage ??= new ModelStorage;
        $this->historicalDataset ??= new HistoricalTyphoonDataset;
        $this->classifier = new RandomForest(numClassifier: self::FOREST_TREES);
    }

    /**
     * Features, in order: wind speed, pressure danger, hourly rainfall,
     * humidity, and temperature. The input shape remains compatible with the
     * live assessment endpoint while the labels now come from real PAGASA
     * bulletins rather than hand-written threshold examples.
     */
    public function featureVector($wind, $rainfall, $pressure, $temp, $humidity): array
    {
        return [
            (float) $wind,
            max(0, 1013 - (float) $pressure),
            (float) $rainfall,
            (float) $humidity,
            (float) $temp,
        ];
    }

    /**
     * Preserve the deterministic wind safety floor. Historical data from one
     * city does not contain every possible extreme, so ML may raise a signal
     * but can never lower the official wind-threshold result.
     */
    public function windOverride(string $mlPrediction, float $wind, float $rainfall = 0, float $pressure = 1013): string
    {
        $windSignal = 'Normal';
        foreach (self::SIGNAL_THRESHOLDS as $signal => [$min, $max]) {
            if ($wind >= $min && $wind <= $max) {
                $windSignal = $signal;
                break;
            }
        }

        $mlRank = self::SIGNAL_RANK[$mlPrediction] ?? 0;
        $windRank = self::SIGNAL_RANK[$windSignal] ?? 0;

        return $mlRank >= $windRank ? $mlPrediction : $windSignal;
    }

    /** @return array<int, array<string, string>> */
    public function trainingRecords(): array
    {
        return $this->historicalDataset->records(deduplicateGrid: false);
    }

    /**
     * Compatibility shape used by existing tests and training code:
     * [wind, rainfall, pressure, temperature, humidity, PAGASA label].
     *
     * @return array<int, array{float, float, float, float, float, string}>
     */
    private function trainingData(): array
    {
        return array_map(
            fn (array $record): array => [
                (float) $record['wind_kmh'],
                (float) $record['rainfall_mm'],
                (float) $record['pressure_hpa'],
                (float) $record['temperature_c'],
                (float) $record['humidity_pct'],
                $record['label'],
            ],
            $this->trainingRecords(),
        );
    }

    public function train(): bool
    {
        $data = $this->trainingData();
        $samples = [];
        $labels = [];

        foreach ($data as $row) {
            $samples[] = $this->featureVector($row[0], $row[1], $row[2], $row[3], $row[4]);
            $labels[] = $row[5];
        }

        $this->classifier = new RandomForest(numClassifier: self::FOREST_TREES);
        $this->classifier->train($samples, $labels);

        $directory = dirname($this->modelPath);
        if (! is_dir($directory)) {
            mkdir($directory, 0755, true);
        }

        $this->modelStorage->saveToFile($this->classifier, $this->modelPath);
        file_put_contents($this->metadataPath, json_encode([
            'dataset_sha256' => $this->historicalDataset->fingerprint(),
            'sample_count' => count($samples),
            'events' => count(array_unique(array_column($this->trainingRecords(), 'event_id'))),
            'trained_at' => now()->utc()->toIso8601ZuluString(),
        ], JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR).PHP_EOL);

        $this->classifierLoaded = true;

        return true;
    }

    public function predict($wind, $rainfall, $pressure, $temp, $humidity): string
    {
        if (! $this->modelIsCurrent()) {
            $this->train();
        }

        if (! $this->classifierLoaded) {
            $restored = $this->modelStorage->restoreFromFile($this->modelPath);
            if (! $restored instanceof RandomForest) {
                throw new \RuntimeException('Stored typhoon model is not a RandomForest classifier.');
            }
            $this->classifier = $restored;
            $this->classifierLoaded = true;
        }

        $input = $this->featureVector($wind, $rainfall, $pressure, $temp, $humidity);
        $prediction = $this->classifier->predict([$input])[0];

        return $this->windOverride($prediction, (float) $wind, (float) $rainfall, (float) $pressure);
    }

    public function getConfidence($prediction): string
    {
        $confidence = [
            'Normal' => 'Low risk - no PAGASA wind signal matched in comparable history',
            'Watch' => 'Moderate concern - wind threshold reached',
            'Elevated' => 'Elevated risk - hazardous rain or pressure pattern',
            'Signal 1' => 'High risk - pattern resembles historical Signal 1 periods',
            'Signal 2' => 'Very high risk - pattern resembles historical Signal 2 periods',
            'Signal 3' => 'Extreme risk - pattern resembles historical Signal 3 periods',
            'Signal 4' => 'Catastrophic wind threshold - evacuate immediately',
            'Signal 5' => 'Super typhoon wind threshold - catastrophic danger',
        ];

        return $confidence[$prediction] ?? 'Unable to determine risk level';
    }

    private function modelIsCurrent(): bool
    {
        if (! is_file($this->modelPath) || ! is_file($this->metadataPath)) {
            return false;
        }

        try {
            $metadata = json_decode(file_get_contents($this->metadataPath), true, flags: JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return false;
        }

        return hash_equals(
            (string) ($metadata['dataset_sha256'] ?? ''),
            $this->historicalDataset->fingerprint(),
        );
    }
}
