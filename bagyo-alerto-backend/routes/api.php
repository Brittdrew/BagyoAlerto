<?php

use App\Http\Controllers\AdminController;
use App\Http\Controllers\BarangayController;
use App\Http\Controllers\ChatController;
use App\Http\Controllers\CurrentRiskController;
use App\Http\Controllers\EvacuationCenterController;
use App\Http\Controllers\EvacuationLogController;
use App\Http\Controllers\PagasaDetectedController;
use App\Http\Controllers\PagasaFeedController;
use App\Http\Controllers\PagasaPinnedPostController;
use App\Http\Controllers\PagasaSignalController;
use App\Http\Controllers\RecommendationController;
use App\Http\Controllers\RouteController;
use App\Http\Controllers\RouteHazardScoreController;
use App\Http\Controllers\RouteViaCandidatesController;
use App\Http\Controllers\TyphoonController;
use Illuminate\Support\Facades\Route;

// ── Public list endpoints (responses cached 60 s inside controllers) ────────
Route::get('/pagasa-signal', [PagasaSignalController::class, 'show']);
Route::get('/pagasa-update', [PagasaDetectedController::class, 'publicUpdate']);
Route::get('/pagasa/bulletin', [PagasaDetectedController::class, 'liveBulletin']);
Route::get('/pagasa-post', [PagasaPinnedPostController::class, 'show']);
Route::get('/pagasa/latest', [PagasaFeedController::class, 'latest']);
Route::get('/pagasa/status', [PagasaFeedController::class, 'status']);
Route::get('/risk/current', [CurrentRiskController::class, 'show']);
Route::get('/barangays', [BarangayController::class, 'index']);
Route::get('/barangays/{id}', [BarangayController::class, 'show']);
Route::get('/barangays/{id}/weather', [BarangayController::class, 'weather']);
Route::get('/barangays/{id}/evacuation-target', [BarangayController::class, 'evacuationTarget']);

// IMPORTANT: literal-segment routes MUST come before wildcard /{id} routes.
// /evacuation-centers/overview  — auth required, registered first so "overview"
//   is never captured as a numeric id.
// /evacuation-centers/photo/{x} — public, same reason.
// /evacuation-centers/nearest   — public, same reason.
Route::middleware('auth:sanctum')->get('/evacuation-centers/overview', [EvacuationLogController::class, 'overview']);
Route::get('/evacuation-centers/photo/{barangay_name}', [EvacuationCenterController::class, 'getPhotoByBarangay']);
Route::get('/evacuation-centers/nearest', [EvacuationCenterController::class, 'nearest']);
Route::get('/evacuation-centers', [EvacuationCenterController::class, 'index']);
Route::get('/evacuation-centers/{id}', [EvacuationCenterController::class, 'show']);

Route::get('/route', [RouteController::class, 'show']);
Route::middleware('throttle:30,1')->post('/route-hazard-score', [RouteHazardScoreController::class, 'score']);
Route::middleware('throttle:30,1')->post('/route-via-candidates', [RouteViaCandidatesController::class, 'candidates']);

Route::middleware('throttle:20,1')->post('/typhoon/assess', [TyphoonController::class, 'assess']);

// Public GPS self-arrival — no auth required, rate-limited to 10 req/min
Route::middleware('throttle:10,1')->post(
    '/evacuation-centers/{centerId}/self-arrival',
    [EvacuationLogController::class, 'selfArrival']
);

Route::get('/recommendations', [RecommendationController::class, 'index']);
Route::post('/recommendations', [RecommendationController::class, 'store']);
Route::middleware(['auth:sanctum', 'role:super_admin'])
    ->delete('/recommendations/{id}', [RecommendationController::class, 'destroy']);

// Chat Q&A endpoint
Route::middleware(['auth:sanctum', 'throttle:30,1'])->post('/chat', [ChatController::class, 'ask']);
Route::get('/chat/history', [ChatController::class, 'history']);
Route::get('/chat/history/{barangay}', [ChatController::class, 'historyByBarangay']);
Route::middleware(['auth:sanctum', 'role:super_admin'])->group(function () {
    Route::delete('/chat/history/{id}', [ChatController::class, 'deleteLog']);
    Route::delete('/chat/history', [ChatController::class, 'clearHistory']);
});

