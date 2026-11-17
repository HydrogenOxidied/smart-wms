@echo off
title Trang thai PocketWMS Server 24/7
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "$root = '%~dp0'.TrimEnd('\'); " ^
  "$pidFile = Join-Path $root 'backend\logs\uvicorn.pid'; " ^
  "$cfPidFile = Join-Path $root 'backend\logs\cloudflared.pid'; " ^
  "$cfUrlFile = Join-Path $root 'backend\logs\public_url.txt'; " ^
  "$logFile = Join-Path $root 'backend\logs\backend.stdout.log'; " ^
  "$lanIp = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notmatch 'Loopback' -and $_.IPAddress -notmatch '^169\.254\.' } | Select-Object -First 1 -ExpandProperty IPAddress); " ^
  "if (-not $lanIp) { $lanIp = '127.0.0.1' }; " ^
  "try { " ^
  "  $h = Invoke-RestMethod -Uri 'http://127.0.0.1:8000/api/v1/health' -TimeoutSec 2; " ^
  "  Write-Host 'BACKEND    : ONLINE (Dang chay ngam)' -ForegroundColor Green; " ^
  "} catch { " ^
  "  Write-Host 'BACKEND    : OFFLINE' -ForegroundColor Red; " ^
  "} " ^
  "if (Test-Path $pidFile) { " ^
  "  $pidVal = [int](Get-Content $pidFile -Raw).Trim(); " ^
  "  $p = Get-Process -Id $pidVal -ErrorAction SilentlyContinue; " ^
  "  if ($p) { " ^
  "    $ramMb = [math]::Round($p.WorkingSet64 / 1MB, 1); " ^
  "    Write-Host ('PID / RAM  : ' + $pidVal + ' / ' + $ramMb + ' MB'); " ^
  "  } " ^
  "} " ^
  "$cfActive = $false; " ^
  "if ((Test-Path $cfPidFile) -and (Test-Path $cfUrlFile)) { " ^
  "  $cfPid = 0; " ^
  "  if ([int]::TryParse((Get-Content $cfPidFile -Raw).Trim(), [ref]$cfPid)) { " ^
  "    if (Get-Process -Id $cfPid -ErrorAction SilentlyContinue) { " ^
  "      $cfActive = $true; " ^
  "      $pubUrl = (Get-Content $cfUrlFile -Raw).Trim(); " ^
  "      Write-Host ('Link 4G/Net: ' + $pubUrl) -ForegroundColor Cyan; " ^
  "      Write-Host ('API 4G/Net : ' + $pubUrl + '/api/v1') -ForegroundColor Cyan; " ^
  "    } " ^
  "  } " ^
  "} " ^
  "if (-not $cfActive) { Write-Host 'Link 4G/Net: CHUA BAT (Chay start-remote-cloudflare.bat)' -ForegroundColor Yellow } " ^
  "Write-Host ('API URL LAN: http://' + $lanIp + ':8000/api/v1'); " ^
  "Write-Host ('Web/PWA LAN: http://' + $lanIp + ':8000/web'); " ^
  "Write-Host ('File Log   : ' + $logFile)"
pause
