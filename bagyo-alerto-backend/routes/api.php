<?php

use Illuminate\Support\Facades\Route;
use App\Http\Controllers\BarangayController;
use App\Http\Controllers\EvacuationCenterController;
use App\Http\Controllers\TyphoonController;
use App\Http\Controllers\RecommendationController;

Route::get('/barangays', [BarangayController::class, 'index']);
Route::get('/barangays/{id}', [BarangayController::class, 'show']);

Route::get('/evacuation-centers', [EvacuationCenterController::class, 'index']);
Route::get('/evacuation-centers/{id}', [EvacuationCenterController::class, 'show']);

Route::post('/typhoon/assess', [TyphoonController::class, 'assess']);

Route::get('/recommendations', [RecommendationController::class, 'index']);
Route::post('/recommendations', [RecommendationController::class, 'store']);
Route::delete('/recommendations/{id}', [RecommendationController::class, 'destroy']);