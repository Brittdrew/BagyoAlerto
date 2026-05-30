@echo off
title BagyoAlerto Suite Starter
echo ===================================================
echo           BagyoAlerto Launcher & Setup
echo ===================================================
echo.

:: 1. Ensure Ollama is running and add to temporary PATH for this script session
set "OLLAMA_PATH=%LOCALAPPDATA%\Programs\Ollama"
if exist "%OLLAMA_PATH%\ollama.exe" (
    set "PATH=%PATH%;%OLLAMA_PATH%"
)

echo [1/4] Checking Ollama service...
tasklist /fi "imagename eq ollama.exe" 2>NUL | find /i /n "ollama.exe" >NUL
if "%ERRORLEVEL%"=="0" (
    echo  - Ollama is already running.
) else (
    echo  - Starting Ollama daemon in background...
    if exist "%OLLAMA_PATH%\ollama.exe" (
        start "" "%OLLAMA_PATH%\ollama.exe" serve
    ) else (
        echo  - Warning: ollama.exe not found in default local directory. Starting system command...
        start "" ollama serve
    )
    timeout /t 3 >nul
)

:: 2. Start Laravel Backend
echo [2/4] Starting Laravel Backend (PHP Artisan Serve)...
cd /d "%~dp0\bagyo-alerto-backend"
start "BagyoAlerto Backend Server" cmd /k "php artisan serve"

:: 3. Start Frontend (React/Vite)
echo [3/4] Starting Frontend (NPM Run Dev)...
cd /d "%~dp0\bagyo-alerto-frontend"
start "BagyoAlerto Frontend Web" cmd /k "npm run dev"

:: 4. Launch Browser
echo [4/4] Opening Web App in your browser...
timeout /t 3 >nul
start http://localhost:5173

echo.
echo ===================================================
echo All services launched! You can close this launcher.
echo Keep the other command windows open while testing.
echo ===================================================
timeout /t 5 >nul
