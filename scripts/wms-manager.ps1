[CmdletBinding()]
param(
    [ValidateSet('launcher', 'start', 'start-silent', 'restart-tunnel', 'stop', 'status', 'check-update', 'update', 'install-autostart', 'remove-autostart')]
    [string]$Action = 'launcher'
)

$ErrorActionPreference = 'Stop'
[System.Console]::OutputEncoding = [System.Text.Encoding]::UTF8
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

$ScriptsDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $ScriptsDir
$VersionFile = Join-Path $RootDir 'VERSION'
$GitHubRepo = 'HydrogenOxidied/smart-wms'
$Script:CachedUpdateInfo = $null
$BackendDir = Join-Path $RootDir 'backend'
$PythonExe = Join-Path $BackendDir '.venv\Scripts\python.exe'
$QrScript = Join-Path $ScriptsDir 'qr_matrix.py'
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

function Invoke-PrintQrCode {
    param(
        [string]$Url,
        [string]$Caption = 'QUET MA QR TREN DIEN THOAI:'
    )
    if ((-not $Url) -or (-not (Test-Path $PythonExe)) -or (-not (Test-Path $QrScript))) {
        return
    }
    $digitLines = & $PythonExe $QrScript $Url 2>$null
    if ((-not $digitLines) -or ($LASTEXITCODE -ne 0)) {
        return
    }
    $upperHalf = [char]0x2580
    $lowerHalf = [char]0x2584
    $fullBlock = [char]0x2588
    Write-Host ''
    Write-Host "  $Caption" -ForegroundColor Cyan
    foreach ($dLine in $digitLines) {
        $trimmed = ([string]$dLine).Trim()
        if (-not $trimmed) { continue }
        $sb = New-Object System.Text.StringBuilder
        foreach ($ch in $trimmed.ToCharArray()) {
            switch ($ch) {
                '0' { [void]$sb.Append(' ') }
                '1' { [void]$sb.Append($upperHalf) }
                '2' { [void]$sb.Append($lowerHalf) }
                '3' { [void]$sb.Append($fullBlock) }
            }
        }
        Write-Host -NoNewline '  '
        Write-Host ($sb.ToString()) -ForegroundColor Black -BackgroundColor White
    }
    Write-Host ''
}

function Get-LocalVersion {
    $raw = Read-TextTrimmed -Path $VersionFile
    if (-not $raw) { return '1.0.0' }
    return $raw.TrimStart('v', 'V')
}

function ConvertTo-ComparableVersion {
    param([string]$VerString)

    $cleaned = ([string]$VerString).Trim().TrimStart('v', 'V')
    $dashIdx = $cleaned.IndexOf('-')
    if ($dashIdx -gt 0) {
        $cleaned = $cleaned.Substring(0, $dashIdx)
    }
    $parts = @($cleaned.Split('.') | Where-Object { $_ -match '^\d+$' })
    while ($parts.Count -lt 3) {
        $parts += '0'
    }
    $norm = ($parts[0..2]) -join '.'
    $parsed = $null
    if ([System.Version]::TryParse($norm, [ref]$parsed)) {
        return $parsed
    }
    return ([System.Version]'0.0.0')
}

