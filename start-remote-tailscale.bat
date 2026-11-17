@echo off
title PocketWMS - Bat truy cap tu xa 4G / Khac Wi-Fi (Tailscale Funnel)
set "ROOT=%~dp0"

echo [1/3] Khoi dong Backend PocketWMS chay ngam...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%ROOT%start-backend-hidden.ps1"

echo [2/3] Kiem tra trang thai Tailscale...
tailscale status >nul 2>&1
if errorlevel 1 (
    echo [PocketWMS] Tailscale chua bat hoac chua dang nhap. Dang mo dang nhap Tailscale...
    tailscale up
)

echo [3/3] Bat HTTPS Funnel chay ngam cho cong 8000...
tailscale funnel --bg 8000
echo.
echo ============================================================================
echo   Link truy cap tu moi mang 4G / Wi-Fi khac (Mo tren dien thoai hoac Web):
echo ============================================================================
tailscale funnel status
echo.
echo   - Mo tren trinh duyet (iPhone/Android): vao link https://... o tren
echo   - Neu dung app Expo Go / APK: mo "API" o man Login va dien: https://.../api/v1
echo   - Ban co the dong cua so nay, Funnel + Backend van tiep tuc chay ngam.
echo   - De tat chia se ra Internet, chay file: stop-remote-tailscale.bat
echo ============================================================================
pause
