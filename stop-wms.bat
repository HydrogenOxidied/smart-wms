@echo off
title Dung PocketWMS Server & Tunnel
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\wms-manager.ps1" -Action stop
pause
