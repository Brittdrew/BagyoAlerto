<?php

namespace App\Services;

use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\Http;
use RuntimeException;
use Smalot\PdfParser\Config;
use Smalot\PdfParser\Parser;
use Throwable;

class PagasaBulletinService
{
    public const INDEX_URL = 'https://pubfiles.pagasa.dost.gov.ph/tamss/weather/bulletin/';

    private const MAX_PDF_BYTES = 10 * 1024 * 1024;

    private const USER_AGENT = 'BagyoAlerto PAGASA signal detector/1.0';

    /**
     * Fetch and parse the most recently modified TCB in PAGASA pubfiles.
     *
     * @return array<string, mixed>
     */
    public function detect(): array
    {
        $fetchedAt = now();

        try {
            $indexResponse = Http::withUserAgent(self::USER_AGENT)
                ->accept('text/html')
                ->connectTimeout(3)
                ->timeout(4)
                ->get(self::INDEX_URL);
        } catch (Throwable $e) {
            return $this->failureResult('fetch_failed', self::INDEX_URL, $fetchedAt, $e);
        }

        if (! $indexResponse->successful()) {
            return $this->failureResult(
                'fetch_failed',
                self::INDEX_URL,
                $fetchedAt,
                new RuntimeException("PAGASA index returned HTTP {$indexResponse->status()}")
            );
        }

        $indexHtml = $indexResponse->body();
        $latest = $this->latestBulletinFromIndex($indexHtml);

        if ($latest === null) {
            if ($this->containsNoActiveBulletinMessage($indexHtml)) {
                return $this->baseResult('no_active_bulletin', self::INDEX_URL, $fetchedAt, [
                    'raw_excerpt' => $this->excerpt($indexHtml),
                ]);
            }

            return $this->failureResult(
                'parse_failed',
                self::INDEX_URL,
                $fetchedAt,
                new RuntimeException('No Tropical Cyclone Bulletin link was found in the PAGASA index.'),
                $this->excerpt($indexHtml)
            );
        }

        try {
            $pdfResponse = Http::withUserAgent(self::USER_AGENT)
                ->accept('application/pdf')
                ->connectTimeout(3)
                ->timeout(4)
                ->get($latest['url']);
        } catch (Throwable $e) {
            return $this->failureResult('fetch_failed', $latest['url'], $fetchedAt, $e);
        }

        if (! $pdfResponse->successful()) {
            return $this->failureResult(
                'fetch_failed',
                $latest['url'],
                $fetchedAt,
                new RuntimeException("PAGASA bulletin returned HTTP {$pdfResponse->status()}")
            );
        }

        $pdfBytes = $pdfResponse->body();

        try {
            return $this->parsePdf($pdfBytes, $latest['url'], $fetchedAt);
        } catch (Throwable $e) {
            return $this->failureResult('parse_failed', $latest['url'], $fetchedAt, $e);
        }
    }

    /**
     * Parse a downloaded PAGASA bulletin PDF.
     *
     * @return array<string, mixed>
     */
    public function parsePdf(string $pdfBytes, string $sourceUrl, ?CarbonInterface $fetchedAt = null): array
    {
        if (strlen($pdfBytes) > self::MAX_PDF_BYTES) {
            throw new RuntimeException('PAGASA bulletin exceeds the 10 MB safety limit.');
        }

        if (! str_starts_with($pdfBytes, '%PDF-')) {
            throw new RuntimeException('PAGASA bulletin response is not a PDF.');
        }

        $config = new Config;
        $config->setDecodeMemoryLimit(100 * 1024 * 1024);

        $parser = new Parser([], $config);
        $text = $parser->parseContent($pdfBytes)->getText();

        return $this->parseExtractedText($text, $sourceUrl, $fetchedAt ?? now());
    }

