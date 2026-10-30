<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class PagasaSyncStatus extends Model
{
    protected $table = 'pagasa_sync_status';

    public $timestamps = false;

    protected $fillable = [
        'id',
        'last_success_at',
        'last_error',
        'last_error_at',
        'failure_started_at',
        'updated_at',
    ];

    protected function casts(): array
    {
        return [
            'last_success_at' => 'datetime',
            'last_error_at' => 'datetime',
            'failure_started_at' => 'datetime',
            'updated_at' => 'datetime',
        ];
    }
}
