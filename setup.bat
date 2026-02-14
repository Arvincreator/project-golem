@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"
title Golem Setup Wizard (Universal)

echo ==========================================================
echo  Project Golem v8.6 - Setup Wizard
echo ==========================================================
echo.

:: 1. Check Files
echo [1/6] Checking core files...
if not exist index.js (
    echo [ERROR] index.js not found!
    echo Please make sure setup.bat is in the project folder.
    pause
    exit /b
)
echo [OK] Core files check passed.
echo.

:: 2. Check Node.js
echo [2/6] Checking Node.js environment...
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] Node.js not found. Attempting auto-install...
    echo     (Please click 'Yes' if prompted by Windows)
    winget install -e --id OpenJS.NodeJS.LTS
    
    if %errorlevel% neq 0 (
        echo [ERROR] Auto-install failed. Please install Node.js manually.
        pause
        exit /b
    )
    echo [OK] Node.js installed. Please CLOSE this window and run setup.bat again.
    pause
    exit
)
echo [OK] Node.js is ready.
echo.

:: 3. Setup .env
echo [3/6] Setting up environment (.env)...
if not exist .env (
    if exist .env.example (
        copy .env.example .env >nul
        echo [OK] Created .env from example.
    ) else (
        echo [!] .env.example not found. Skipping.
    )
) else (
    echo [OK] .env already exists.
)
echo.

:: 4. Install Dependencies
echo [4/6] Installing dependencies (npm install)...
echo     (This might take a moment...)
call npm install
echo.
echo [*] Installing Dashboard plugin...
call npm install blessed blessed-contrib
echo [OK] Dependencies installed.
echo.

:: 5. Configure Memory
echo [5/6] Configuring Memory Mode...
:: Force Browser Mode for Windows compatibility
powershell -Command "(Get-Content .env) -replace 'GOLEM_MEMORY_MODE=.*', 'GOLEM_MEMORY_MODE=browser' | Set-Content .env"
echo [OK] Configured to Browser Mode.
echo.

:: 6. Auto Patch Check
echo [6/6] Checking for patches...
if exist patch.js (
    echo [*] Patch script detected. Running patch.js...
    call node patch.js
) else (
    echo [OK] No pending patches.
)

echo.
echo ==========================================================
echo [SUCCESS] Setup Complete!
echo.
echo To start Golem, type:
echo    npm start
echo ==========================================================
pause
