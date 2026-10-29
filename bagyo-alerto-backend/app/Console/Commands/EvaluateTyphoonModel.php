<?php

namespace App\Console\Commands;

use App\Services\TyphoonMLService;
use Illuminate\Console\Command;
use Illuminate\Console\Application as Artisan;
use Phpml\Classification\Ensemble\RandomForest;
use Phpml\CrossValidation\StratifiedRandomSplit;
use Phpml\Dataset\ArrayDataset;
use Phpml\Metric\Accuracy;
use Phpml\Metric\ClassificationReport;
use Phpml\Metric\ConfusionMatrix;
use ReflectionClass;

// Provide ml:train if not already registered elsewhere in the application
Artisan::starting(function ($artisan) {
    if (!$artisan->has('ml:train')) {
        $artisan->add(new class extends Command {
            protected $signature = 'ml:train';
            protected $description = 'Train the typhoon severity ML model';

            public function handle(): int
            {
                $this->info('Training typhoon ML model...');
                $ml = new TyphoonMLService();
                $ml->train();
                $this->info('Model trained and saved successfully!');
                return self::SUCCESS;
            }
        });
    }
});

class EvaluateTyphoonModel extends Command
{
    protected $signature = 'ml:evaluate';

    protected $description = 'Evaluate the typhoon severity ML model with stratified 80/20 train/test split';

    public function handle(): int
    {
        $this->info('Starting Typhoon ML Model Evaluation (80/20 Stratified Split)...');

        $mlService = new TyphoonMLService();

        // Extract raw training dataset and feature normalizer using Reflection
        $ref = new ReflectionClass(TyphoonMLService::class);
        $trainingDataMethod = $ref->getMethod('trainingData');
        $trainingDataMethod->setAccessible(true);
        $data = $trainingDataMethod->invoke($mlService);

        $normMethod = $ref->getMethod('normalizeFeatures');
        $normMethod->setAccessible(true);

        $rawSamples = [];
        $labels = [];
        foreach ($data as $row) {
            $rawSamples[] = [$row[0], $row[1], $row[2], $row[3], $row[4]];
            $labels[]     = $row[5];
        }

        // 80/20 Stratified Random Split with fixed seed for reproducibility
        $dataset = new ArrayDataset($rawSamples, $labels);
        $split = new StratifiedRandomSplit($dataset, 0.20, 42);

        $trainRaw    = $split->getTrainSamples();
        $trainLabels = $split->getTrainLabels();
        $testRaw     = $split->getTestSamples();
        $testLabels  = $split->getTestLabels();

        $totalCount = count($rawSamples);
        $trainCount = count($trainRaw);
        $testCount  = count($testRaw);

        // Normalize features for the fresh model
        $trainFeatures = array_map(function ($s) use ($normMethod, $mlService) {
            return $normMethod->invoke($mlService, $s[0], $s[1], $s[2], $s[3], $s[4]);
        }, $trainRaw);

        $testFeatures = array_map(function ($s) use ($normMethod, $mlService) {
            return $normMethod->invoke($mlService, $s[0], $s[1], $s[2], $s[3], $s[4]);
        }, $testRaw);

        // Train a FRESH RandomForest (100 trees) on the train part ONLY (does NOT overwrite model file)
        $freshForest = new RandomForest(numClassifier: 100);
        $freshForest->train($trainFeatures, $trainLabels);

        // All classes in severity order
        $classes = array_keys(TyphoonMLService::SIGNAL_RANK);

        // (a) Raw Forest Evaluation
        $rawPredictions = $freshForest->predict($testFeatures);
        $rawAccuracy    = Accuracy::score($testLabels, $rawPredictions);
        $rawReport      = new ClassificationReport($testLabels, $rawPredictions);
        $rawMatrix      = ConfusionMatrix::compute($testLabels, $rawPredictions, $classes);

        // (b) Post-windOverride Evaluation
        $postPredictions = [];
        foreach ($testRaw as $i => $s) {
            $rawPred = $rawPredictions[$i];
            $postPredictions[] = $mlService->windOverride($rawPred, (float) $s[0], (float) $s[1], (float) $s[2]);
        }
        $postAccuracy = Accuracy::score($testLabels, $postPredictions);
        $postReport   = new ClassificationReport($testLabels, $postPredictions);
        $postMatrix   = ConfusionMatrix::compute($testLabels, $postPredictions, $classes);

        // Class sample distribution
        $sampleCounts = array_count_values($labels);

        // Build Markdown Report
        $md = [];
        $md[] = '# Typhoon ML Model Evaluation Report';
        $md[] = '';
        $md[] = '> **Note:** Dataset is synthetic (hand-built from PAGASA thresholds), so accuracy is optimistic and not evidence of real-world performance.';
        $md[] = '';
        $md[] = '## Dataset Overview';
        $md[] = "- **Total Samples:** {$totalCount}";
        $md[] = "- **Training Set (80%):** {$trainCount} samples";
        $md[] = "- **Test Set (20%):** {$testCount} samples";
        $md[] = '- **Split Strategy:** Stratified Random Split (seed: 42)';
        $md[] = '';
        $md[] = '### Sample Counts per Class';
        $md[] = '| Class | Count |';
        $md[] = '|---|---|';
        foreach ($classes as $cls) {
            $count = $sampleCounts[$cls] ?? 0;
            $md[] = "| {$cls} | {$count} |";
        }
        $md[] = '';

        // (a) Section
        $md[] = '## (a) Raw Random Forest Evaluation';
        $md[] = sprintf('- **Overall Accuracy:** %.2f%% (%.4f)', $rawAccuracy * 100, $rawAccuracy);
        $md[] = '';
        $md[] = '### Classification Report';
        $md[] = $this->renderReportTable($classes, $rawReport);
        $md[] = '';
        $md[] = '### Confusion Matrix';
        $md[] = $this->renderConfusionTable($classes, $rawMatrix);
        $md[] = '';

        // (b) Section
        $md[] = '## (b) Final Result After windOverride()';
        $md[] = sprintf('- **Overall Accuracy:** %.2f%% (%.4f)', $postAccuracy * 100, $postAccuracy);
        $md[] = '';
        $md[] = '### Classification Report';
        $md[] = $this->renderReportTable($classes, $postReport);
        $md[] = '';
        $md[] = '### Confusion Matrix';
        $md[] = $this->renderConfusionTable($classes, $postMatrix);
        $md[] = '';

        $reportContent = implode("\n", $md);
        $reportPath = storage_path('app/ml-evaluation.md');

        if (!is_dir(dirname($reportPath))) {
            mkdir(dirname($reportPath), 0755, true);
        }
        file_put_contents($reportPath, $reportContent);

        // Short console summary
        $this->newLine();
        $this->info('=== Evaluation Summary ===');
        $this->line(sprintf('Dataset: %d samples (%d train / %d test)', $totalCount, $trainCount, $testCount));
        $this->line(sprintf('Raw Random Forest Accuracy: %.2f%% (%.4f)', $rawAccuracy * 100, $rawAccuracy));
        $this->line(sprintf('After windOverride() Accuracy: %.2f%% (%.4f)', $postAccuracy * 100, $postAccuracy));
        $this->line('Report written to: ' . $reportPath);
        $this->newLine();

        return self::SUCCESS;
    }

