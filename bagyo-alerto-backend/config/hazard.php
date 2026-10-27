<?php

return [
    /*
    |--------------------------------------------------------------------------
    | GeoRisk / MGB Hazard WMS Configuration
    |--------------------------------------------------------------------------
    */

    'base_url' => env('HAZARD_BASE_URL', 'https://ulap-hazards.georisk.gov.ph/arcgis/services/MGBPublic'),

    // Bounding-box half-window in decimal degrees (~55 m) for point queries
    'half_window' => 0.0005,

    'services' => [
        'flood' => [
            'path'     => 'Flood',
            'layer'    => '0',
            'property' => 'Flood Susceptibility',
        ],
        'landslide' => [
            'path'     => 'RainInducedLandslide',
            'layer'    => '0',
            'property' => 'RIL Susceptibility',
        ],
    ],

    /*
    |--------------------------------------------------------------------------
    | Precomputed Hazard Grid Settings
    |--------------------------------------------------------------------------
    */
    'grid' => [
        'cell_size_m'  => 25.0,
        'margin_m'     => 5000.0,
        'chunk_limit'  => 1000,
        'storage_path' => storage_path('app/hazard-grid'),
        'debug_path'   => storage_path('app/hazard-debug'),
        'tolerance'    => 80, // Euclidean distance in RGB color space
    ],

    /*
    |--------------------------------------------------------------------------
    | Hazard Severity Weights for Route Exposure Index
    | low = 0, moderate = 1, high = 3, very_high = 5
    |--------------------------------------------------------------------------
    */
    'weights' => [
        'none'      => 0,
        'low'       => 0,
        'moderate'  => 1,
        'high'      => 3,
        'very_high' => 5,
        0           => 0,
        1           => 0,
        2           => 1,
        3           => 3,
        4           => 5,
    ],

    /*
    |--------------------------------------------------------------------------
    | Class Definitions
    | 0=none/unknown, 1=low, 2=moderate, 3=high, 4=very_high
    |--------------------------------------------------------------------------
    */
    'classes' => [
        0 => 'none',
        1 => 'low',
        2 => 'moderate',
        3 => 'high',
        4 => 'very_high',
    ],

    'class_values' => [
        'none'      => 0,
        'low'       => 1,
        'moderate'  => 2,
        'high'      => 3,
        'very_high' => 4,
    ],

    /*
    |--------------------------------------------------------------------------
    | MGB Legend Color Palette for Classification
    |--------------------------------------------------------------------------
    */
    'colors' => [
        'flood' => [
            4 => ['name' => 'very_high', 'hex' => '#002673', 'r' => 0,   'g' => 38,  'b' => 115],
            3 => ['name' => 'high',      'hex' => '#5900ff', 'r' => 89,  'g' => 0,   'b' => 255],
            2 => ['name' => 'moderate',  'hex' => '#b045ff', 'r' => 176, 'g' => 69,  'b' => 255],
            1 => ['name' => 'low',       'hex' => '#e3d1ff', 'r' => 227, 'g' => 209, 'b' => 255],
        ],
        'landslide' => [
            4 => ['name' => 'very_high', 'hex' => '#902400', 'r' => 144, 'g' => 36,  'b' => 0],
            3 => ['name' => 'high',      'hex' => '#ff0000', 'r' => 255, 'g' => 0,   'b' => 0],
            2 => ['name' => 'moderate',  'hex' => '#008000', 'r' => 0,   'g' => 128, 'b' => 0],
            1 => ['name' => 'low',       'hex' => '#ffff00', 'r' => 255, 'g' => 255, 'b' => 0],
        ],
    ],
];
