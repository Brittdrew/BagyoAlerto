<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Factories\HasFactory;

class EvacuationCenter extends Model
{
    use HasFactory;
    public $timestamps = false;

    protected $fillable = [
        'name',
        'barangay_id',
        'address',
        'latitude',
        'longitude',
        'capacity',
        'is_active'
    ];

    public function barangay()
    {
        return $this->belongsTo(Barangay::class);
    }

    public function recommendations()
    {
        return $this->hasMany(Recommendation::class);
    }

    /**
     * Calculate the distance in kilometers to a given latitude and longitude using the Haversine formula.
     */
    public function getDistanceTo($latitude, $longitude)
    {
        $earthRadius = 6371; // in kilometers

        $lat1Rad = deg2rad($this->latitude);
        $lon1Rad = deg2rad($this->longitude);
        $lat2Rad = deg2rad($latitude);
        $lon2Rad = deg2rad($longitude);

        $deltaLat = $lat2Rad - $lat1Rad;
        $deltaLon = $lon2Rad - $lon1Rad;

        $a = sin($deltaLat / 2) * sin($deltaLat / 2) +
             cos($lat1Rad) * cos($lat2Rad) *
             sin($deltaLon / 2) * sin($deltaLon / 2);

        $c = 2 * atan2(sqrt($a), sqrt(1 - $a));

        return $earthRadius * $c;
    }
}