$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendDir = Join-Path $RootDir "backend"
$PythonExe = Join-Path $BackendDir ".venv\Scripts\python.exe"
$LogsDir = Join-Path $BackendDir "logs"
$PidFile = Join-Path $LogsDir "uvicorn.pid"
$StdoutLog = Join-Path $LogsDir "backend.stdout.log"
$StderrLog = Join-Path $LogsDir "backend.stderr.log"

if (-not (Test-Path $PythonExe)) {
    throw "Khong tim thay Python venv tai $PythonExe"
}

try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/v1/health" -Method GET -TimeoutSec 2
    if ($health.status -eq "ok") {
        exit 0
    }
} catch {
    # Not running yet
}

if (-not (Test-Path $LogsDir)) {
    New-Item -ItemType Directory -Force -Path $LogsDir | Out-Null
}

$proc = Start-Process -FilePath $PythonExe `
    -ArgumentList "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000" `
    -WorkingDirectory $BackendDir `
    -WindowStyle Hidden `
    -RedirectStandardOutput $StdoutLog `
    -RedirectStandardError $StderrLog `
    -PassThru

$proc.Id | Out-File -FilePath $PidFile -Encoding ascii -Force
