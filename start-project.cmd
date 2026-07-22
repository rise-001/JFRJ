@echo off
setlocal
cd /d "%~dp0"

where node.exe >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js was not found. Install Node.js 22.5 or newer first.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing dependencies...
  call npm.cmd install
  if errorlevel 1 goto :failed
)

if not exist "dist\index.html" (
  echo Building the application...
  call npm.cmd run build
  if errorlevel 1 goto :failed
)

echo.
echo Starting Qingying at http://127.0.0.1:3000
echo Keep this window open. Press Ctrl+C to stop the server.
echo.
call npm.cmd start
exit /b %errorlevel%

:failed
echo.
echo [ERROR] Project startup failed.
pause
exit /b 1
