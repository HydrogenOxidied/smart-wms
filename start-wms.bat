@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"
title PocketWMS - Khoi dong Local Wi-Fi, Ma QR va Cap nhat GitHub

set "ACTION=%~1"
if "%ACTION%"=="" set "ACTION=launcher"
if /i "%ACTION%"=="install" set "ACTION=setup"

if /i "%ACTION%"=="setup" (
    echo [PocketWMS] Kiem tra va cai dat moi truong Python / thu vien Backend...
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\wms-manager.ps1" -Action setup
    if errorlevel 1 (
        echo.
        echo [LOI] Qua trinh cai dat tu dong Python / thu vien gap su co.
        pause
        exit /b 1
    )
    exit /b 0
)

if /i "%ACTION%"=="launcher" goto :preinstall_check
if /i "%ACTION%"=="start" goto :preinstall_check
goto :run_action

:preinstall_check
if not exist "%~dp0backend\.venv\Scripts\python.exe" (
    echo ==========================================================================
    echo   [PRE-INSTALL] Khoi tao moi truong chay lan dau cho PocketWMS
    echo   - Dang kiem tra Python (^>= 3.10^). Neu may chua co Python, he thong se
    echo     tu dong tai va cai dat Python 3.12 + thu vien can thiet...
    echo ==========================================================================
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\wms-manager.ps1" -Action setup
    if errorlevel 1 (
        echo.
        echo [LOI] Qua trinh cai dat tu dong Python / thu vien gap su co.
        echo Vui long kiem tra ket noi mang hoac cai dat Python 3.12 thu cong tu https://www.python.org/downloads/
        pause
        exit /b 1
    )
)

:run_action
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\wms-manager.ps1" -Action %ACTION%
if errorlevel 1 (
    echo.
    echo [LOI] Khong the hoan tat thao tac "%ACTION%".
    pause
    exit /b 1
)
endlocal
goto :eof