function Get-GitHubReleaseUpdate {
    param([string]$OverrideLocalVersion = '')

    $localVer = if ($OverrideLocalVersion) { $OverrideLocalVersion.TrimStart('v', 'V') } else { Get-LocalVersion }
    $apiUrl = "https://api.github.com/repos/$GitHubRepo/releases/latest"
    try {
        $headers = @{
            'User-Agent' = 'PocketWMS-Updater'
            'Accept'     = 'application/vnd.github+json'
        }
        $rel = Invoke-RestMethod -Uri $apiUrl -Headers $headers -Method GET -TimeoutSec 5
        $remoteTag = [string]$rel.tag_name
        $remoteVer = $remoteTag.TrimStart('v', 'V')
        $localObj = ConvertTo-ComparableVersion -VerString $localVer
        $remoteObj = ConvertTo-ComparableVersion -VerString $remoteVer
        $hasUpdate = ($remoteObj -gt $localObj)

        $zipAsset = $null
        if ($rel.assets) {
            $zipAsset = $rel.assets | Where-Object { $_.name -match '\.zip$' } | Select-Object -First 1
        }
        $downloadUrl = if ($zipAsset -and $zipAsset.browser_download_url) {
            [string]$zipAsset.browser_download_url
        } else {
            [string]$rel.zipball_url
        }
        $assetName = if ($zipAsset -and $zipAsset.name) { [string]$zipAsset.name } else { "$remoteTag.zip" }

        $result = [PSCustomObject]@{
            Checked         = $true
            UpdateAvailable = $hasUpdate
            LocalVersion    = $localVer
            RemoteTag       = $remoteTag
            RemoteVer       = $remoteVer
            AssetName       = $assetName
            DownloadUrl     = $downloadUrl
            HtmlUrl         = [string]$rel.html_url
            Error           = $null
        }
        if (-not $OverrideLocalVersion) {
            $Script:CachedUpdateInfo = $result
        }
        return $result
    } catch {
        $errResult = [PSCustomObject]@{
            Checked         = $false
            UpdateAvailable = $false
            LocalVersion    = $localVer
            RemoteTag       = ''
            RemoteVer       = ''
            AssetName       = ''
            DownloadUrl     = ''
            HtmlUrl         = "https://github.com/$GitHubRepo/releases"
            Error           = "$_"
        }
        if (-not $OverrideLocalVersion) {
            $Script:CachedUpdateInfo = $errResult
        }
        return $errResult
    }
}

