[CmdletBinding()]
param(
    [ValidateSet('launcher', 'start', 'start-silent', 'restart-tunnel', 'stop', 'status', 'install-autostart', 'remove-autostart')]
    [string]$Action = 'launcher'
)

$ErrorActionPreference = 'Stop'
[System.Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ScriptsDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $ScriptsDir
$BackendDir = Join-Path $RootDir 'backend'
$PythonExe = Join-Path $BackendDir '.venv\Scripts\python.exe'
$LogsDir = Join-Path $BackendDir 'logs'
$UvicornPidFile = Join-Path $LogsDir 'uvicorn.pid'
$BackendStdout = Join-Path $LogsDir 'backend.stdout.log'
$BackendStderr = Join-Path $LogsDir 'backend.stderr.log'
$CfPidFile = Join-Path $LogsDir 'cloudflared.pid'
$CfLog = Join-Path $LogsDir 'cloudflared.log'
$CfStdout = Join-Path $LogsDir 'cloudflared.stdout.log'
$CfStderr = Join-Path $LogsDir 'cloudflared.stderr.log'
$PublicUrlFile = Join-Path $LogsDir 'public_url.txt'
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

if (-not (Test-Path $LogsDir)) {
    New-Item -ItemType Directory -Force -Path $LogsDir | Out-Null
}

function Write-TextNoBom {
    param([string]$Path, [string]$Value)
    [System.IO.File]::WriteAllText($Path, $Value, $Utf8NoBom)
}

function Read-TextTrimmed {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return $null }
    return ([System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)).Trim([char]0xFEFF, [char]' ', [char]"`r", [char]"`n", [char]"`t")
}

function Read-SharedText {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return '' }
    $fs = $null
    $sr = $null
    try {
        $fs = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
        $sr = New-Object System.IO.StreamReader($fs, [System.Text.Encoding]::UTF8)
        return $sr.ReadToEnd()
    } catch {
        return ''
    } finally {
        if ($sr) { $sr.Dispose() }
        if ($fs) { $fs.Dispose() }
    }
}

function Get-LanIp {
    $ip = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object {
            $_.InterfaceAlias -notmatch 'Loopback|vEthernet|Tailscale' -and
            $_.IPAddress -notmatch '^169\.254\.' -and
            $_.IPAddress -ne '127.0.0.1'
        } |
        Select-Object -First 1 -ExpandProperty IPAddress
    if (-not $ip) { return '127.0.0.1' }
    return $ip
}

function Resolve-CloudflaredExe {
    $cmd = Get-Command cloudflared -ErrorAction SilentlyContinue
    if ($cmd -and (Test-Path $cmd.Source)) {
        return $cmd.Source
    }
    $candidates = @(
        'C:\Program Files (x86)\cloudflared\cloudflared.exe',
        'C:\Program Files\cloudflared\cloudflared.exe',
        (Join-Path $BackendDir 'bin\cloudflared.exe')
    )
    $wingetPkgs = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
    if (Test-Path $wingetPkgs) {
        $foundPkg = Get-ChildItem -Path $wingetPkgs -Filter 'cloudflared.exe' -Recurse -ErrorAction SilentlyContinue |
            Select-Object -First 1
        if ($foundPkg) { $candidates += $foundPkg.FullName }
    }
    foreach ($cand in $candidates) {
        if ($cand -and (Test-Path $cand)) { return $cand }
    }
    return $null
}

function Test-LocalHealth {
    try {
        $h = Invoke-RestMethod -Uri 'http://127.0.0.1:8000/api/v1/health' -Method GET -TimeoutSec 2
        return ($h.status -eq 'ok')
    } catch {
        return $false
    }
}

function Get-ListeningPort8000Pid {
    $conn = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($conn) { return [int]$conn.OwningProcess }
    return $null
}

