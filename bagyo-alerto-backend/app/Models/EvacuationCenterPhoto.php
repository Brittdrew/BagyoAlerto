<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class EvacuationCenterPhoto extends Model
{
    protected $table = 'evacuation_centers';

    protected $fillable = [
        'barangay_name',
        'image_path',
    ];

    public $timestamps = false;
}
