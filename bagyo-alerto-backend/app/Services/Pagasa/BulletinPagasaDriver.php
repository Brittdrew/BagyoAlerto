<?php

namespace App\Services\Pagasa;

use App\Contracts\PagasaDriver;
use App\Services\PagasaBulletinService;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use DOMDocument;
use DOMElement;
use DOMXPath;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use RuntimeException;
use Throwable;

class BulletinPagasaDriver implements PagasaDriver
{
    private const USER_AGENT = 'Bakwit PAGASA feed sync/1.0';

    public function __construct(private readonly PagasaBulletinService $pdfParser) {}

    public function name(): string
    {
        return 'bulletin';
    }

    public function fetchLatest(): array
    {
        $pageUrl = (string) config('services.pagasa.bulletin_url');
        if ($pageUrl === '') {
            throw new RuntimeException('PAGASA bulletin URL is not configured.');
        }

        $response = Http::withUserAgent(self::USER_AGENT)
            ->accept('text/html')
            ->connectTimeout(10)
            ->timeout(30)
            ->retry(2, 750, throw: false)
            ->get($pageUrl);

        if (! $response->successful()) {
            throw new RuntimeException('PAGASA bulletin page returned HTTP '.$response->status().'.');
        }

        $html = $response->body();
        $activeHtml = preg_split('/>\s*Archive\s*</iu', $html, 2)[0] ?? $html;
        $links = $this->bulletinLinks($activeHtml, $pageUrl);
        if ($links === []) {
            $links = $this->bulletinLinks($html, $pageUrl);
        }

        if ($links === []) {
            throw new RuntimeException('No Tropical Cyclone Bulletin link was found on the PAGASA page.');
        }

        $latest = $links[array_key_last($links)];
        $metadata = $this->pdfMetadata($latest['url']);
        $postedAt = $metadata['issued_at']
            ?? $this->parseLastModified($response->header('Last-Modified'))
            ?? now();

        $bulletinNo = $metadata['bulletin_no'] ?? $latest['bulletin_no'];
        $stormName = $metadata['storm_name'] ?? $latest['storm_name'];
        $title = trim(sprintf(
            'PAGASA Tropical Cyclone Bulletin%s%s',
            $bulletinNo ? ' #'.$bulletinNo : '',
            $stormName ? ' — '.$stormName : ''
        ));
        $summary = $metadata['raw_excerpt'] ?? $latest['summary'];
        $message = $summary ? $title."\n\n".Str::limit(Str::squish($summary), 1500) : $title;

        return [
            'fb_post_id' => 'bulletin:'.hash('sha256', $latest['url']),
            'message' => $message,
            'image_url' => $latest['image_url'],
            'permalink_url' => $latest['url'],
            'posted_at' => $postedAt,
        ];
    }

    /**
     * @return list<array{url: string, bulletin_no: ?string, storm_name: ?string, summary: ?string, image_url: ?string}>
     */
    private function bulletinLinks(string $html, string $pageUrl): array
    {
        $document = new DOMDocument;
        $previous = libxml_use_internal_errors(true);
        $loaded = $document->loadHTML($html, LIBXML_NOWARNING | LIBXML_NOERROR | LIBXML_NONET);
        libxml_clear_errors();
        libxml_use_internal_errors($previous);

        if (! $loaded) {
            throw new RuntimeException('PAGASA bulletin page HTML could not be parsed.');
        }

        $xpath = new DOMXPath($document);
        $anchors = $xpath->query('//a[@href]');
        $links = [];

        foreach ($anchors ?: [] as $anchor) {
            if (! $anchor instanceof DOMElement) {
                continue;
            }

            $href = html_entity_decode($anchor->getAttribute('href'), ENT_QUOTES | ENT_HTML5);
            $label = Str::squish($anchor->textContent);
            if (preg_match('/TCB(?:#|%23)?\s*([0-9]+[A-Z]?).*?\.pdf/iu', $href.' '.$label, $match) !== 1) {
                continue;
            }

            $url = $this->absoluteUrl($href, $pageUrl);
            $stormName = null;
            if (preg_match('/TCB(?:#|%23)?\s*[0-9]+[A-Z]?[_ -]+([^.?\/]+)\.pdf/iu', $href, $stormMatch) === 1) {
                $stormName = Str::upper(str_replace(['_', '-'], ' ', trim($stormMatch[1])));
            }

            $context = $this->nearestContext($anchor);
            $links[] = [
                'url' => $url,
                'bulletin_no' => Str::upper($match[1]),
                'storm_name' => $stormName,
                'summary' => $context['summary'],
                'image_url' => $context['image_url']
                    ? $this->absoluteUrl($context['image_url'], $pageUrl)
                    : null,
            ];
        }

        return $links;
    }

    /**
     * @return array{summary: ?string, image_url: ?string}
     */
    private function nearestContext(DOMElement $anchor): array
    {
        $node = $anchor->parentNode;
        $summary = null;
        $imageUrl = null;

        for ($depth = 0; $node instanceof DOMElement && $depth < 3; $depth++, $node = $node->parentNode) {
            $text = Str::squish($node->textContent);
            if ($text !== '' && mb_strlen($text) <= 2500) {
                $summary = $text;
            }

            $images = (new DOMXPath($node->ownerDocument))->query('.//img[@src]', $node);
            $image = $images?->item(0);
            if ($image instanceof DOMElement) {
                $imageUrl = $image->getAttribute('src');
                break;
            }
        }

        return [
            'summary' => $summary,
            'image_url' => $imageUrl ?: null,
        ];
    }

    /**
     * @return array{storm_name?: ?string, bulletin_no?: ?string, issued_at?: ?CarbonInterface, raw_excerpt?: ?string}
     */
    private function pdfMetadata(string $url): array
    {
        try {
            $response = Http::withUserAgent(self::USER_AGENT)
                ->accept('application/pdf')
                ->connectTimeout(10)
                ->timeout(30)
                ->retry(2, 750, throw: false)
                ->get($url);

            if (! $response->successful()) {
                return [];
            }

            return $this->pdfParser->parsePdf($response->body(), $url);
        } catch (Throwable $e) {
            Log::debug('PAGASA bulletin PDF metadata fallback failed.', [
                'source_url' => $url,
                'error' => $e->getMessage(),
            ]);

            return [];
        }
    }

    private function parseLastModified(?string $value): ?CarbonImmutable
    {
        if (! $value) {
            return null;
        }

        try {
            return CarbonImmutable::parse($value)->utc();
        } catch (Throwable) {
            return null;
        }
    }

    private function absoluteUrl(string $url, string $baseUrl): string
    {
        if (preg_match('#^https?://#i', $url) === 1) {
            return $url;
        }

        $base = parse_url($baseUrl);
        $origin = ($base['scheme'] ?? 'https').'://'.($base['host'] ?? 'www.pagasa.dost.gov.ph');
        if (str_starts_with($url, '//')) {
            return ($base['scheme'] ?? 'https').':'.$url;
        }

        if (str_starts_with($url, '/')) {
            return $origin.$url;
        }

        $path = $base['path'] ?? '/';

        return $origin.rtrim(dirname($path), '/').'/'.ltrim($url, '/');
    }
}
