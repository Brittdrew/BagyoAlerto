<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ChatLog extends Model
{
    protected $fillable = [
        'barangay_name',
        'question',
        'answer',
        'severity',
        'wind',
        'rainfall',
        'pressure',
        'temperature',
        'humidity',
        'asked_by',
    ];
}
