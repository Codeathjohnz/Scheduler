@echo off
title ADSSU Scheduling System
echo Starting ADSSU Room Scheduling System...

REM Build the React frontend first (only needed after code changes)
REM Comment this out for faster startup if nothing changed in the client:
cd /d "%~dp0client"
call npm run build
if errorlevel 1 (
  echo [ERROR] Frontend build failed. Check client/src for errors.
  pause
  exit /b 1
)

REM Start the server (serves both API and the built frontend)
cd /d "%~dp0server"
echo.
echo Server starting on http://localhost:5000
echo Press Ctrl+C to stop.
echo.
node server.js
pause
