@echo off
title PocketWMS - Tat truy cap tu xa (Tailscale Funnel)
echo [PocketWMS] Dang tat Tailscale Funnel tren cong 443...
tailscale funnel --https=443 off
echo [PocketWMS] Da ngat ket noi truy cap tu Internet.
pause