    /**
     * Parse metadata and Surigao-area signals from extracted PDF text.
     * Matching is deliberately limited to TCWS table sections.
     *
     * @return array<string, mixed>
     */
    public function parseExtractedText(
        string $text,
        string $sourceUrl,
        ?CarbonInterface $fetchedAt = null
    ): array {
        $text = str_replace(["\r\n", "\r"], "\n", $text);
        $fetchedAt ??= now();

        if (preg_match(
            '/TROPICAL CYCLONE BULLETIN\s+N(?:R|O)\.?\s*([0-9](?:\h*[0-9])*\h*[A-Z]?)\h*\n\h*([^\n]+)/iu',
            $text,
            $header
        ) !== 1) {
            throw new RuntimeException('Tropical Cyclone Bulletin header could not be parsed.');
        }

        $bulletinNo = preg_replace('/\s+/', '', $header[1]) ?? trim($header[1]);
        $stormName = $this->parseStormName($header[2]);

        if (preg_match('/Issued(?:\s+at)?\s+([^\n]+)/iu', $text, $issueMatch) !== 1) {
            throw new RuntimeException('Bulletin issue time could not be parsed.');
        }

        $issueTimeRaw = $this->cleanText($issueMatch[1]);

        try {
            $issuedAt = CarbonImmutable::createFromFormat(
                'h:i A, d F Y',
                $issueTimeRaw,
                'Asia/Manila'
            )->utc();
        } catch (Throwable $e) {
            throw new RuntimeException("Bulletin issue time is invalid: {$issueTimeRaw}", previous: $e);
        }

        $isFinal = preg_match('/F$/i', $bulletinNo) === 1
            || preg_match('/this is the final bulletin/iu', $text) === 1;

        $sections = $this->extractTcwsSections($text);

        if ($sections === []) {
            if ($isFinal || $this->containsNoActiveBulletinMessage($text)) {
                return $this->baseResult('no_active_bulletin', $sourceUrl, $fetchedAt, [
                    'storm_name' => $stormName,
                    'bulletin_no' => $bulletinNo,
                    'issued_at' => $issuedAt,
                    'raw_excerpt' => $this->excerpt($text),
                ]);
            }

            // A non-final (active) bulletin without a readable TCWS table is
            // always a parse failure. Never silently turn this into "none".
            throw new RuntimeException('Active bulletin has no readable TCWS table section.');
        }

        $tcwsText = implode("\n", $sections);
        $explicitlyNoSignal = preg_match('/No Wind Signal is currently hoisted/iu', $tcwsText) === 1;

        if ($isFinal || $this->containsNoActiveBulletinMessage($text)) {
            return $this->baseResult('no_active_bulletin', $sourceUrl, $fetchedAt, [
                'storm_name' => $stormName,
                'bulletin_no' => $bulletinNo,
                'issued_at' => $issuedAt,
                'raw_excerpt' => $this->excerpt($tcwsText),
            ]);
        }

        $signalBlocks = $this->extractSignalBlocks($sections);

        if ($signalBlocks === [] && ! $explicitlyNoSignal) {
            throw new RuntimeException('Active bulletin TCWS table was found but its signal rows could not be parsed.');
        }

        return $this->baseResult('detected', $sourceUrl, $fetchedAt, [
            'storm_name' => $stormName,
            'bulletin_no' => $bulletinNo,
            'issued_at' => $issuedAt,
            'sdn_signal' => $this->signalFor($signalBlocks, '/\bsurigao\s+del\s+norte\b/iu'),
            'siargao_signal' => $this->signalFor($signalBlocks, '/\bsiargao\b/iu'),
            'bucas_grande_signal' => $this->signalFor(
                $signalBlocks,
                '/\bbucas\s*(?:-|\s)\s*grande\s+islands?\b/iu'
            ),
            'raw_excerpt' => $this->excerpt($tcwsText),
        ]);
    }

    /**
     * @return array{file: string, url: string, modified_at: int}|null
     */
    private function latestBulletinFromIndex(string $html): ?array
    {
        preg_match_all(
            '/<a\s+href="([^"]+)"[^>]*>\s*(TCB#[0-9]+[A-Z]?(?:-?(?:F|FINAL))?[_ -]+[^<]+?\.pdf)\s*<\/a>(?:\s+(\d{2}-[A-Za-z]{3}-\d{4}\s+\d{2}:\d{2}))?/iu',
            $html,
            $matches,
            PREG_SET_ORDER
        );

        if ($matches === []) {
            return null;
        }

        $bulletins = array_map(function (array $match): array {
            $href = html_entity_decode($match[1], ENT_QUOTES | ENT_HTML5, 'UTF-8');
            $url = preg_match('#^https?://#i', $href) === 1
                ? $href
                : rtrim(self::INDEX_URL, '/').'/'.ltrim($href, '/');

            return [
                'file' => trim($match[2]),
                'url' => $url,
                'modified_at' => isset($match[3]) ? (strtotime($match[3].' UTC') ?: 0) : 0,
            ];
        }, $matches);

        usort($bulletins, fn (array $left, array $right): int => $right['modified_at'] <=> $left['modified_at']);

        return $bulletins[0];
    }

