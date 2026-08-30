@echo off
setlocal
title RIFF - YouTube to MP3
cd /d "%~dp0"
if exist "runtime\node.exe" (
  "runtime\node.exe" "server.mjs"
) else (
  where node >nul 2>&1
  if errorlevel 1 (
    echo Node.js 22 or newer is required.
    echo Install it from https://nodejs.org/ and try again.
    pause
    exit /b 1
  )
  node "server.mjs"
)
if errorlevel 1 (
  echo.
  echo RIFF could not start. Run Setup RIFF.cmd and try again.
  pause
)
