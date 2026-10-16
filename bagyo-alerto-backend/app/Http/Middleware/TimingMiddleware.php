<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\Response;

/**
 * TimingMiddleware
 *
 * Logs per-request timing and DB stats to the Laravel log channel.
 * Attach to bootstrap/app.php api() prepend list, measure, then REMOVE.
 *
 * Log format (single line):
 *   [TIMING] METHOD /path | total=XXms | db_queries=N | db_time=XXms
 */
class TimingMiddleware
{
    public function handle(Request $request, Closure $next): Response
    {
        $startMs = microtime(true) * 1000;

        // Enable per-query listener
        $queryLog = [];
        DB::listen(function ($query) use (&$queryLog) {
            $queryLog[] = $query->time; // ms
        });

        $response = $next($request);

        $totalMs   = round(microtime(true) * 1000 - $startMs, 2);
        $dbCount   = count($queryLog);
        $dbMs      = round(array_sum($queryLog), 2);

        Log::channel('single')->info(sprintf(
            '[TIMING] %s %s | total=%sms | db_queries=%d | db_time=%sms',
            $request->method(),
            $request->path(),
            $totalMs,
            $dbCount,
            $dbMs
        ));

        return $response;
    }
}
