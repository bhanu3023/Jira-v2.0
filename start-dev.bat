@echo off
title Neutara - DEV MODE (Internal Use Only)
color 0E

echo  [DEV MODE] Starting with hot-reload on http://localhost:8080
echo  WARNING: Source code visible in DevTools. Use start.bat for production.
echo.

cd /d "C:\Users\BhanuSrikakulam\testing\jira-client"

for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr :8080 ^| findstr LISTENING') do (
    taskkill /PID %%a /F >nul 2>&1
)

set PORT=8080
set NODE_OPTIONS=--max-old-space-size=4096
npm run dev
