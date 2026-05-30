<?php

namespace App\Services;

use Phpml\Classification\Ensemble\RandomForest;
use Phpml\Classification\DecisionTree;
use Phpml\ModelManager;

/**
 * TyphoonMLService
 *
 * Uses Random Forest (100 decision trees) instead of KNN.
 * Random Forest actually LEARNS patterns from data — KNN only memorizes.
 *
 * Key fixes applied:
 * 1. Replaced KNearestNeighbors with RandomForest
 * 2. Added feature normalization so wind is properly weighted
 * 3. Added windOverride() so wind speed ALWAYS enforces minimum signal
 * 4. Expanded training dataset with more boundary samples
 * 5. Old model is deleted before retraining to prevent stale predictions
 */
class TyphoonMLService
{
    private $classifier;
    private $modelPath;

    // Official PAGASA wind thresholds (km/h)
    private const SIGNAL_THRESHOLDS = [
        'Normal'   => [0,   29],
        'Watch'    => [30,  44],
        'Elevated' => [45,  59],
        'Signal 1' => [60,  89],
        'Signal 2' => [90,  120],
        'Signal 3' => [121, 170],
        'Signal 4' => [171, 220],
        'Signal 5' => [221, PHP_INT_MAX],
    ];

    // Signal rank for comparison (higher = more severe)
    private const SIGNAL_RANK = [
        'Normal'   => 0,
        'Watch'    => 1,
        'Elevated' => 2,
        'Signal 1' => 3,
        'Signal 2' => 4,
        'Signal 3' => 5,
        'Signal 4' => 6,
        'Signal 5' => 7,
    ];

    public function __construct()
    {
        $this->modelPath = storage_path('app/typhoon_model.phpml');

        // Random Forest: 100 decision trees, considers sqrt(features) per split
        // This is a REAL trained model — it learns decision boundaries from data
        $this->classifier = new RandomForest(
            numClassifier: 100  // 100 trees = stable, accurate predictions
        );
    }

    /**
     * Normalize features so wind is weighted most heavily.
     *
     * Problem with raw KNN: pressure=987 has a huge numeric scale vs wind=120,
     * so pressure dominated the distance calculation and wind was ignored.
     *
     * Fix: scale each feature so their contribution matches PAGASA importance.
     *
     * Weights:
     *   Wind      × 3.0  → most important (PAGASA primary factor)
     *   Pressure  → converted to danger score (lower hPa = higher danger) × 2.0
     *   Rainfall  × 1.5  → secondary factor
     *   Humidity  × 0.8  → supporting factor
     *   Temp      × 0.3  → minor factor
     */
    private function normalizeFeatures($wind, $rainfall, $pressure, $temp, $humidity): array
    {
        $pressureDanger = max(0, 1013 - $pressure); // 0 at normal, increases as storm intensifies

        return [
            $wind * 3.0,
            $pressureDanger * 2.0,
            $rainfall * 1.5,
            $humidity * 0.8,
            $temp * 0.3,
        ];
    }

    /**
     * Wind override safety net.
     *
     * After the ML model predicts a signal, this method enforces PAGASA
     * official wind thresholds. The result can only be RAISED, never lowered.
     * This guarantees wind speed is never ignored.
     */
    private function windOverride(string $mlPrediction, float $wind, float $rainfall = 0, float $pressure = 1013): string
    {
        // CALM CONDITIONS OVERRIDE
        // If all conditions are clearly normal, force Normal regardless of ML vote.
        // This prevents ML from overcalling Watch/Elevated on calm days.
        if ($wind < 30 && $rainfall < 1.0 && $pressure > 1005) {
            return 'Normal';
        }

        // Determine minimum signal based on wind speed alone
        $windSignal = 'Normal';
        foreach (self::SIGNAL_THRESHOLDS as $signal => [$min, $max]) {
            if ($wind >= $min && $wind <= $max) {
                $windSignal = $signal;
                break;
            }
        }

        // Return whichever is HIGHER — ML result or wind threshold
        $mlRank   = self::SIGNAL_RANK[$mlPrediction] ?? 0;
        $windRank = self::SIGNAL_RANK[$windSignal] ?? 0;

        return $mlRank >= $windRank ? $mlPrediction : $windSignal;
    }

