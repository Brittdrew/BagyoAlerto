<?php

return [
    /*
    |--------------------------------------------------------------------------
    | Evacuation Occupancy Threshold
    |--------------------------------------------------------------------------
    |
    | Percentage at which an evacuation center is considered 'almost_full'
    | (e.g. 70%). Under this threshold is 'available', 70-99% is 'almost_full',
    | and 100%+ is 'full'.
    |
    */
    'almost_full_threshold' => 70,

    /*
    |--------------------------------------------------------------------------
    | Self-Arrival GPS Radius (metres)
    |--------------------------------------------------------------------------
    |
    | Maximum distance in metres a device may be from an evacuation center
    | when submitting a self-arrival log. Submissions beyond this radius
    | are rejected with HTTP 422.
    |
    */
    'arrival_radius_meters' => 100,

    /*
    |--------------------------------------------------------------------------
    | Self-Arrival Device Cooldown (hours)
    |--------------------------------------------------------------------------
    |
    | A device_id may only self-report at the same evacuation center once
    | per this many hours. A duplicate within the window returns HTTP 409.
    |
    */
    'self_arrival_cooldown_hours' => 12,
];
