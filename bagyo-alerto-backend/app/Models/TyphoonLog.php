<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class TyphoonLog extends Model
{
    public $timestamps = false;
    
    protected $fillable = [
        'wind_speed',
        'rainfall',
        'pressure',
        'temperature',
        'humidity',
        'severity_level'
    ];
}