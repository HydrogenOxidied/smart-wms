@echo off
title Khoi dong PocketWMS (LAN + 4G Cloudflare)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\wms-manager.ps1" -Action start
pause
