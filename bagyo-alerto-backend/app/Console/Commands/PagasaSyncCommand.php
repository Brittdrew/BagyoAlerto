<?php

namespace App\Console\Commands;

use App\Services\PagasaFeedService;
use Illuminate\Console\Command;

class PagasaSyncCommand extends Command
{
    protected $signature = 'pagasa:sync';

    protected $description = 'Sync the latest official PAGASA post or bulletin';

    public function handle(PagasaFeedService $feed): int
    {
        $result = $feed->sync();

        if (! $result['success']) {
            $this->error('PAGASA sync failed: '.$result['error']);

            return self::FAILURE;
        }

        $post = $result['post'];
        $action = $post?->wasRecentlyCreated ? 'inserted' : 'already stored';
        $fallback = $result['fallback'] ? ' (Facebook fallback)' : '';
        $this->info(sprintf(
            'PAGASA sync succeeded via %s%s; post %s: %s',
            $result['driver'],
            $fallback,
            $action,
            $post?->fb_post_id ?? 'unknown'
        ));

        return self::SUCCESS;
    }
}
