<?php

namespace App\Services;

use Phpml\Classification\KNearestNeighbors;
use Phpml\ModelManager;

class TyphoonMLService
{
    private $classifier;
    private $modelPath;

    public function __construct()
    {
        $this->modelPath = storage_path('app/typhoon_model.phpml');
        $this->classifier = new KNearestNeighbors(k: 3);
    }

    public function train()
    {
        $samples = [
            [10, 0.0, 1013, 30, 75],
            [15, 0.0, 1011, 29, 72],
            [20, 0.5, 1010, 28, 74],
            [25, 1.0, 1009, 29, 76],
            [30, 1.5, 1008, 28, 78],
            [35, 2.0, 1007, 29, 77],
            [17, 0.0, 1009, 29, 74],
            [22, 0.0, 1010, 28, 73],
            [45, 3.0, 999, 27, 82],
            [50, 4.0, 997, 27, 83],
            [55, 5.0, 995, 26, 85],
            [48, 3.5, 998, 27, 84],
            [52, 4.5, 996, 26, 83],
            [56, 7.0, 993, 26, 87],
            [58, 8.0, 992, 25, 88],
            [57, 9.0, 991, 25, 87],
            [59, 7.5, 993, 26, 86],
            [60, 15.0, 989, 25, 89],
            [70, 18.0, 987, 24, 90],
            [80, 20.0, 985, 24, 91],
            [90, 22.0, 983, 23, 92],
            [100, 25.0, 981, 23, 91],
            [110, 27.0, 979, 22, 92],
            [115, 28.0, 977, 22, 93],
            [120, 30.0, 975, 22, 93],
            [130, 35.0, 972, 21, 94],
            [140, 38.0, 969, 21, 94],
            [150, 40.0, 967, 20, 95],
            [160, 42.0, 965, 20, 95],
            [170, 45.0, 962, 20, 96],
            [180, 48.0, 959, 19, 96],
            [190, 50.0, 956, 19, 97],
            [200, 52.0, 953, 18, 97],
            [210, 55.0, 950, 18, 97],
            [220, 55.0, 947, 18, 98],
            [240, 58.0, 943, 17, 98],
            [260, 60.0, 939, 17, 98],
            [280, 62.0, 935, 16, 99],
            [300, 65.0, 930, 16, 99],
            [320, 68.0, 925, 15, 99],
            [350, 70.0, 920, 15, 100],
        ];

        $labels = [
            'Normal', 'Normal', 'Normal', 'Normal', 'Normal', 'Normal', 'Normal', 'Normal',
            'Watch', 'Watch', 'Watch', 'Watch', 'Watch',
            'Elevated', 'Elevated', 'Elevated', 'Elevated',
            'Signal 1', 'Signal 1', 'Signal 1', 'Signal 1', 'Signal 1', 'Signal 1', 'Signal 1',
            'Signal 2', 'Signal 2', 'Signal 2', 'Signal 2', 'Signal 2',
            'Signal 3', 'Signal 3', 'Signal 3', 'Signal 3', 'Signal 3',
            'Signal 4', 'Signal 4', 'Signal 4', 'Signal 4',
            'Signal 5', 'Signal 5', 'Signal 5',
        ];

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

    public function predict($wind, $rainfall, $pressure, $temp, $humidity)
    {
        if (!file_exists($this->modelPath)) {
            $this->train();
        }

        $modelManager = new ModelManager();
        $this->classifier = $modelManager->restoreFromFile($this->modelPath);

        $prediction = $this->classifier->predict([
            [$wind, $rainfall, $pressure, $temp, $humidity],
        ]);

        return $prediction[0];
    }

    public function getConfidence($prediction)
    {
        $confidence = [
            'Normal' => 'Low risk - normal tropical weather conditions',
            'Watch' => 'Moderate concern - low pressure area detected',
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
