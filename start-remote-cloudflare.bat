@echo off
title PocketWMS - Bat truy cap 4G / Khac Wi-Fi (Cloudflare an CMD)
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "$root = '%~dp0'.TrimEnd('\'); " ^
  "$script = Join-Path $root 'start-remote-cloudflare-hidden.ps1'; " ^
  "$urlFile = Join-Path $root 'backend\logs\public_url.txt'; " ^
  "& $script | Out-Null; " ^
  "if (-not (Test-Path $urlFile)) { Write-Host '[LOI] Khong khoi tao duoc Cloudflare Tunnel.' -ForegroundColor Red; exit 1 }; " ^
  "$url = (Get-Content $urlFile -Raw).Trim(); " ^
  "Set-Clipboard -Value $url; " ^
  "Write-Host ''; " ^
  "Write-Host '==========================================================================' -ForegroundColor Green; " ^
  "Write-Host ('  Link 4G / Wi-Fi khac (Da tu dong COPY): ' + $url) -ForegroundColor Cyan; " ^
  "Write-Host ('  API cho APK / Expo Go               : ' + $url + '/api/v1') -ForegroundColor White; " ^
  "Write-Host '==========================================================================' -ForegroundColor Green; " ^
  "Write-Host '  - Gui link tren cho dien thoai (iPhone Safari / Android Chrome) de dung ngay.'; " ^
  "Write-Host '  - Ban co the DONG cua so nay, Backend + Tunnel van chay ngam.'; " ^
  "Write-Host '  - De tat truy cap Internet, chay: stop-remote-cloudflare.bat';"
pause
