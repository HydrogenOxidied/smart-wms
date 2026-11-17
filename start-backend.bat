@echo off
title PocketWMS FastAPI Backend
cd /d "%~dp0backend"
if not exist ".venv\Scripts\python.exe" (
    echo [ERROR] Khong tim thay .venv. Vui long chay pip install truoc.
    pause
    exit /b 1
)
echo [PocketWMS] Dang khoi dong Backend API + AI Forecasting tai http://0.0.0.0:8000 ...
echo [PocketWMS] Tai lieu Swagger: http://127.0.0.1:8000/docs
".venv\Scripts\python.exe" -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
pause
