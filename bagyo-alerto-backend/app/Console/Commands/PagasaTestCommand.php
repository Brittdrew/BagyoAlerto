<?php

namespace App\Console\Commands;

use App\Contracts\PagasaDriver;
use App\Services\Pagasa\BulletinPagasaDriver;
use App\Services\Pagasa\FacebookPagasaDriver;
use Illuminate\Console\Command;
use Illuminate\Support\Str;
use Throwable;

class PagasaTestCommand extends Command
{
    protected $signature = 'pagasa:test';

    protected $description = 'Test the PAGASA bulletin and Facebook drivers once';

    public function handle(
        BulletinPagasaDriver $bulletinDriver,
        FacebookPagasaDriver $facebookDriver
    ): int {
        $working = 0;

        foreach ([$bulletinDriver, $facebookDriver] as $driver) {
            $this->newLine();
            $this->line(strtoupper($driver->name()).' DRIVER');

            if ($this->testDriver($driver)) {
                $working++;
            }
        }

        $this->newLine();
        $this->line("Working drivers: {$working}/2");

        return $working > 0 ? self::SUCCESS : self::FAILURE;
    }

    private function testDriver(PagasaDriver $driver): bool
    {
        try {
            $post = $driver->fetchLatest();
            $this->info('WORKS');
            $this->line('ID: '.$post['fb_post_id']);
            $this->line('Posted: '.$post['posted_at']->toIso8601String());
            $this->line('URL: '.($post['permalink_url'] ?? 'none'));
            $this->line('Sample: '.Str::limit(Str::squish($post['message'] ?? ''), 240));

            return true;
        } catch (Throwable $e) {
            $this->error('FAILED: '.$e->getMessage());

            return false;
        }
    }
}