// Admin authentication (no auth middleware)
Route::post('/admin/login', [AdminController::class, 'login']);

// ── Admin routes (auth:sanctum + /admin prefix) ─────────────────────────────
Route::middleware('auth:sanctum')->prefix('admin')->group(function () {
    Route::post('/logout', [AdminController::class, 'logout']);
    Route::get('/me', [AdminController::class, 'me']);
    Route::get('/stats', [AdminController::class, 'stats']);
    Route::get('/recommendations', [AdminController::class, 'recommendations']);
    Route::get('/hazard-map', [AdminController::class, 'hazardMap']);

    Route::post('/pagasa-signal', [PagasaSignalController::class, 'store']);
    Route::get('/pagasa-detected', [PagasaDetectedController::class, 'show']);

    Route::get('/barangays', [AdminController::class, 'barangaysIndex']);

    Route::get('/evacuation-centers', [AdminController::class, 'evacuationCentersIndex']);

    Route::put('/password', [AdminController::class, 'changePassword']);

    Route::middleware('role:super_admin')->group(function () {
        Route::post('/pagasa-post', [PagasaPinnedPostController::class, 'store']);

        Route::post('/barangays', [AdminController::class, 'barangaysStore']);
        Route::put('/barangays/{id}', [AdminController::class, 'barangaysUpdate']);
        Route::delete('/barangays/{id}', [AdminController::class, 'barangaysDestroy']);

        Route::post('/evacuation-centers', [AdminController::class, 'evacuationCentersStore']);
        Route::put('/evacuation-centers/{id}', [AdminController::class, 'evacuationCentersUpdate']);
        Route::delete('/evacuation-centers/{id}', [AdminController::class, 'evacuationCentersDestroy']);
        Route::post('/evacuation-centers/photo', [AdminController::class, 'uploadEvacuationCenterPhoto']);
        Route::delete('/evacuation-centers/photo/{barangay_name}', [AdminController::class, 'deleteEvacuationCenterPhoto']);

        Route::get('/accounts', [AdminController::class, 'adminAccounts']);
        Route::post('/accounts', [AdminController::class, 'storeAdminAccount']);
        Route::put('/accounts/{id}/role', [AdminController::class, 'updateAdminRole']);
        Route::delete('/accounts/{id}', [AdminController::class, 'destroyAdminAccount']);
    });

    // Admin evacuation log and occupancy routes
    Route::post('/evacuation-centers/{centerId}/logs', [EvacuationLogController::class, 'store']);
    Route::get('/evacuation-centers/{centerId}/logs', [EvacuationLogController::class, 'index']);
    Route::get('/evacuation-centers/{id}/occupancy', [EvacuationLogController::class, 'occupancy']);
    Route::delete('/evacuation-centers/{centerId}/logs/{id?}', [EvacuationLogController::class, 'destroy']);
    Route::post('/evacuation-logs', [EvacuationLogController::class, 'store']);
    Route::get('/evacuation-logs', [EvacuationLogController::class, 'index']);
    Route::delete('/evacuation-logs/{id}', [EvacuationLogController::class, 'destroy']);
    Route::get('/barangays/{id}/evacuees', [EvacuationLogController::class, 'barangayEvacuees']);
});

// ── Non-prefixed auth:sanctum evacuation routes ──────────────────────────────
Route::middleware('auth:sanctum')->group(function () {
    Route::post('/evacuation-centers/{centerId}/logs', [EvacuationLogController::class, 'store']);
    Route::get('/evacuation-centers/{centerId}/logs', [EvacuationLogController::class, 'index']);
    Route::get('/evacuation-centers/{id}/occupancy', [EvacuationLogController::class, 'occupancy']);
    Route::delete('/evacuation-centers/{centerId}/logs/{id?}', [EvacuationLogController::class, 'destroy']);

    Route::post('/evacuation-logs', [EvacuationLogController::class, 'store']);
    Route::get('/evacuation-logs', [EvacuationLogController::class, 'index']);
    Route::delete('/evacuation-logs/{id}', [EvacuationLogController::class, 'destroy']);

    Route::get('/barangays/{id}/evacuees', [EvacuationLogController::class, 'barangayEvacuees']);
});
