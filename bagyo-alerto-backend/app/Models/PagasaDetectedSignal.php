<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class PagasaDetectedSignal extends Model
{
    public $timestamps = false;

    protected $fillable = [
        'status',
        'storm_name',
        'bulletin_no',
        'issued_at',
        'sdn_signal',
        'siargao_signal',
        'bucas_grande_signal',
        'source_url',
        'fetched_at',
        'raw_excerpt',
        'applied_at',
    ];

    protected function casts(): array
    {
        return [
            'issued_at' => 'datetime',
            'sdn_signal' => 'integer',
            'siargao_signal' => 'integer',
            'bucas_grande_signal' => 'integer',
            'fetched_at' => 'datetime',
            'applied_at' => 'datetime',
        ];
    }
}
