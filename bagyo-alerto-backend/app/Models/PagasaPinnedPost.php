<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class PagasaPinnedPost extends Model
{
    protected $table = 'pagasa_pinned_post';

    public $timestamps = false;

    protected $fillable = [
        'id',
        'url',
        'updated_at',
        'updated_by',
    ];

    protected function casts(): array
    {
        return [
            'updated_at' => 'datetime',
            'updated_by' => 'integer',
        ];
    }
}