function Ensure-Backend {
    if (Test-LocalHealth) {
        $ownerPid = Get-ListeningPort8000Pid
        if ($ownerPid) {
            Write-TextNoBom -Path $UvicornPidFile -Value ([string]$ownerPid)
        }
        return $true
    }

    if (-not (Test-Path $PythonExe)) {
        throw "Khong tim thay Python venv tai $PythonExe"
    }

    $stalePortPid = Get-ListeningPort8000Pid
    if ($stalePortPid) {
        Stop-Process -Id $stalePortPid -Force -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 300
    }

    $proc = Start-Process -FilePath $PythonExe `
        -ArgumentList '-m', 'uvicorn', 'app.main:app', '--host', '0.0.0.0', '--port', '8000' `
        -WorkingDirectory $BackendDir `
        -WindowStyle Hidden `
        -RedirectStandardOutput $BackendStdout `
        -RedirectStandardError $BackendStderr `
        -PassThru

    Write-TextNoBom -Path $UvicornPidFile -Value ([string]$proc.Id)

    for ($i = 0; $i -lt 40; $i++) {
        Start-Sleep -Milliseconds 500
        if (Test-LocalHealth) {
            return $true
        }
    }

    throw "Backend khong phan hoi trong 20 giay. Kiem tra log tai $BackendStderr"
}

function Get-ActiveCloudflaredProc {
    $pidRaw = Read-TextTrimmed -Path $CfPidFile
    $cfPid = 0
    if ($pidRaw -and ([int]::TryParse($pidRaw, [ref]$cfPid))) {
        $proc = Get-Process -Id $cfPid -ErrorAction SilentlyContinue
        if ($proc -and ($proc.ProcessName -eq 'cloudflared')) {
            return $proc
        }
    }
    $fallback = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object { ($_.Name -eq 'cloudflared.exe') -and ($_.CommandLine -match '127\.0\.0\.1:8000') } |
        Select-Object -First 1
    if ($fallback) {
        Write-TextNoBom -Path $CfPidFile -Value ([string]$fallback.ProcessId)
        return (Get-Process -Id $fallback.ProcessId -ErrorAction SilentlyContinue)
    }
    return $null
}

function Ensure-CloudflareTunnel {
    param([switch]$ForceRestart)

    $exe = Resolve-CloudflaredExe
    if (-not $exe) {
        return $null
    }

    if (-not $ForceRestart) {
        $existingProc = Get-ActiveCloudflaredProc
        $existingUrl = Read-TextTrimmed -Path $PublicUrlFile
        if ($existingProc -and $existingUrl -and ($existingUrl -match '^https://[a-zA-Z0-9-]+\.trycloudflare\.com$')) {
            try {
                $rh = Invoke-RestMethod -Uri ($existingUrl + '/api/v1/health') -Method GET -TimeoutSec 5
                if ($rh.status -eq 'ok') {
                    return $existingUrl
                }
            } catch {
                # Tunnel stale/expired; recreate below
            }
        }
    }

    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object { ($_.Name -eq 'cloudflared.exe') -and ($_.CommandLine -match '127\.0\.0\.1:8000') } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Remove-Item $CfPidFile, $CfLog, $CfStdout, $CfStderr, $PublicUrlFile -Force -ErrorAction SilentlyContinue

    $proc = Start-Process -FilePath $exe `
        -ArgumentList 'tunnel', '--url', 'http://127.0.0.1:8000', '--no-autoupdate', '--logfile', $CfLog `
        -WorkingDirectory $BackendDir `
        -WindowStyle Hidden `
        -RedirectStandardOutput $CfStdout `
        -RedirectStandardError $CfStderr `
        -PassThru

    Write-TextNoBom -Path $CfPidFile -Value ([string]$proc.Id)

    $resolvedUrl = $null
    for ($i = 0; $i -lt 50; $i++) {
        Start-Sleep -Milliseconds 500
        if ($proc.HasExited) {
            break
        }
        $logText = Read-SharedText -Path $CfLog
        if ($logText -match 'https://[a-zA-Z0-9-]+\.trycloudflare\.com') {
            $resolvedUrl = $Matches[0]
            if ($logText -match 'Registered tunnel connection') {
                break
            }
        }
    }

    if (-not $resolvedUrl) {
        throw "Khong tao duoc link Cloudflare Tunnel trong 25 giay. Kiem tra log tai $CfLog"
    }

    Write-TextNoBom -Path $PublicUrlFile -Value $resolvedUrl
    return $resolvedUrl
}

