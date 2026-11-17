@echo off
title PocketWMS Expo Mobile App
cd /d "%~dp0mobile"
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /R /C:"IPv4 Address"') do (
    for /f "tokens=* delims= " %%b in ("%%a") do set LAN_IP=%%b
)
if not defined LAN_IP set LAN_IP=127.0.0.1
set EXPO_PUBLIC_API_URL=http://%LAN_IP%:8000/api/v1
echo ============================================================
echo   PocketWMS Mobile (Expo)
echo   Backend LAN URL tu dong: %EXPO_PUBLIC_API_URL%
echo   Nhan 'w' de mo tren Trinh duyet, hoac quet QR bang Expo Go!
echo ============================================================
call npx expo start
pause