function Invoke-ApplyReleaseUpdate {
    param($UpdateInfo)

    if ((-not $UpdateInfo) -or (-not $UpdateInfo.DownloadUrl)) {
        throw 'Khong tim thay link tai ban cap nhat (.zip).'
    }

    $tempZip = Join-Path $env:TEMP ("PocketWMS-update-" + $UpdateInfo.RemoteVer + ".zip")
    $tempExtract = Join-Path $env:TEMP ("PocketWMS-extract-" + $UpdateInfo.RemoteVer)
    Remove-Item $tempZip -Force -ErrorAction SilentlyContinue
    if (Test-Path $tempExtract) {
        Remove-Item $tempExtract -Recurse -Force -ErrorAction SilentlyContinue
    }

    Write-Host "[1/4] Dang tai $($UpdateInfo.AssetName) ($($UpdateInfo.RemoteTag))..." -ForegroundColor Cyan
    Invoke-WebRequest -Uri $UpdateInfo.DownloadUrl -OutFile $tempZip -UseBasicParsing -Headers @{ 'User-Agent' = 'PocketWMS-Updater' } -TimeoutSec 60

    Write-Host '[2/4] Dang giai nen goi cap nhat...'
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::ExtractToDirectory($tempZip, $tempExtract)

    $sourceRoot = $null
    if (Test-Path (Join-Path $tempExtract 'backend\app\main.py')) {
        $sourceRoot = $tempExtract
    } else {
        $candidateDir = Get-ChildItem -Path $tempExtract -Directory -ErrorAction SilentlyContinue |
            Where-Object { (Test-Path (Join-Path $_.FullName 'backend\app\main.py')) } |
            Select-Object -First 1
        if ($candidateDir) {
            $sourceRoot = $candidateDir.FullName
        }
    }
    if (-not $sourceRoot) {
        throw 'Goi .zip khong dung cau truc PocketWMS (thieu backend\app\main.py).'
    }

    Write-Host '[3/4] Dang dung Server de cap nhat ma nguon an toan (giu nguyen database)...'
    Invoke-StopAll

    $srcDist = Join-Path $sourceRoot 'mobile\dist'
    $dstDist = Join-Path $RootDir 'mobile\dist'
    if (Test-Path (Join-Path $srcDist 'index.html')) {
        if (Test-Path $dstDist) {
            Remove-Item $dstDist -Recurse -Force -ErrorAction SilentlyContinue
        }
        Copy-Item -Path $srcDist -Destination $dstDist -Recurse -Force
    }

    $sourceFiles = Get-ChildItem -Path $sourceRoot -Recurse -File
    foreach ($file in $sourceFiles) {
        $relPath = $file.FullName.Substring($sourceRoot.Length).TrimStart('\', '/')
        if (
            ($relPath -match '\.(db|db-shm|db-wal)$') -or
            ($file.Name -eq '.env') -or
            ($relPath -match '(^|[\\/])(\.venv|venv|node_modules|\.git)([\\/]|$)') -or
            ($relPath -match '^backend[\\/]logs([\\/]|$)') -or
            ($relPath -match '^mobile[\\/]dist([\\/]|$)')
        ) {
            continue
        }
        $destPath = Join-Path $RootDir $relPath
        $destDir = Split-Path -Parent $destPath
        if (-not (Test-Path $destDir)) {
            New-Item -ItemType Directory -Force -Path $destDir | Out-Null
        }
        try {
            Copy-Item -Path $file.FullName -Destination $destPath -Force
        } catch {
            Write-Warning "Bo qua file dang mo: $relPath"
        }
    }

    if (-not (Test-Path (Join-Path $sourceRoot 'VERSION'))) {
        Write-TextNoBom -Path $VersionFile -Value $UpdateInfo.RemoteVer
    }

    $reqFile = Join-Path $BackendDir 'requirements.txt'
    if ((Test-Path $PythonExe) -and (Test-Path $reqFile)) {
        Write-Host '[4/4] Dang dong bo thu vien Python backend...'
        & $PythonExe -m pip install -r $reqFile --quiet
    }

    Remove-Item $tempZip -Force -ErrorAction SilentlyContinue
    if (Test-Path $tempExtract) {
        Remove-Item $tempExtract -Recurse -Force -ErrorAction SilentlyContinue
    }
    $Script:CachedUpdateInfo = $null
    Write-Host "[OK] Da cap nhat thanh cong len phien ban v$($UpdateInfo.RemoteVer)! Du lieu kho duoc giu nguyen." -ForegroundColor Green
}

function Invoke-CheckAndPromptUpdate {
    param([switch]$AutoApply)

    Write-Host "[...] Dang kiem tra ban phat hanh moi tren GitHub ($GitHubRepo)..."
    $info = Get-GitHubReleaseUpdate
    if (-not $info.Checked) {
        Write-Host "[WARN] Khong the ket noi GitHub de kiem tra cap nhat: $($info.Error)" -ForegroundColor Yellow
        return $false
    }

    Write-Host "Phien ban hien tai : v$($info.LocalVersion)"
    Write-Host "Ban moi nhat GitHub: $($info.RemoteTag) ($($info.HtmlUrl))"

    if (-not $info.UpdateAvailable) {
        Write-Host '[OK] Ban dang dung phien ban moi nhat!' -ForegroundColor Green
        return $false
    }

    if ($AutoApply) {
        Invoke-ApplyReleaseUpdate -UpdateInfo $info
        return $true
    }

    $ans = Read-Host "Co ban cap nhat moi $($info.RemoteTag). Tai va cap nhat ngay? [Y/n]"
    if (($null -ne $ans) -and ($ans.Trim() -in '', 'y', 'Y')) {
        Invoke-ApplyReleaseUpdate -UpdateInfo $info
        return $true
    }
    return $false
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
    $tunnelOnline = $false
    if ($cfProc -and $pubUrl -and ($pubUrl -match '^https://[a-zA-Z0-9-]+\.trycloudflare\.com$')) {
        $tunnelOnline = $true
        Write-Host "TUNNEL 4G   : ONLINE (PID=$($cfProc.Id))" -ForegroundColor Green
        Write-Host "Link 4G/Net : $pubUrl (Da COPY)" -ForegroundColor Cyan
        Write-Host "API 4G/Net  : $pubUrl/api/v1" -ForegroundColor Cyan
        try { Set-Clipboard -Value $pubUrl } catch {}
    } else {
        Write-Host 'TUNNEL 4G   : OFFLINE' -ForegroundColor Yellow
    }

    Write-Host "Web/PWA LAN : http://${lanIp}:8000/web"
    Write-Host "API URL LAN : http://${lanIp}:8000/api/v1"

    $localVer = Get-LocalVersion
    $verNote = ''
    $verColor = 'White'
    if ($Script:CachedUpdateInfo -and $Script:CachedUpdateInfo.Checked) {
        if ($Script:CachedUpdateInfo.UpdateAvailable) {
            $verNote = " (Co ban moi $($Script:CachedUpdateInfo.RemoteTag) -> Bam [4])"
            $verColor = 'Yellow'
        } else {
            $verNote = ' (Moi nhat)'
            $verColor = 'Green'
        }
    }
    Write-Host "PHIEN BAN   : v$localVer$verNote" -ForegroundColor $verColor

    if (Test-AutostartInstalled) {
        Write-Host 'AUTOSTART   : DANG BAT (cung Windows)' -ForegroundColor Green
    } else {
        Write-Host 'AUTOSTART   : DANG TAT' -ForegroundColor Yellow
    }
    Write-Host "Thu muc Log : $LogsDir"

    if ($tunnelOnline) {
        Invoke-PrintQrCode -Url $pubUrl -Caption 'QUET MA QR DE MO APP QUA 4G / WI-FI BAT KY:'
    } elseif ($localOnline) {
        Invoke-PrintQrCode -Url "http://${lanIp}:8000/web" -Caption 'QUET MA QR DE MO APP CUNG WI-FI (LAN):'
    }
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
    if ($PublicUrl) {
        Invoke-PrintQrCode -Url $PublicUrl -Caption 'QUET MA QR DE MO APP QUA 4G / WI-FI BAT KY:'
    } else {
        Invoke-PrintQrCode -Url "http://${LanIp}:8000/web" -Caption 'QUET MA QR DE MO APP CUNG WI-FI (LAN):'
    }
}

function Invoke-Launcher {
    try {
        Repair-LegacyAutostart
        $upd = Get-GitHubReleaseUpdate
        if ($upd.Checked -and $upd.UpdateAvailable) {
            Write-Host ''
            Write-Host "[CAP NHAT MOI] Da co ban $($upd.RemoteTag) tren GitHub (Hien tai: v$($upd.LocalVersion))!" -ForegroundColor Yellow
            $doUpd = Read-Host 'Cap nhat ngay truoc khi khoi dong? [y/N]'
            if (($null -ne $doUpd) -and ($doUpd.Trim() -in 'y', 'Y')) {
                Invoke-ApplyReleaseUpdate -UpdateInfo $upd
            }
        }
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
            Write-Host '  [1]     Bat Server / Cap moi link & ma QR 4G'
            Write-Host '  [2]     Tat toan bo Backend & Tunnel 4G'
            Write-Host '  [3]     Bat / Tat Tu khoi dong cung Windows'
            Write-Host '  [4]     Kiem tra & Cap nhat phien ban moi (GitHub Release)'
            Write-Host '--------------------------------------------------------------------------' -ForegroundColor DarkGray

            $rawChoice = Read-Host 'Chon thao tac [Enter/1/2/3/4]'
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
                '4' {
                    if (Invoke-CheckAndPromptUpdate) {
                        Write-Host '[...] Dang khoi dong lai Server voi phien ban moi...'
                        [void](Ensure-Backend)
                        [void](Ensure-CloudflareTunnel)
                    }
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
    'check-update' {
        $info = Get-GitHubReleaseUpdate
        if (-not $info.Checked) {
            Write-Host "[WARN] Khong the ket noi GitHub de kiem tra cap nhat: $($info.Error)" -ForegroundColor Yellow
        } else {
            Write-Host "Phien ban hien tai : v$($info.LocalVersion)"
            Write-Host "Ban moi nhat GitHub: $($info.RemoteTag) ($($info.HtmlUrl))"
            if ($info.UpdateAvailable) {
                Write-Host "[CAP NHAT MOI] Co san $($info.AssetName). Chay 'start-wms.bat update' de tai & cap nhat." -ForegroundColor Yellow
            } else {
                Write-Host '[OK] Ban dang dung phien ban moi nhat!' -ForegroundColor Green
            }
        }
    }
    'update' {
        [void](Invoke-CheckAndPromptUpdate -AutoApply)
    }
    'install-autostart' {
        Invoke-InstallAutostart
    }
    'remove-autostart' {
        Invoke-RemoveAutostart
    }
}
