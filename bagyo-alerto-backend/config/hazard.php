<?php

return [
    /*
    |--------------------------------------------------------------------------
    | GeoRisk / MGB Hazard WMS Configuration
    |--------------------------------------------------------------------------
    */

    'base_url' => env('HAZARD_BASE_URL', 'https://ulap-hazards.georisk.gov.ph/arcgis/services/MGBPublic'),

    // Bounding-box half-window in decimal degrees (~55 m)
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
];
