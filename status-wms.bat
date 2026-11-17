@echo off
title Trang thai PocketWMS & Link 4G
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\wms-manager.ps1" -Action status
pause