function Invoke-StopAll {
    $stoppedAny = $false

    $cfProcs = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object { ($_.Name -eq 'cloudflared.exe') -and ($_.CommandLine -match '127\.0\.0\.1:8000') }
    foreach ($cp in $cfProcs) {
        Stop-Process -Id $cp.ProcessId -Force -ErrorAction SilentlyContinue
        Write-Host "[PocketWMS] Da dung Cloudflare Tunnel PID=$($cp.ProcessId)"
        $stoppedAny = $true
    }
    $cfPidRaw = Read-TextTrimmed -Path $CfPidFile
    $cfPidVal = 0
    if ($cfPidRaw -and ([int]::TryParse($cfPidRaw, [ref]$cfPidVal))) {
        $p = Get-Process -Id $cfPidVal -ErrorAction SilentlyContinue
        if ($p) {
            Stop-Process -Id $cfPidVal -Force -ErrorAction SilentlyContinue
            Write-Host "[PocketWMS] Da dung Cloudflare Tunnel PID=$cfPidVal"
            $stoppedAny = $true
        }
    }
    Remove-Item $CfPidFile, $PublicUrlFile -Force -ErrorAction SilentlyContinue

    $uvPidRaw = Read-TextTrimmed -Path $UvicornPidFile
    $uvPidVal = 0
    if ($uvPidRaw -and ([int]::TryParse($uvPidRaw, [ref]$uvPidVal))) {
        $up = Get-Process -Id $uvPidVal -ErrorAction SilentlyContinue
        if ($up) {
            Stop-Process -Id $uvPidVal -Force -ErrorAction SilentlyContinue
            Write-Host "[PocketWMS] Da dung Backend PID=$uvPidVal"
            $stoppedAny = $true
        }
    }
    $conns = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue
    foreach ($c in $conns) {
        Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
        Write-Host "[PocketWMS] Da giai phong cong 8000 (PID=$($c.OwningProcess))"
        $stoppedAny = $true
    }
    Remove-Item $UvicornPidFile -Force -ErrorAction SilentlyContinue

    if (-not $stoppedAny) {
        Write-Host '[PocketWMS] Server va Tunnel hien khong chay.'
    }
}

function Get-AutostartPaths {
    $startupDir = [Environment]::GetFolderPath('Startup')
    return @{
        StartupDir = $startupDir
        LnkPath    = (Join-Path $startupDir 'PocketWMS-AutoStart.lnk')
        LegacyLnk  = (Join-Path $startupDir 'PocketWMS-Hidden-Backend.lnk')
    }
}

function Test-AutostartInstalled {
    $paths = Get-AutostartPaths
    return (Test-Path $paths.LnkPath)
}

function Invoke-InstallAutostart {
    param([switch]$Quiet)

    $vbs = Join-Path $ScriptsDir 'start-hidden.vbs'
    if (-not (Test-Path $vbs)) {
        throw "Khong tim thay $vbs"
    }
    $paths = Get-AutostartPaths
    if (Test-Path $paths.LegacyLnk) {
        Remove-Item $paths.LegacyLnk -Force -ErrorAction SilentlyContinue
    }
    $shell = New-Object -ComObject WScript.Shell
    $sc = $shell.CreateShortcut($paths.LnkPath)
    $sc.TargetPath = 'wscript.exe'
    $sc.Arguments = '"' + $vbs + '"'
    $sc.WorkingDirectory = $RootDir
    $sc.WindowStyle = 7
    $sc.Description = 'Tu khoi dong ngam PocketWMS Backend + Cloudflare 4G'
    $sc.Save()
    if (-not $Quiet) {
        Write-Host "[OK] Da cai dat tu khoi dong ngam tai: $($paths.LnkPath)" -ForegroundColor Green
    }
}

