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
        'severity_level',
        'score',
        'classification',
        'ml_prediction',
        'barangay_id',
        'is_manual',
    ];

    protected $casts = [
        'is_manual' => 'boolean',
    ];

    public function barangay()
    {
        return $this->belongsTo(Barangay::class);
    }
}