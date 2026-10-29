<?php

namespace App\Console\Commands;

use App\Services\HistoricalTyphoonDataset;
use App\Services\TyphoonMLService;
use Illuminate\Console\Command;
use Phpml\Classification\Ensemble\RandomForest;
use Phpml\Metric\Accuracy;
use Phpml\Metric\ClassificationReport;
use Phpml\Metric\ConfusionMatrix;

class EvaluateTyphoonModel extends Command
{
    protected $signature = 'ml:evaluate';

    protected $description = 'Evaluate the typhoon model by holding out each complete storm in turn';

    public function handle(
        HistoricalTyphoonDataset $dataset,
        TyphoonMLService $mlService,
    ): int {
        $records = $dataset->records(deduplicateGrid: false);
        $events = array_values(array_unique(array_column($records, 'event_id')));

        if (count($events) < 2) {
            $this->error('At least two storm events are required for event-held-out evaluation.');

            return self::FAILURE;
        }

        $this->info('Evaluating with leave-one-storm-out cross-validation...');

        $actual = [];
        $rawPredictions = [];
        $postPredictions = [];
        $folds = [];

        foreach ($events as $heldOutEvent) {
            $trainRows = array_values(array_filter(
                $records,
                fn (array $row): bool => $row['event_id'] !== $heldOutEvent,
            ));
            $testRows = array_values(array_filter(
                $records,
                fn (array $row): bool => $row['event_id'] === $heldOutEvent,
            ));

            $trainSamples = array_map(
                fn (array $row): array => $this->features($mlService, $row),
                $trainRows,
            );
            $trainLabels = array_column($trainRows, 'label');
            $testSamples = array_map(
                fn (array $row): array => $this->features($mlService, $row),
                $testRows,
            );
            $testLabels = array_column($testRows, 'label');

            $forest = new RandomForest(numClassifier: TyphoonMLService::FOREST_TREES);
            $forest->train($trainSamples, $trainLabels);
            $foldRaw = $forest->predict($testSamples);
            $foldPost = [];

            foreach ($testRows as $index => $row) {
                $foldPost[] = $mlService->windOverride(
                    $foldRaw[$index],
                    (float) $row['wind_kmh'],
                    (float) $row['rainfall_mm'],
                    (float) $row['pressure_hpa'],
                );
            }

            $folds[] = [
                'event' => $heldOutEvent,
                'storm' => $testRows[0]['storm_name'],
                'samples' => count($testRows),
                'raw' => Accuracy::score($testLabels, $foldRaw),
                'post' => Accuracy::score($testLabels, $foldPost),
            ];

            array_push($actual, ...$testLabels);
            array_push($rawPredictions, ...$foldRaw);
            array_push($postPredictions, ...$foldPost);

            $this->line("  Held out {$heldOutEvent} ({$testRows[0]['storm_name']}): ".count($testRows).' samples');
        }

        $classes = array_values(array_filter(
            array_keys(TyphoonMLService::SIGNAL_RANK),
            fn (string $label): bool => in_array($label, $actual, true),
        ));
        $rawAccuracy = Accuracy::score($actual, $rawPredictions);
        $postAccuracy = Accuracy::score($actual, $postPredictions);

        $report = $this->buildReport(
            dataset: $dataset,
            records: $records,
            events: $events,
            classes: $classes,
            actual: $actual,
            rawPredictions: $rawPredictions,
            postPredictions: $postPredictions,
            rawAccuracy: $rawAccuracy,
            postAccuracy: $postAccuracy,
            folds: $folds,
        );

        $reportPath = storage_path('app/ml-evaluation.md');
        file_put_contents($reportPath, $report);

        $this->newLine();
        $this->info('=== Evaluation Summary ===');
        $this->line('Dataset rows: '.count($records));
        $this->line('Storm folds: '.count($events));
        $this->line(sprintf('Raw Random Forest Accuracy: %.2f%%', $rawAccuracy * 100));
        $this->line(sprintf('After windOverride() Accuracy: %.2f%%', $postAccuracy * 100));
        $this->line("Report written to: {$reportPath}");

        return self::SUCCESS;
    }

    /** @param array<string, string> $row */
    private function features(TyphoonMLService $service, array $row): array
    {
        return $service->featureVector(
            $row['wind_kmh'],
            $row['rainfall_mm'],
            $row['pressure_hpa'],
            $row['temperature_c'],
            $row['humidity_pct'],
        );
    }