function Invoke-RemoveAutostart {
    $paths = Get-AutostartPaths
    if (Test-Path $paths.LnkPath) {
        Remove-Item $paths.LnkPath -Force -ErrorAction SilentlyContinue
    }
    if (Test-Path $paths.LegacyLnk) {
        Remove-Item $paths.LegacyLnk -Force -ErrorAction SilentlyContinue
    }
    Write-Host '[OK] Da go tu khoi dong cung Windows.' -ForegroundColor Yellow
}

function Repair-LegacyAutostart {
    $paths = Get-AutostartPaths
    if (Test-Path $paths.LegacyLnk) {
        Remove-Item $paths.LegacyLnk -Force -ErrorAction SilentlyContinue
        if (-not (Test-Path $paths.LnkPath)) {
            Invoke-InstallAutostart -Quiet
        }
    }
}

function Invoke-ToggleAutostart {
    if (Test-AutostartInstalled) {
        Invoke-RemoveAutostart
    } else {
        Invoke-InstallAutostart
    }
}

function Invoke-ShowStatus {
    $lanIp = Get-LanIp
    $localOnline = Test-LocalHealth

    if ($localOnline) {
        Write-Host 'BACKEND     : ONLINE (Dang chay ngam)' -ForegroundColor Green
        $ownerPid = Get-ListeningPort8000Pid
        if ($ownerPid) {
            $proc = Get-Process -Id $ownerPid -ErrorAction SilentlyContinue
            if ($proc) {
                $ramMb = [math]::Round($proc.WorkingSet64 / 1MB, 1)
                Write-Host "PID / RAM   : $ownerPid / $ramMb MB"
            }
        }
    } else {
        Write-Host 'BACKEND     : OFFLINE' -ForegroundColor Red
    }

    $cfProc = Get-ActiveCloudflaredProc
    $pubUrl = Read-TextTrimmed -Path $PublicUrlFile
    if ($cfProc -and $pubUrl -and ($pubUrl -match '^https://[a-zA-Z0-9-]+\.trycloudflare\.com$')) {
        Write-Host "TUNNEL 4G   : ONLINE (PID=$($cfProc.Id))" -ForegroundColor Green
        Write-Host "Link 4G/Net : $pubUrl (Da COPY)" -ForegroundColor Cyan
        Write-Host "API 4G/Net  : $pubUrl/api/v1" -ForegroundColor Cyan
        try { Set-Clipboard -Value $pubUrl } catch {}
    } else {
        Write-Host 'TUNNEL 4G   : OFFLINE' -ForegroundColor Yellow
    }

    Write-Host "Web/PWA LAN : http://${lanIp}:8000/web"
    Write-Host "API URL LAN : http://${lanIp}:8000/api/v1"

    if (Test-AutostartInstalled) {
        Write-Host 'AUTOSTART   : DANG BAT (cung Windows)' -ForegroundColor Green
    } else {
        Write-Host 'AUTOSTART   : DANG TAT' -ForegroundColor Yellow
    }
    Write-Host "Thu muc Log : $LogsDir"
}

function Invoke-PrintStartBanner {
    param([string]$PublicUrl, [string]$LanIp)

    Write-Host ''
    Write-Host '==========================================================================' -ForegroundColor Green
    if ($PublicUrl) {
        try { Set-Clipboard -Value $PublicUrl } catch {}
        Write-Host "  Link 4G / Khac Wi-Fi (Da COPY): $PublicUrl" -ForegroundColor Cyan
        Write-Host "  API cho APK / Expo Go         : $PublicUrl/api/v1" -ForegroundColor White
    } else {
        try { Set-Clipboard -Value "http://${LanIp}:8000/web" } catch {}
        Write-Host '  [CANH BAO] Chua co cloudflared.exe -> Tam chi truy cap trong cung Wi-Fi LAN.' -ForegroundColor Yellow
    }
    Write-Host "  Link cung Wi-Fi (LAN)         : http://${LanIp}:8000/web" -ForegroundColor White
    Write-Host '==========================================================================' -ForegroundColor Green
}

