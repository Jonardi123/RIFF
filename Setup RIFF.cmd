@echo off
setlocal
title RIFF Setup
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js 22 or newer is required.
  echo Install it from https://nodejs.org/ and run this setup again.
  pause
  exit /b 1
)

if not exist "runtime" mkdir "runtime"
echo Downloading yt-dlp 2026.08.19...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $url='https://github.com/yt-dlp/yt-dlp/releases/download/2026.08.19/yt-dlp.exe'; $dest=Join-Path $PWD 'runtime\yt-dlp.exe'; Invoke-WebRequest -Uri $url -OutFile $dest; $expected='66674953FE0911E41B658259B962FB666C856FF85AD9C6CE1FA83515BBA57611'; $actual=(Get-FileHash -Algorithm SHA256 -LiteralPath $dest).Hash; if ($actual -ne $expected) { Remove-Item -LiteralPath $dest -Force; throw 'yt-dlp checksum verification failed.' }"
if errorlevel 1 (
  echo.
  echo Setup failed. Check your internet connection and try again.
  pause
  exit /b 1
)

echo.
echo RIFF is ready. Double-click Start RIFF.cmd.
pause
