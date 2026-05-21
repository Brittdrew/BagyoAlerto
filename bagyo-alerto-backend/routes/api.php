<?php

use Illuminate\Support\Facades\Route;
use App\Http\Controllers\BarangayController;
use App\Http\Controllers\EvacuationCenterController;
use App\Http\Controllers\TyphoonController;
use App\Http\Controllers\RecommendationController;
use App\Http\Controllers\AdminController;

Route::get('/barangays', [BarangayController::class, 'index']);
Route::get('/barangays/{id}', [BarangayController::class, 'show']);

Route::get('/evacuation-centers', [EvacuationCenterController::class, 'index']);
Route::get('/evacuation-centers/{id}', [EvacuationCenterController::class, 'show']);

Route::post('/typhoon/assess', [TyphoonController::class, 'assess']);

Route::get('/recommendations', [RecommendationController::class, 'index']);
Route::post('/recommendations', [RecommendationController::class, 'store']);
Route::delete('/recommendations/{id}', [RecommendationController::class, 'destroy']);

// Admin authentication
Route::post('/admin/login', [AdminController::class, 'login']);
Route::get('/admin/stats/stream', [AdminController::class, 'statsStream']);

Route::middleware('auth:sanctum')->prefix('admin')->group(function () {
    Route::post('/logout', [AdminController::class, 'logout']);
    Route::get('/me', [AdminController::class, 'me']);
    Route::put('/password', [AdminController::class, 'changePassword']);
    Route::get('/stats', [AdminController::class, 'stats']);
    Route::get('/recommendations', [AdminController::class, 'recommendations']);

    Route::get('/barangays', [AdminController::class, 'barangaysIndex']);
    Route::post('/barangays', [AdminController::class, 'barangaysStore']);
    Route::put('/barangays/{id}', [AdminController::class, 'barangaysUpdate']);
    Route::delete('/barangays/{id}', [AdminController::class, 'barangaysDestroy']);

    Route::get('/evacuation-centers', [AdminController::class, 'evacuationCentersIndex']);
    Route::post('/evacuation-centers', [AdminController::class, 'evacuationCentersStore']);
    Route::put('/evacuation-centers/{id}', [AdminController::class, 'evacuationCentersUpdate']);
    Route::delete('/evacuation-centers/{id}', [AdminController::class, 'evacuationCentersDestroy']);
});