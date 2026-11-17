@echo off
title Cai dat Tu khoi dong an CMD cung Windows
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "$root = '%~dp0'.TrimEnd('\'); " ^
  "$vbs = Join-Path $root 'start-remote-cloudflare-hidden.vbs'; " ^
  "$startupDir = [Environment]::GetFolderPath('Startup'); " ^
  "$lnkPath = Join-Path $startupDir 'PocketWMS-Hidden-Backend.lnk'; " ^
  "$shell = New-Object -ComObject WScript.Shell; " ^
  "$sc = $shell.CreateShortcut($lnkPath); " ^
  "$sc.TargetPath = 'wscript.exe'; " ^
  "$sc.Arguments = '\"' + $vbs + '\"'; " ^
  "$sc.WorkingDirectory = $root; " ^
  "$sc.WindowStyle = 7; " ^
  "$sc.Description = 'Chay ngam PocketWMS Backend + Cloudflare 4G khong hien CMD'; " ^
  "$sc.Save(); " ^
  "Write-Host ('[OK] Da tao shortcut tu khoi dong tai: ' + $lnkPath)"
pause
