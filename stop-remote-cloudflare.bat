@echo off
title PocketWMS - Tat truy cap 4G (Cloudflare Tunnel)
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "$root = '%~dp0'.TrimEnd('\'); " ^
  "$pidFile = Join-Path $root 'backend\logs\cloudflared.pid'; " ^
  "$urlFile = Join-Path $root 'backend\logs\public_url.txt'; " ^
  "$stopped = $false; " ^
  "if (Test-Path $pidFile) { " ^
  "  $pidVal = 0; " ^
  "  if ([int]::TryParse((Get-Content $pidFile -Raw).Trim(), [ref]$pidVal)) { " ^
  "    if (Get-Process -Id $pidVal -ErrorAction SilentlyContinue) { " ^
  "      Stop-Process -Id $pidVal -Force; " ^
  "      Write-Host ('[PocketWMS] Da tat Cloudflare Tunnel PID=' + $pidVal); " ^
  "      $stopped = $true; " ^
  "    } " ^
  "  } " ^
  "  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue; " ^
  "} " ^
  "Remove-Item $urlFile -Force -ErrorAction SilentlyContinue; " ^
  "if (-not $stopped) { Write-Host '[PocketWMS] Cloudflare Tunnel hien khong chay.' }"
pause
