@echo off
title Neutara Technologies Ticketing - Starting...
color 0A

echo.
echo  ========================================
echo   Neutara Technologies Ticketing
echo  ========================================
echo.

:: Kill any existing process on port 8080
echo [1/4] Freeing port 8080...
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr :8080 ^| findstr LISTENING') do (
    taskkill /PID %%a /F >nul 2>&1
)
timeout /t 1 /nobreak >nul

:: Change to app directory
cd /d "C:\Users\BhanuSrikakulam\testing\jira-client"

echo [2/4] Checking PostgreSQL...
"C:\Program Files\PostgreSQL\17\bin\pg_isready.exe" -h localhost -p 5432 -U postgres >nul 2>&1
if %errorlevel% neq 0 (
    echo  WARNING: PostgreSQL is not running! Please start it first.
    pause
    exit /b 1
)
echo  PostgreSQL OK.

echo [3/4] Building production bundle (no source maps, minified)...
set NODE_OPTIONS=--max-old-space-size=4096
call npm run build
if %errorlevel% neq 0 (
    echo  Build failed. Check errors above.
    pause
    exit /b 1
)

echo [4/4] Starting production server on http://localhost:8080 ...
echo.
echo  App running at: http://localhost:8080
echo  Source code is protected and minified.
echo  Press Ctrl+C to stop.
echo.

set PORT=8080
set NODE_ENV=production
set NODE_OPTIONS=--max-old-space-size=4096
npx next start -p 8080
