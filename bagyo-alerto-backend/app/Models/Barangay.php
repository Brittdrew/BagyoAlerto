<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Factories\HasFactory;

class Barangay extends Model
{
    use HasFactory;
    public $timestamps = false;

    protected $fillable = [
        'name',
        'city',
        'latitude',
        'longitude',
        'risk_level'
    ];

    public function evacuationCenters()
    {
        return $this->hasMany(EvacuationCenter::class);
    }

    public function recommendations()
    {
        return $this->hasMany(Recommendation::class);
    }
}