<?php

use App\Models\PagasaSignal;

return [
    /*
    |--------------------------------------------------------------------------
    | PAGASA Signal Floors
    |--------------------------------------------------------------------------
    |
    | Maps PAGASA typhoon signals (0-5) to minimum severity floors:
    |   0 => none, 1 => high, 2 => high, 3 => critical,
    |   4 => catastrophic, 5 => catastrophic
    |
    */
    'signal_floors' => PagasaSignal::PAGASA_SIGNAL_FLOORS,
    'PAGASA_SIGNAL_FLOORS' => PagasaSignal::PAGASA_SIGNAL_FLOORS,

    /*
    |--------------------------------------------------------------------------
    | Severity Order
    |--------------------------------------------------------------------------
    |
    | Defines the hierarchy of severity levels for comparison.
    |
    */
    'severity_order' => PagasaSignal::SEVERITY_ORDER,
];
