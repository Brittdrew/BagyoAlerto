<?php

namespace App\Console\Commands;

use App\Services\HistoricalTyphoonDataset;
use Illuminate\Console\Command;

class BuildTyphoonHistory extends Command
{
    protected $signature = 'ml:build-history
                            {--manifest= : Override the PAGASA label manifest path}
                            {--output= : Override the output CSV path}';

    protected $description = 'Build the real Surigao City typhoon dataset from PAGASA labels and Open-Meteo history';

    public function handle(): int
    {
        $dataset = new HistoricalTyphoonDataset(
            $this->option('manifest') ?: null,
            $this->option('output') ?: null,
        );

        $this->info('Building Surigao City historical typhoon dataset...');
        $summary = $dataset->build(function (string $eventId, int $bulletins, int $barangays): void {
            $this->line("  {$eventId}: {$bulletins} bulletins × {$barangays} barangays");
        });

        $this->newLine();
        $this->info("Wrote {$summary['rows']} rows from {$summary['events']} storms and {$summary['barangays']} barangays.");
        foreach ($summary['labels'] as $label => $count) {
            $this->line("  {$label}: {$count}");
        }
        $this->line("Dataset: {$summary['path']}");

        return self::SUCCESS;
    }
}
