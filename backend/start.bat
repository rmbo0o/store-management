@echo off
echo ========================================
echo Starting Store Management System
echo ========================================
echo.

echo Starting Backend Server...
start cmd /k "node server.js"

timeout /t 2 /nobreak > nul

echo Starting Web Server...
start cmd /k "cd frontend && http-server -p 8080 --cors"

echo.
echo ========================================
echo System Started Successfully!
echo ========================================
echo.
echo Backend: http://localhost:3000
echo Website: http://localhost:8080
echo.
echo Open your browser and go to: http://localhost:8080
echo.
pause