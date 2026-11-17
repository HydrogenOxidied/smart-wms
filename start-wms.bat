@echo off
chcp 65001 >nul
title PocketWMS - Khoi dong va Quan ly Server (LAN + 4G + QR)
if "%~1"=="" (
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\wms-manager.ps1" -Action launcher
) else (
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\wms-manager.ps1" -Action %~1
)
