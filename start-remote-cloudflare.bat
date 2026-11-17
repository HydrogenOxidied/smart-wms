@echo off
title PocketWMS - Truy cap tu xa 4G / Khac Wi-Fi (Cloudflare Quick Tunnel)
set "ROOT=%~dp0"

echo [1/2] Khoi dong Backend PocketWMS chay ngam...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%ROOT%start-backend-hidden.ps1"

where cloudflared >nul 2>&1
if errorlevel 1 (
    echo [PocketWMS] Chua co cloudflared tren may.
    echo Ban co the cai nhanh bang lenh sau trong PowerShell/CMD:
    echo   winget install --id Cloudflare.cloudflared -e
    echo Hoac su dung Tailscale da cai san qua file: start-remote-tailscale.bat
    echo.
    pause
    exit /b 1
)

echo [2/2] Dang tao link HTTPS cong khai tam thoi toi cong 8000...
echo Copy link https://xxxx.trycloudflare.com ben duoi de mo tu 4G hoac Wi-Fi khac.
echo (Giu cua so nay mo trong suot thoi gian truy cap tu xa.)
echo.
cloudflared tunnel --url http://127.0.0.1:8000
pause
