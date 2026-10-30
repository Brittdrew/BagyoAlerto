<?php

return [
    'ibtracs_url' => 'https://www.ncei.noaa.gov/data/international-best-track-archive-for-climate-stewardship-ibtracs/v04r01/access/csv/ibtracs.WP.list.v04r01.csv',
    'archive_url' => 'https://archive-api.open-meteo.com/v1/archive',
    'output_path' => storage_path('app/storm-data'),
    'request_delay_ms' => 350,
    'max_retries' => 5,

    'surigao_city' => [
        'latitude' => 9.7833,
        'longitude' => 125.4833,
        'maximum_distance_km' => 300,
        'first_season' => 2000,
    ],

    // Mainland points are the twelve barangay coordinates that pre-date the
    // later San Juan seed record. Island points support separate PAGASA labels.
    'points' => [
        ['name' => 'Washington', 'latitude' => 9.7843, 'longitude' => 125.4887, 'area_group' => 'mainland'],
        ['name' => 'Lipata', 'latitude' => 9.8128, 'longitude' => 125.4553, 'area_group' => 'mainland'],
        ['name' => 'Mabua', 'latitude' => 9.8098, 'longitude' => 125.4409, 'area_group' => 'mainland'],
        ['name' => 'Taft', 'latitude' => 9.7847, 'longitude' => 125.4975, 'area_group' => 'mainland'],
        ['name' => 'Bonifacio', 'latitude' => 9.7381, 'longitude' => 125.4960, 'area_group' => 'mainland'],
        ['name' => 'Rizal', 'latitude' => 9.7823, 'longitude' => 125.4633, 'area_group' => 'mainland'],
        ['name' => 'Sabang', 'latitude' => 9.7979, 'longitude' => 125.4720, 'area_group' => 'mainland'],
        ['name' => 'Day-asan', 'latitude' => 9.7697517, 'longitude' => 125.5349365, 'area_group' => 'mainland'],
        ['name' => 'Cagniog', 'latitude' => 9.7619, 'longitude' => 125.5045, 'area_group' => 'mainland'],
        ['name' => 'Togbongon', 'latitude' => 9.7612028, 'longitude' => 125.4744955, 'area_group' => 'mainland'],
        ['name' => 'Ipil', 'latitude' => 9.7922, 'longitude' => 125.4396, 'area_group' => 'mainland'],
        ['name' => 'Punta Bilar', 'latitude' => 9.822808, 'longitude' => 125.444242, 'area_group' => 'mainland'],
        ['name' => 'General Luna (Siargao)', 'latitude' => 9.7844, 'longitude' => 126.1581, 'area_group' => 'siargao_bucas'],
        ['name' => 'Bucas Grande (Socorro)', 'latitude' => 9.6219, 'longitude' => 125.9679, 'area_group' => 'siargao_bucas'],
    ],
];
