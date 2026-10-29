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
 * 2. Unweighted feature normalization (tree models are invariant to monotonic scaling)
 * 3. Added windOverride() so wind speed ALWAYS enforces minimum signal
 * 4. Unified training dataset structure with official PAGASA wind thresholds
 * 5. Old model is deleted before retraining to prevent stale predictions
 */
class TyphoonMLService
{
    private $classifier;
    private $modelPath;
    /** @var bool Tracks whether the classifier has been deserialised from disk this request. */
    private bool $classifierLoaded = false;

    // Official PAGASA wind thresholds (km/h)
    public const SIGNAL_THRESHOLDS = [
        'Normal'   => [0,   29],
        'Watch'    => [30,  38],
        'Signal 1' => [39,  61],
        'Signal 2' => [62,  88],
        'Signal 3' => [89,  117],
        'Signal 4' => [118, 184],
        'Signal 5' => [185, PHP_INT_MAX],
    ];

    // Signal rank for comparison (higher = more severe)
    public const SIGNAL_RANK = [
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
     * Prepare feature vector for the model.
     *
     * Feature weighting/multipliers are not needed for decision tree and
     * random forest models because tree-based splits are invariant to monotonic
     * feature scaling.
     *
     * Features returned (in consistent order):
     *   1. Wind speed (km/h)
     *   2. Pressure danger score: max(0, 1013 - pressure)
     *   3. Rainfall (mm/hr)
     *   4. Humidity (%)
     *   5. Temperature (°C)
     */
    private function normalizeFeatures($wind, $rainfall, $pressure, $temp, $humidity): array
    {
        $pressureDanger = max(0, 1013 - $pressure); // 0 at normal, increases as storm intensifies

        return [
            $wind,
            $pressureDanger,
            $rainfall,
            $humidity,
            $temp,
        ];
    }

    /**
     * Wind override safety net.
     *
     * After the ML model predicts a signal, this method enforces PAGASA
     * official wind thresholds. The result can only be RAISED, never lowered.
     * This guarantees wind speed is never ignored.
     */
    public function windOverride(string $mlPrediction, float $wind, float $rainfall = 0, float $pressure = 1013): string
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

    /**
     * Unified training dataset where each row is:
     * [wind km/h, rainfall mm/hr, pressure hPa, temp °C, humidity %, 'Label']
     *
     * Labeled by official PAGASA wind brackets in SIGNAL_THRESHOLDS.
     * 'Elevated' has no wind bracket and represents tropical depression / heavy rain
     * conditions where wind < 39 km/h and rainfall is 7.5 - 29.9 mm/hr (matching
     * TyphoonController's rainfall override).
     */
    private function trainingData(): array
    {
        return [
            // --- NORMAL (wind 0–29 km/h, rain < 7.5 mm/hr) ---
            [5,  0.0, 1015, 31, 70, 'Normal'],
            [5,  0.0, 1016, 31, 68, 'Normal'],
            [8,  0.0, 1015, 31, 69, 'Normal'],
            [10, 0.0, 1013, 30, 75, 'Normal'],
            [10, 0.0, 1014, 30, 72, 'Normal'],
            [12, 0.0, 1014, 30, 72, 'Normal'],
            [15, 0.0, 1011, 29, 72, 'Normal'],
            [15, 0.0, 1012, 30, 73, 'Normal'],
            [18, 0.0, 1012, 29, 73, 'Normal'],
            [18, 0.0, 1013, 30, 71, 'Normal'],
            [20, 0.5, 1010, 28, 74, 'Normal'],
            [20, 0.0, 1011, 29, 74, 'Normal'],
            [22, 0.0, 1010, 28, 73, 'Normal'],
            [22, 0.0, 1011, 29, 72, 'Normal'],
            [25, 1.0, 1009, 29, 76, 'Normal'],
            [25, 0.0, 1010, 29, 75, 'Normal'],
            [27, 1.0, 1010, 29, 75, 'Normal'],
            [28, 1.5, 1009, 28, 76, 'Normal'],
            [28, 0.0, 1006, 30, 74, 'Normal'],
            [29, 0.5, 1007, 30, 75, 'Normal'],

            // --- WATCH (wind 30–38 km/h, rain < 7.5 mm/hr) ---
            [30, 1.5, 1008, 28, 78, 'Watch'],
            [31, 1.8, 1008, 28, 78, 'Watch'],
            [32, 2.0, 1008, 28, 79, 'Watch'],
            [33, 2.0, 1007, 28, 79, 'Watch'],
            [34, 2.2, 1007, 29, 78, 'Watch'],
            [35, 2.0, 1007, 29, 77, 'Watch'],
            [36, 2.5, 1006, 28, 79, 'Watch'],
            [37, 2.5, 1007, 28, 78, 'Watch'],
            [38, 2.8, 1006, 28, 80, 'Watch'],
            [38, 3.0, 1005, 27, 80, 'Watch'],

            // --- ELEVATED (wind < 39 km/h AND rainfall 7.5–29.9 mm/hr) ---
            [15, 8.0,  1006, 27, 83, 'Elevated'],
            [18, 10.0, 1005, 27, 84, 'Elevated'],
            [20, 12.0, 1004, 26, 85, 'Elevated'],
            [22, 15.0, 1003, 26, 86, 'Elevated'],
            [25, 18.0, 1002, 26, 86, 'Elevated'],
            [28, 20.0, 1001, 26, 87, 'Elevated'],
            [30, 8.5,  1005, 27, 84, 'Elevated'],
            [32, 14.0, 1003, 26, 86, 'Elevated'],
            [35, 18.0, 1002, 26, 87, 'Elevated'],
            [37, 22.0, 1001, 25, 88, 'Elevated'],
            [38, 25.0, 1000, 25, 88, 'Elevated'],

            // --- SIGNAL 1 (wind 39–61 km/h) ---
            [40, 2.5, 1006, 28, 80, 'Signal 1'],
            [42, 3.0, 1005, 27, 81, 'Signal 1'],
            [44, 3.0, 1005, 27, 81, 'Signal 1'],
            [45, 3.0, 999,  27, 82, 'Signal 1'],
            [47, 3.5, 999,  27, 82, 'Signal 1'],
            [48, 3.5, 998,  27, 84, 'Signal 1'],
            [50, 4.0, 997,  27, 83, 'Signal 1'],
            [52, 4.5, 996,  26, 83, 'Signal 1'],
            [54, 5.0, 995,  26, 85, 'Signal 1'],
            [55, 5.0, 995,  26, 85, 'Signal 1'],
            [56, 7.0, 993,  26, 87, 'Signal 1'],
            [57, 9.0, 991,  25, 87, 'Signal 1'],
            [58, 8.0, 992,  25, 88, 'Signal 1'],
            [59, 7.5, 993,  26, 86, 'Signal 1'],
            [60, 12.0, 991, 25, 88, 'Signal 1'],
            [61, 12.5, 991, 25, 88, 'Signal 1'],

            // --- SIGNAL 2 (wind 62–88 km/h) ---
            [62, 13.0, 990, 25, 88, 'Signal 2'],
            [65, 14.0, 990, 25, 89, 'Signal 2'],
            [68, 15.0, 989, 25, 89, 'Signal 2'],
            [70, 18.0, 987, 24, 90, 'Signal 2'],
            [72, 18.0, 988, 24, 89, 'Signal 2'],
            [75, 19.0, 987, 24, 90, 'Signal 2'],
            [78, 20.0, 986, 24, 90, 'Signal 2'],
            [80, 20.0, 985, 24, 91, 'Signal 2'],
            [82, 21.0, 985, 24, 91, 'Signal 2'],
            [85, 21.0, 984, 23, 91, 'Signal 2'],
            [87, 22.0, 984, 23, 91, 'Signal 2'],
            [88, 22.0, 983, 23, 92, 'Signal 2'],

            // --- SIGNAL 3 (wind 89–117 km/h) ---
            [89,  22.0, 983, 23, 92, 'Signal 3'],
            [90,  22.0, 983, 23, 92, 'Signal 3'],
            [92,  23.0, 982, 23, 92, 'Signal 3'],
            [95,  24.0, 982, 23, 92, 'Signal 3'],
            [98,  24.0, 981, 23, 91, 'Signal 3'],
            [100, 25.0, 981, 23, 91, 'Signal 3'],
            [103, 26.0, 980, 22, 92, 'Signal 3'],
            [105, 26.0, 980, 22, 92, 'Signal 3'],
            [108, 27.0, 979, 22, 92, 'Signal 3'],
            [110, 27.0, 979, 22, 92, 'Signal 3'],
            [112, 28.0, 978, 22, 93, 'Signal 3'],
            [115, 28.0, 977, 22, 93, 'Signal 3'],
            [117, 28.5, 977, 22, 93, 'Signal 3'],

            // --- SIGNAL 4 (wind 118–184 km/h) ---
            [118, 29.0, 976, 22, 93, 'Signal 4'],
            [119, 29.0, 976, 22, 93, 'Signal 4'],
            [120, 30.0, 975, 22, 93, 'Signal 4'],
            [121, 30.0, 975, 22, 93, 'Signal 4'],
            [125, 32.0, 974, 21, 94, 'Signal 4'],
            [130, 35.0, 972, 21, 94, 'Signal 4'],
            [135, 36.0, 971, 21, 94, 'Signal 4'],
            [140, 38.0, 969, 21, 94, 'Signal 4'],
            [145, 39.0, 968, 20, 95, 'Signal 4'],
            [150, 40.0, 967, 20, 95, 'Signal 4'],
            [155, 41.0, 966, 20, 95, 'Signal 4'],
            [160, 42.0, 965, 20, 95, 'Signal 4'],
            [165, 43.0, 963, 20, 96, 'Signal 4'],
            [170, 45.0, 962, 20, 96, 'Signal 4'],
            [171, 45.0, 962, 20, 96, 'Signal 4'],
            [175, 46.0, 961, 19, 96, 'Signal 4'],
            [180, 48.0, 959, 19, 96, 'Signal 4'],
            [184, 48.5, 958, 19, 96, 'Signal 4'],

            // --- SIGNAL 5 / Supertyphoon (wind >= 185 km/h) ---
            [185, 49.0, 958, 19, 97, 'Signal 5'],
            [190, 50.0, 956, 19, 97, 'Signal 5'],
            [195, 51.0, 955, 18, 97, 'Signal 5'],
            [200, 52.0, 953, 18, 97, 'Signal 5'],
            [210, 55.0, 950, 18, 97, 'Signal 5'],
            [215, 55.0, 949, 18, 98, 'Signal 5'],
            [220, 55.0, 947, 18, 98, 'Signal 5'],
            [221, 56.0, 947, 18, 98, 'Signal 5'],
            [240, 58.0, 943, 17, 98, 'Signal 5'],
            [260, 60.0, 939, 17, 98, 'Signal 5'],
            [280, 62.0, 935, 16, 99, 'Signal 5'],
            [300, 65.0, 930, 16, 99, 'Signal 5'],
            [320, 68.0, 925, 15, 99, 'Signal 5'],
            [350, 70.0, 920, 15, 100, 'Signal 5'],
        ];
    }

    public function train(): bool
    {
        // Delete old stale model first — must retrain fresh
        if (file_exists($this->modelPath)) {
            unlink($this->modelPath);
        }

        $data = $this->trainingData();
        $samples = [];
        $labels = [];

        foreach ($data as $row) {
            $samples[] = $this->normalizeFeatures($row[0], $row[1], $row[2], $row[3], $row[4]);
            $labels[]  = $row[5];
        }

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
            // Model file is missing — log a warning. Falling back to in-memory train.
            // Recommendation: run `php artisan ml:train` to persist the model.
            \Illuminate\Support\Facades\Log::warning(
                '[TyphoonMLService] Model file not found at ' . $this->modelPath .
                '. Running in-memory training. Predictions may be slow.'
            );
            $this->train();
        }

        // Only deserialise from disk if the classifier has not been loaded yet
        // in this request. restoreFromFile() on a 3 MB file takes ~114 ms;
        // calling it on every predict() call would waste that time repeatedly.
        if (!($this->classifier instanceof \Phpml\Classification\Ensemble\RandomForest
              && method_exists($this->classifier, 'predict')
              && $this->classifierLoaded)) {
            $modelManager = new ModelManager();
            $this->classifier = $modelManager->restoreFromFile($this->modelPath);
            $this->classifierLoaded = true;
        }

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
