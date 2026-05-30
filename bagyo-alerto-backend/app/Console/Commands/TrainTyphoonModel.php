<?php

namespace App\Console\Commands;

use App\Services\TyphoonMLService;
use Illuminate\Console\Command;

class TrainTyphoonModel extends Command
{
    protected $signature = 'typhoon:train';

    protected $description = 'Train the typhoon severity ML model';

    public function handle()
    {
        $this->info('Training typhoon ML model...');

        $ml = new TyphoonMLService();
        $ml->train();

        $this->info('Model trained and saved successfully!');
    }
}
