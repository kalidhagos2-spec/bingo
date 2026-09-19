@echo off
rem Starts everything USA Bingo needs on this PC: Docker Desktop, the four containers
rem (database, game server, web app, Telegram bot) and the ngrok tunnel to the web app.
rem Double-click it after a reboot. Safe to run again: whatever is already up is left alone.
setlocal
cd /d "%~dp0"
set TUNNEL=gilled-velvet-canola.ngrok-free.dev

docker info >nul 2>&1
if errorlevel 1 (
  echo Starting Docker Desktop...
  start "" "%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
  :waitdocker
  timeout /t 5 /nobreak >nul
  docker info >nul 2>&1
  if errorlevel 1 goto waitdocker
)

echo Starting the containers...
docker compose up -d --wait
if errorlevel 1 (
  echo.
  echo The containers did not start. Read the messages above.
  pause
  exit /b 1
)

tasklist /fi "imagename eq ngrok.exe" | find /i "ngrok.exe" >nul
if errorlevel 1 (
  echo Starting the ngrok tunnel...
  start "ngrok - USA Bingo (keep this window open)" /min ngrok http --url %TUNNEL% 127.0.0.1:8080
) else (
  echo ngrok is already running.
)

echo.
echo USA Bingo is up:  https://%TUNNEL%
echo Admin panel:      https://%TUNNEL%/api/admin/dashboard
echo Keep the laptop plugged in: on battery it goes to sleep and the game goes offline.
timeout /t 8 >nul
