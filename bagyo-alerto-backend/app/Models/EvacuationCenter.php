<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Factories\HasFactory;

class EvacuationCenter extends Model
{
    use HasFactory;
    public $timestamps = false;
    protected $table = 'evacuation_centers_list';

    protected $fillable = [
        'name',
        'barangay_id',
        'address',
        'latitude',
        'longitude',
        'capacity',
        'current_occupancy',
        'is_active',
        'flood_susceptibility',
        'landslide_susceptibility',
        'flood_point_class',
        'landslide_point_class',
        'flood_mapped_nearby',
        'landslide_mapped_nearby',
        'hazard_source',
        'hazard_checked_at',
    ];

    protected $casts = [
        'current_occupancy'        => 'integer',
        'capacity'                 => 'integer',
        'is_active'                => 'boolean',
        'flood_mapped_nearby'     => 'boolean',
        'landslide_mapped_nearby' => 'boolean',
    ];

    protected $appends = ['hazard_level'];

    /** Susceptibility rank order (ascending severity). */
    private static array $RANK = [
        'low'       => 1,
        'moderate'  => 2,
        'high'      => 3,
        'very_high' => 4,
    ];

    /**
     * Returns the worst of flood_susceptibility and landslide_susceptibility.
     * Ordering: low < moderate < high < very_high.
     * If only one is set, returns that one. If both are null, returns null.
     */
    public function getHazardLevelAttribute(): ?string
    {
        $flood     = $this->flood_susceptibility;
        $landslide = $this->landslide_susceptibility;

        if ($flood === null && $landslide === null) {
            return null;
        }
        if ($flood === null) {
            return $landslide;
        }
        if ($landslide === null) {
            return $flood;
        }

        $rankF = self::$RANK[$flood]     ?? 0;
        $rankL = self::$RANK[$landslide] ?? 0;

        return $rankF >= $rankL ? $flood : $landslide;
    }

    public function barangay()
    {
        return $this->belongsTo(Barangay::class);
    }

    public function recommendations()
    {
        return $this->hasMany(Recommendation::class);
    }

    public function evacuationLogs()
    {
        return $this->hasMany(EvacuationLog::class, 'evacuation_center_id');
    }

    public function logs()
    {
        return $this->hasMany(EvacuationLog::class, 'evacuation_center_id');
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