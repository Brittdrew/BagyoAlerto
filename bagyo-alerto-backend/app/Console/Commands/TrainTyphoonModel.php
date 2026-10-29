<?php

namespace App\Console\Commands;

use App\Services\TyphoonMLService;
use Illuminate\Console\Command;

class TrainTyphoonModel extends Command
{
    protected $signature = 'ml:train';

    protected $aliases = ['typhoon:train'];

    protected $description = 'Train the typhoon severity ML model';

    public function handle(TyphoonMLService $ml): int
    {
        $this->info('Training typhoon ML model...');

        $ml->train();

        $this->info('Model trained and saved successfully!');

        return self::SUCCESS;
    }
}
