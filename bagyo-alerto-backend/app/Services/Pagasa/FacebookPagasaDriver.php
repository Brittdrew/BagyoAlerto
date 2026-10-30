<?php

namespace App\Services\Pagasa;

use App\Contracts\PagasaDriver;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Http;
use RuntimeException;

class FacebookPagasaDriver implements PagasaDriver
{
    public function name(): string
    {
        return 'facebook';
    }

    public function fetchLatest(): array
    {
        $config = config('services.pagasa.facebook', []);
        $version = (string) ($config['graph_version'] ?? '');
        $pageId = (string) ($config['page_id'] ?? '');
        $appId = (string) ($config['app_id'] ?? '');
        $appSecret = (string) ($config['app_secret'] ?? '');

        if ($version === '' || $pageId === '' || $appId === '') {
            throw new RuntimeException('Facebook Graph API configuration is incomplete.');
        }

        if ($appSecret === '' || $appSecret === 'PASTE_YOUR_APP_SECRET_HERE') {
            throw new RuntimeException('FB_APP_SECRET has not been configured.');
        }

        $endpoint = sprintf(
            'https://graph.facebook.com/%s/%s/posts',
            rawurlencode($version),
            rawurlencode($pageId)
        );

        $response = Http::acceptJson()
            ->connectTimeout(10)
            ->timeout(20)
            ->retry(2, 500, throw: false)
            ->get($endpoint, [
                'fields' => 'id,message,full_picture,permalink_url,created_time',
                'limit' => 1,
                'access_token' => $appId.'|'.$appSecret,
            ]);

        if (! $response->successful()) {
            $graphError = $response->json('error');
            $message = is_array($graphError)
                ? (string) ($graphError['message'] ?? 'Unknown Facebook Graph API error')
                : 'Facebook Graph API returned HTTP '.$response->status();
            $code = is_array($graphError) && isset($graphError['code'])
                ? ' (code '.$graphError['code'].')'
                : '';

            throw new RuntimeException($message.$code);
        }

        $post = $response->json('data.0');
        if (! is_array($post) || empty($post['id']) || empty($post['created_time'])) {
            throw new RuntimeException('Facebook Graph API returned no page posts.');
        }

        return [
            'fb_post_id' => (string) $post['id'],
            'message' => isset($post['message']) ? (string) $post['message'] : null,
            'image_url' => isset($post['full_picture']) ? (string) $post['full_picture'] : null,
            'permalink_url' => isset($post['permalink_url']) ? (string) $post['permalink_url'] : null,
            'posted_at' => CarbonImmutable::parse($post['created_time'])->utc(),
        ];
    }
}
