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

echo Downloading the local audio engine...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $base='https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm'; $files=@(@{Name='ffmpeg-core.js'; Hash='67A48F11645F85439F3FDE4F2119042C16B374B910206B7A7A24F342E28DCAE3'}, @{Name='ffmpeg-core.wasm'; Hash='9F57947A5BD530D8F00C5B3F2CB2A3492FAA7E5D823315342D6A8656D0A6B7B7'}); foreach ($file in $files) { $dest=Join-Path $PWD ('runtime\' + $file.Name); Invoke-WebRequest -Uri ($base + '/' + $file.Name) -OutFile $dest; $actual=(Get-FileHash -Algorithm SHA256 -LiteralPath $dest).Hash; if ($actual -ne $file.Hash) { Remove-Item -LiteralPath $dest -Force; throw ($file.Name + ' checksum verification failed.') } }"
if errorlevel 1 (
  echo.
  echo Audio engine setup failed. Check your internet connection and try again.
  pause
  exit /b 1
)

echo.
echo RIFF is ready. Double-click Start RIFF.cmd.
pause