    private function renderReportTable(array $classes, ClassificationReport $report): string
    {
        $precision = $report->getPrecision();
        $recall    = $report->getRecall();
        $f1        = $report->getF1score();
        $support   = $report->getSupport();

        $rows = [];
        $rows[] = '| Class | Precision | Recall | F1-Score | Support |';
        $rows[] = '|---|---|---|---|---|';

        foreach ($classes as $cls) {
            $p = isset($precision[$cls]) ? sprintf('%.2f%%', $precision[$cls] * 100) : 'N/A';
            $r = isset($recall[$cls]) ? sprintf('%.2f%%', $recall[$cls] * 100) : 'N/A';
            $f = isset($f1[$cls]) ? sprintf('%.4f', $f1[$cls]) : 'N/A';
            $s = $support[$cls] ?? 0;
            $rows[] = "| {$cls} | {$p} | {$r} | {$f} | {$s} |";
        }

        return implode("\n", $rows);
    }

    private function renderConfusionTable(array $classes, array $matrix): string
    {
        $header = '| Actual \\ Predicted | ' . implode(' | ', $classes) . ' |';
        $separator = '|---|' . str_repeat('---|', count($classes));

        $rows = [$header, $separator];
        foreach ($classes as $rIdx => $actualClass) {
            $cols = [];
            foreach ($classes as $cIdx => $_) {
                $cols[] = $matrix[$rIdx][$cIdx] ?? 0;
            }
            $rows[] = "| {$actualClass} | " . implode(' | ', $cols) . ' |';
        }

        return implode("\n", $rows);
    }
}

