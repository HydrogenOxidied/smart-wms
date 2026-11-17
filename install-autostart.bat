@echo off
title Cai dat Tu khoi dong ngam cung Windows
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\wms-manager.ps1" -Action install-autostart
pause
