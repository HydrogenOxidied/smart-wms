@echo off
title PocketWMS - Khoi dong va Quan ly Server (LAN + 4G)
if "%~1"=="" (
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\wms-manager.ps1" -Action launcher
) else (
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\wms-manager.ps1" -Action %~1
)
