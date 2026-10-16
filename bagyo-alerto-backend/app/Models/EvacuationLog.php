<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class EvacuationLog extends Model
{
    use HasFactory;

    protected $table = 'evacuation_logs';

    protected $fillable = [
        'evacuation_center_id',
        'origin_barangay_id',
        'type',
        'headcount',
        'recorded_by',
    ];

    protected $casts = [
        'evacuation_center_id' => 'integer',
        'origin_barangay_id' => 'integer',
        'headcount' => 'integer',
        'recorded_by' => 'integer',
    ];

    public function evacuationCenter()
    {
        return $this->belongsTo(EvacuationCenter::class, 'evacuation_center_id');
    }

    public function originBarangay()
    {
        return $this->belongsTo(Barangay::class, 'origin_barangay_id');
    }

    public function recordedBy()
    {
        return $this->belongsTo(Admin::class, 'recorded_by');
    }

    public function admin()
    {
        return $this->belongsTo(Admin::class, 'recorded_by');
    }
}
