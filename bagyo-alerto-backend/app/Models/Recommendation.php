<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Recommendation extends Model
{
    public $timestamps = false;

    protected $fillable = [
        'barangay_id',
        'evacuation_center_id',
        'typhoon_log_id'
    ];

    public function barangay()
    {
        return $this->belongsTo(Barangay::class);
    }

    public function evacuationCenter()
    {
        return $this->belongsTo(EvacuationCenter::class);
    }

    public function typhoonLog()
    {
        return $this->belongsTo(TyphoonLog::class);
    }
}