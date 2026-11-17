@echo off
title Dung PocketWMS Background Server
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "$root = '%~dp0'.TrimEnd('\'); " ^
  "$pidFile = Join-Path $root 'backend\logs\uvicorn.pid'; " ^
  "$stopped = $false; " ^
  "if (Test-Path $pidFile) { " ^
  "  $pidVal = [int](Get-Content $pidFile -Raw).Trim(); " ^
  "  if (Get-Process -Id $pidVal -ErrorAction SilentlyContinue) { " ^
  "    Stop-Process -Id $pidVal -Force; " ^
  "    Write-Host ('[PocketWMS] Da dung Backend PID=' + $pidVal); " ^
  "    $stopped = $true; " ^
  "  } " ^
  "  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue; " ^
  "} " ^
  "$conns = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue; " ^
  "foreach ($c in $conns) { " ^
  "  if (Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue) { " ^
  "    Stop-Process -Id $c.OwningProcess -Force; " ^
  "    Write-Host ('[PocketWMS] Da giai phong cong 8000 (PID=' + $c.OwningProcess + ')'); " ^
  "    $stopped = $true; " ^
  "  } " ^
  "} " ^
  "if (-not $stopped) { Write-Host '[PocketWMS] Backend hien khong chay.' }"
pause