function Invoke-Launcher {
    try {
        Repair-LegacyAutostart
        Write-Host '[PocketWMS] Dang kiem tra / khoi dong ngam Backend & Link 4G...'
        [void](Ensure-Backend)
        [void](Ensure-CloudflareTunnel)

        $running = $true
        while ($running) {
            Write-Host ''
            Write-Host '==========================================================================' -ForegroundColor Green
            Invoke-ShowStatus
            Write-Host '--------------------------------------------------------------------------' -ForegroundColor DarkGray
            Write-Host '  [Enter] Dong cua so (Backend + 4G van chay ngam)'
            Write-Host '  [1]     Bat lai / Cap moi link 4G'
            Write-Host '  [2]     Tat toan bo Backend & Tunnel 4G'
            Write-Host '  [3]     Bat / Tat Tu khoi dong cung Windows'
            Write-Host '--------------------------------------------------------------------------' -ForegroundColor DarkGray

            $rawChoice = Read-Host 'Chon thao tac [Enter/1/2/3]'
            if ($null -eq $rawChoice) {
                $running = $false
                continue
            }
            $choice = $rawChoice.Trim()
            switch ($choice) {
                ''  { $running = $false }
                '0' { $running = $false }
                'q' { $running = $false }
                'Q' { $running = $false }
                '1' {
                    Write-Host '[...] Dang khoi dong Backend & cap moi link 4G...'
                    [void](Ensure-Backend)
                    [void](Ensure-CloudflareTunnel -ForceRestart)
                }
                '2' {
                    Invoke-StopAll
                }
                '3' {
                    Invoke-ToggleAutostart
                }
                default {
                    Write-Host '[WARN] Lua chon khong hop le.' -ForegroundColor Yellow
                }
            }
        }
    } catch {
        Write-Host "[X] LOI: $_" -ForegroundColor Red
        [void](Read-Host 'Nhan Enter de dong cua so')
    }
}

switch ($Action) {
    'launcher' {
        Invoke-Launcher
    }
    'start' {
        Repair-LegacyAutostart
        $lanIp = Get-LanIp
        Write-Host '[1/2] Dang kiem tra / khoi dong Backend PocketWMS (cong 8000)...'
        [void](Ensure-Backend)
        Write-Host '[2/2] Dang kiem tra / khoi dong Cloudflare Tunnel (4G / Khac Wi-Fi)...'
        $pubUrl = Ensure-CloudflareTunnel
        Invoke-PrintStartBanner -PublicUrl $pubUrl -LanIp $lanIp
        Write-Host '  * Ban co the DONG cua so nay, Backend + Tunnel van chay ngam.'
        Write-Host '  * Chay start-wms.bat de xem link 4G, tat server, hoac bat tu khoi dong.'
    }
    'start-silent' {
        Repair-LegacyAutostart
        [void](Ensure-Backend)
        [void](Ensure-CloudflareTunnel)
    }
    'restart-tunnel' {
        $lanIp = Get-LanIp
        Write-Host '[1/2] Dang kiem tra Backend PocketWMS (cong 8000)...'
        [void](Ensure-Backend)
        Write-Host '[2/2] Dang cap moi link Cloudflare Tunnel (4G / Khac Wi-Fi)...'
        $pubUrl = Ensure-CloudflareTunnel -ForceRestart
        Invoke-PrintStartBanner -PublicUrl $pubUrl -LanIp $lanIp
    }
    'stop' {
        Invoke-StopAll
    }
    'status' {
        Repair-LegacyAutostart
        Invoke-ShowStatus
    }
    'install-autostart' {
        Invoke-InstallAutostart
    }
    'remove-autostart' {
        Invoke-RemoveAutostart
    }
}