    /**
     * @return list<string>
     */
    private function extractTcwsSections(string $text): array
    {
        preg_match_all(
            '/TROPICAL CYCLONE WIND SIGNALS\s*\(TCWS\)\s*IN EFFECT([\s\S]*?)(?=\n\s*TROPICAL CYCLONE BULLETIN\s+N(?:R|O)\.|\n\s*OTHER HAZARDS|\n\s*HAZARDS AFFECTING|\n\s*Considering these developments|\n\s*DOST-PAGASA|\z)/iu',
            $text,
            $matches
        );

        return array_values(array_filter(
            array_map(fn (string $section): string => trim($section), $matches[1] ?? []),
            fn (string $section): bool => $section !== ''
        ));
    }

    /**
     * @param  list<string>  $sections
     * @return list<array{level: int, text: string}>
     */
    private function extractSignalBlocks(array $sections): array
    {
        $blocks = [];

        foreach ($sections as $section) {
            preg_match_all(
                '/(?:^|\n)\s*([1-5])\s*\n\s*Wind threat:\s*\n[\s\S]{0,120}?\bwinds(?:\s+s)?\s*\n([\s\S]*?)\n\s*Warning lead time:/iu',
                $section,
                $matches,
                PREG_SET_ORDER
            );

            foreach ($matches as $match) {
                $blocks[] = [
                    'level' => (int) $match[1],
                    'text' => $this->cleanText($match[2]),
                ];
            }
        }

        return $blocks;
    }

    /**
     * @param  list<array{level: int, text: string}>  $blocks
     */
    private function signalFor(array $blocks, string $pattern): ?int
    {
        $levels = [];

        foreach ($blocks as $block) {
            if (preg_match($pattern, $block['text']) === 1) {
                $levels[] = $block['level'];
            }
        }

        return $levels === [] ? null : max($levels);
    }

    private function parseStormName(string $stormLine): string
    {
        $stormName = $this->cleanText($stormLine);
        $stormName = preg_replace(
            '/^(?:Tropical Depression|Tropical Storm|Severe Tropical Storm|Typhoon|Super Typhoon)\s+/iu',
            '',
            $stormName
        ) ?? $stormName;
        $stormName = preg_replace('/\s*\([^)]*\)\s*$/u', '', $stormName) ?? $stormName;

        return trim($stormName, " \t\n\r\0\x0B\"'“”");
    }

    private function cleanText(string $value): string
    {
        return trim(preg_replace('/\s+/u', ' ', str_replace("\u{FFFD}", '', $value)) ?? $value);
    }

    private function containsNoActiveBulletinMessage(string $value): bool
    {
        return preg_match(
            '/No Active Tropical Cyclone|No active tropical cyclone bulletin|There is no active tropical cyclone/iu',
            $value
        ) === 1;
    }

    private function excerpt(string $value): string
    {
        return mb_substr($this->cleanText(strip_tags($value)), 0, 4000);
    }

    /**
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    private function baseResult(
        string $status,
        ?string $sourceUrl,
        CarbonInterface $fetchedAt,
        array $overrides = []
    ): array {
        return array_merge([
            'status' => $status,
            'storm_name' => null,
            'bulletin_no' => null,
            'issued_at' => null,
            'sdn_signal' => null,
            'siargao_signal' => null,
            'bucas_grande_signal' => null,
            'source_url' => $sourceUrl,
            'fetched_at' => $fetchedAt,
            'raw_excerpt' => null,
        ], $overrides);
    }

    /**
     * @return array<string, mixed>
     */
    private function failureResult(
        string $status,
        ?string $sourceUrl,
        CarbonInterface $fetchedAt,
        Throwable $error,
        ?string $rawExcerpt = null
    ): array {
        return $this->baseResult($status, $sourceUrl, $fetchedAt, [
            'raw_excerpt' => $rawExcerpt,
            '_error' => $error->getMessage(),
        ]);
    }
}