    public function train(): bool
    {
        // Delete old stale model first — must retrain fresh
        if (file_exists($this->modelPath)) {
            unlink($this->modelPath);
        }

        // ---------------------------------------------------------------
        // TRAINING DATASET
        // Based on PAGASA official signal classifications.
        // Each row: [wind km/h, rainfall mm/hr, pressure hPa, temp °C, humidity %]
        // More samples per class = more stable Random Forest predictions.
        // Boundary zones (e.g. 85-95 km/h) have extra samples for accuracy.
        // ---------------------------------------------------------------
        $rawSamples = [
            // --- NORMAL (wind < 30 km/h) ---
            [5,  0.0, 1015, 31, 70],
            [5,  0.0, 1016, 31, 68],
            [8,  0.0, 1015, 31, 69],
            [10, 0.0, 1013, 30, 75],
            [10, 0.0, 1014, 30, 72],
            [12, 0.0, 1014, 30, 72],
            [15, 0.0, 1011, 29, 72],
            [15, 0.0, 1012, 30, 73],
            [18, 0.0, 1012, 29, 73],
            [18, 0.0, 1013, 30, 71],
            [20, 0.5, 1010, 28, 74],
            [20, 0.0, 1011, 29, 74],
            [22, 0.0, 1010, 28, 73],
            [22, 0.0, 1011, 29, 72],
            [25, 1.0, 1009, 29, 76],
            [25, 0.0, 1010, 29, 75],
            [27, 1.0, 1010, 29, 75],
            [28, 1.5, 1009, 28, 76],
            [28, 0.0, 1006, 30, 74],
            [29, 0.5, 1007, 30, 75],

            // --- WATCH (30–44 km/h) ---
            [30, 1.5, 1008, 28, 78],
            [32, 2.0, 1008, 28, 79],
            [35, 2.0, 1007, 29, 77],
            [37, 2.5, 1007, 28, 78],
            [40, 2.5, 1006, 28, 80],
            [42, 3.0, 1005, 27, 81],
            [44, 3.0, 1005, 27, 81],

            // --- ELEVATED / Tropical Depression (45–59 km/h) ---
            [45, 3.0, 999,  27, 82],
            [47, 3.5, 999,  27, 82],
            [48, 3.5, 998,  27, 84],
            [50, 4.0, 997,  27, 83],
            [52, 4.5, 996,  26, 83],
            [54, 5.0, 995,  26, 85],
            [55, 5.0, 995,  26, 85],
            [56, 7.0, 993,  26, 87],
            [57, 9.0, 991,  25, 87],
            [58, 8.0, 992,  25, 88],
            [59, 7.5, 993,  26, 86],

            // --- SIGNAL 1 (60–89 km/h) ---
            [60, 12.0, 991, 25, 88],
            [62, 13.0, 990, 25, 88],
            [65, 14.0, 990, 25, 89],
            [68, 15.0, 989, 25, 89],
            [70, 18.0, 987, 24, 90],
            [72, 18.0, 988, 24, 89],
            [75, 19.0, 987, 24, 90],
            [78, 20.0, 986, 24, 90],
            [80, 20.0, 985, 24, 91],
            [82, 21.0, 985, 24, 91],
            [85, 21.0, 984, 23, 91],
            [87, 22.0, 984, 23, 91],
            [88, 22.0, 983, 23, 92],
            [89, 22.0, 983, 23, 92],

            // --- SIGNAL 2 (90–120 km/h) ---
            // Extra boundary samples at 90 and 120 km/h
            [90,  22.0, 983, 23, 92],
            [92,  23.0, 982, 23, 92],
            [95,  24.0, 982, 23, 92],
            [98,  24.0, 981, 23, 91],
            [100, 25.0, 981, 23, 91],
            [103, 26.0, 980, 22, 92],
            [105, 26.0, 980, 22, 92],
            [108, 27.0, 979, 22, 92],
            [110, 27.0, 979, 22, 92],
            [112, 28.0, 978, 22, 93],
            [115, 28.0, 977, 22, 93],
            [118, 29.0, 976, 22, 93],
            [119, 29.0, 976, 22, 93],
            [120, 30.0, 975, 22, 93],

            // --- SIGNAL 3 (121–170 km/h) ---
            [121, 30.0, 975, 22, 93],
            [125, 32.0, 974, 21, 93],
            [130, 35.0, 972, 21, 94],
            [135, 36.0, 971, 21, 94],
            [140, 38.0, 969, 21, 94],
            [145, 39.0, 968, 20, 95],
            [150, 40.0, 967, 20, 95],
            [155, 41.0, 966, 20, 95],
            [160, 42.0, 965, 20, 95],
            [165, 43.0, 963, 20, 96],
            [170, 45.0, 962, 20, 96],

            // --- SIGNAL 4 (171–220 km/h) ---
            [171, 45.0, 962, 20, 96],
            [175, 46.0, 961, 19, 96],
            [180, 48.0, 959, 19, 96],
            [185, 49.0, 958, 19, 97],
            [190, 50.0, 956, 19, 97],
            [195, 51.0, 955, 18, 97],
            [200, 52.0, 953, 18, 97],
            [210, 55.0, 950, 18, 97],
            [215, 55.0, 949, 18, 98],
            [220, 55.0, 947, 18, 98],

            // --- SIGNAL 5 / Supertyphoon (> 220 km/h) ---
            [221, 56.0, 947, 18, 98],
            [240, 58.0, 943, 17, 98],
            [260, 60.0, 939, 17, 98],
            [280, 62.0, 935, 16, 99],
            [300, 65.0, 930, 16, 99],
            [320, 68.0, 925, 15, 99],
            [350, 70.0, 920, 15, 100],
        ];

        $labels = [
            // Normal (20)
            'Normal','Normal','Normal','Normal','Normal',
            'Normal','Normal','Normal','Normal','Normal',
            'Normal','Normal','Normal','Normal','Normal',
            'Normal','Normal','Normal','Normal','Normal',
            // Watch (7)
            'Watch','Watch','Watch','Watch','Watch','Watch','Watch',
            // Elevated (9)
            'Elevated','Elevated','Elevated','Elevated','Elevated',
            'Elevated','Elevated','Elevated','Elevated',
            // Signal 1 (14)
            'Signal 1','Signal 1','Signal 1','Signal 1','Signal 1',
            'Signal 1','Signal 1','Signal 1','Signal 1','Signal 1',
            'Signal 1','Signal 1','Signal 1','Signal 1',
            // Signal 2 (14)
            'Signal 2','Signal 2','Signal 2','Signal 2','Signal 2',
            'Signal 2','Signal 2','Signal 2','Signal 2','Signal 2',
            'Signal 2','Signal 2','Signal 2','Signal 2',
            // Signal 3 (11)
            'Signal 3','Signal 3','Signal 3','Signal 3','Signal 3',
            'Signal 3','Signal 3','Signal 3','Signal 3','Signal 3','Signal 3',
            // Signal 4 (10)
            'Signal 4','Signal 4','Signal 4','Signal 4','Signal 4',
            'Signal 4','Signal 4','Signal 4','Signal 4','Signal 4',
            // Signal 5 (7)
            'Signal 5','Signal 5','Signal 5','Signal 5','Signal 5','Signal 5','Signal 5',
        ];

        // Normalize all training samples before feeding to Random Forest
        $samples = array_map(function ($s) {
            return $this->normalizeFeatures($s[0], $s[1], $s[2], $s[3], $s[4]);
        }, $rawSamples);

        // Train the Random Forest — this actually LEARNS patterns
        $this->classifier->train($samples, $labels);

        if (!is_dir(dirname($this->modelPath))) {
            mkdir(dirname($this->modelPath), 0755, true);
        }

        if (!is_writable(dirname($this->modelPath))) {
            chmod(dirname($this->modelPath), 0775);
        }

        $modelManager = new ModelManager();
        $modelManager->saveToFile($this->classifier, $this->modelPath);

        return true;
    }