    /**
     * @param  array<int, array<string, string>>  $records
     * @param  array<int, string>  $events
     * @param  array<int, string>  $classes
     * @param  array<int, string>  $actual
     * @param  array<int, string>  $rawPredictions
     * @param  array<int, string>  $postPredictions
     * @param  array<int, array<string, mixed>>  $folds
     */
    private function buildReport(
        HistoricalTyphoonDataset $dataset,
        array $records,
        array $events,
        array $classes,
        array $actual,
        array $rawPredictions,
        array $postPredictions,
        float $rawAccuracy,
        float $postAccuracy,
        array $folds,
    ): string {
        $labelCounts = array_count_values($actual);
        $barangayCount = count(array_unique(array_column($records, 'barangay_name')));
        $bulletinCount = count(array_unique(array_map(
            fn (array $row): string => $row['event_id'].'|'.$row['issued_at'],
            $records,
        )));

        $rawReport = new ClassificationReport($actual, $rawPredictions);
        $postReport = new ClassificationReport($actual, $postPredictions);
        $rawMatrix = ConfusionMatrix::compute($actual, $rawPredictions, $classes);
        $postMatrix = ConfusionMatrix::compute($actual, $postPredictions, $classes);

        $lines = [
            '# Typhoon ML Model Evaluation Report',
            '',
            '> Labels are real PAGASA TCWS bulletins; weather inputs are Open-Meteo ECMWF IFS historical values at each stored Surigao City barangay coordinate.',
            '>',
            '> TCWS is a forecast warning, while these five model inputs describe weather at bulletin issue time. Accuracy therefore measures pattern agreement, not authority to replace PAGASA.',
            '',
            '## Dataset Overview',
            '',
            '- **Dataset:** `'.$dataset->path().'`',
            '- **Samples:** '.count($records),
            '- **PAGASA bulletins:** '.$bulletinCount,
            '- **Storm events:** '.count($events),
            '- **Barangays represented:** '.$barangayCount,
            '- **Validation:** Leave-one-storm-out cross-validation',
            '',
            '### Class Distribution',
            '',
            '| Class | Samples |',
            '|---|---:|',
        ];

        foreach ($classes as $class) {
            $lines[] = "| {$class} | ".($labelCounts[$class] ?? 0).' |';
        }

        array_push(
            $lines,
            '',
            '## Held-out Storm Results',
            '',
            '| Storm | Event | Samples | Raw accuracy | After safety floor |',
            '|---|---|---:|---:|---:|',
        );
        foreach ($folds as $fold) {
            $lines[] = sprintf(
                '| %s | `%s` | %d | %.2f%% | %.2f%% |',
                $fold['storm'],
                $fold['event'],
                $fold['samples'],
                $fold['raw'] * 100,
                $fold['post'] * 100,
            );
        }

        array_push(
            $lines,
            '',
            '## Raw Random Forest',
            '',
            sprintf('- **Overall accuracy:** %.2f%%', $rawAccuracy * 100),
            '',
            $this->renderReportTable($classes, $rawReport),
            '',
            $this->renderConfusionTable($classes, $rawMatrix),
            '',
            '## Result After windOverride()',
            '',
            sprintf('- **Overall accuracy:** %.2f%%', $postAccuracy * 100),
            '',
            $this->renderReportTable($classes, $postReport),
            '',
            $this->renderConfusionTable($classes, $postMatrix),
            '',
        );

        return implode("\n", $lines);
    }

    /** @param array<int, string> $classes */
    private function renderReportTable(array $classes, ClassificationReport $report): string
    {
        $precision = $report->getPrecision();
        $recall = $report->getRecall();
        $f1 = $report->getF1score();
        $support = $report->getSupport();
        $rows = [
            '| Class | Precision | Recall | F1-Score | Support |',
            '|---|---:|---:|---:|---:|',
        ];

        foreach ($classes as $class) {
            $rows[] = sprintf(
                '| %s | %.2f%% | %.2f%% | %.4f | %d |',
                $class,
                ($precision[$class] ?? 0) * 100,
                ($recall[$class] ?? 0) * 100,
                $f1[$class] ?? 0,
                $support[$class] ?? 0,
            );
        }

        return implode("\n", $rows);
    }

    /**
     * @param  array<int, string>  $classes
     * @param  array<int, array<int, int>>  $matrix
     */
    private function renderConfusionTable(array $classes, array $matrix): string
    {
        $rows = [
            '| Actual \\ Predicted | '.implode(' | ', $classes).' |',
            '|---|'.str_repeat('---:|', count($classes)),
        ];

        foreach ($classes as $rowIndex => $actualClass) {
            $values = [];
            foreach ($classes as $columnIndex => $_) {
                $values[] = $matrix[$rowIndex][$columnIndex] ?? 0;
            }
            $rows[] = "| {$actualClass} | ".implode(' | ', $values).' |';
        }

        return implode("\n", $rows);
    }
}
