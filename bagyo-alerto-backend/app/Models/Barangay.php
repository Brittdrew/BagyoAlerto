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
        'risk_level',
        'flood_susceptibility',
        'landslide_susceptibility',
        'hazard_source',
        'hazard_checked_at',
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

    public function evacuationCenters()
    {
        return $this->hasMany(EvacuationCenter::class);
    }

    public function recommendations()
    {
        return $this->hasMany(Recommendation::class);
    }

    public function evacuationLogs()
    {
        return $this->hasMany(EvacuationLog::class, 'origin_barangay_id');
    }
}