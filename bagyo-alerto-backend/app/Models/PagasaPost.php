<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class PagasaPost extends Model
{
    protected $fillable = [
        'fb_post_id',
        'message',
        'image_url',
        'permalink_url',
        'posted_at',
        'source',
        'is_active',
    ];

    protected function casts(): array
    {
        return [
            'posted_at' => 'datetime',
            'is_active' => 'boolean',
        ];
    }
}
