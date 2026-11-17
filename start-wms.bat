@echo off
chcp 65001 >nul
title PocketWMS - Khoi dong, Ma QR 4G va Cap nhat GitHub
if "%~1"=="" (
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\wms-manager.ps1" -Action launcher
) else (
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\wms-manager.ps1" -Action %~1
)
goto :eof