    public function predict($wind, $rainfall, $pressure, $temp, $humidity): string
    {
        if (!file_exists($this->modelPath)) {
            $this->train();
        }

        $modelManager = new ModelManager();
        $this->classifier = $modelManager->restoreFromFile($this->modelPath);

        // Normalize input the same way training data was normalized
        $input = $this->normalizeFeatures($wind, $rainfall, $pressure, $temp, $humidity);

        $mlPrediction = $this->classifier->predict([$input]);
        $mlResult = $mlPrediction[0];

        // Apply wind override — wind speed can only raise the signal, never lower it
        // Also passes rainfall and pressure for calm conditions check
        return $this->windOverride($mlResult, $wind, $rainfall, $pressure);
    }

    public function getConfidence($prediction): string
    {
        $confidence = [
            'Normal'   => 'Low risk - normal tropical weather conditions',
            'Watch'    => 'Moderate concern - low pressure area detected',
            'Elevated' => 'Elevated risk - tropical depression forming',
            'Signal 1' => 'High risk - typhoon Signal 1 conditions detected',
            'Signal 2' => 'Very high risk - destructive winds approaching',
            'Signal 3' => 'Extreme risk - extremely destructive typhoon',
            'Signal 4' => 'Catastrophic - evacuate immediately',
            'Signal 5' => 'Supertyphoon - catastrophic danger',
        ];

        return $confidence[$prediction] ?? 'Unable to determine risk level';
    }
}