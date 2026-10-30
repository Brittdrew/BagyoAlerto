<?php

namespace App\Contracts;

interface PagasaDriver
{
    public function name(): string;

    /**
     * @return array{
     *     fb_post_id: string,
     *     message: ?string,
     *     image_url: ?string,
     *     permalink_url: ?string,
     *     posted_at: \Carbon\CarbonInterface
     * }
     */
    public function fetchLatest(): array;
}
