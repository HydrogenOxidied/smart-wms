$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendDir = Join-Path $RootDir "backend"
$LogsDir = Join-Path $BackendDir "logs"
$PidFile = Join-Path $LogsDir "cloudflared.pid"
$TunnelLog = Join-Path $LogsDir "cloudflared.log"
$CfStdoutLog = Join-Path $LogsDir "cloudflared.stdout.log"
$CfStderrLog = Join-Path $LogsDir "cloudflared.stderr.log"
$PublicUrlFile = Join-Path $LogsDir "public_url.txt"

& (Join-Path $RootDir "start-backend-hidden.ps1")

if (-not (Test-Path $LogsDir)) {
    New-Item -ItemType Directory -Force -Path $LogsDir | Out-Null
}

function Resolve-CloudflaredExe {
    $cmd = Get-Command cloudflared -ErrorAction SilentlyContinue
    if ($cmd -and (Test-Path $cmd.Source)) {
        return $cmd.Source
    }
    $candidates = @(
        "C:\Program Files (x86)\cloudflared\cloudflared.exe",
        "C:\Program Files\cloudflared\cloudflared.exe",
        (Join-Path $BackendDir "bin\cloudflared.exe")
    )
    $wingetPkgs = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages"
    if (Test-Path $wingetPkgs) {
        $foundPkg = Get-ChildItem -Path $wingetPkgs -Filter "cloudflared.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($foundPkg) {
            $candidates += $foundPkg.FullName
        }
    }
    foreach ($cand in $candidates) {
        if ($cand -and (Test-Path $cand)) {
            return $cand
        }
    }
    return $null
}

$CloudflaredExe = Resolve-CloudflaredExe
if (-not $CloudflaredExe) {
    throw "Khong tim thay cloudflared.exe. Hay cai bang: winget install --id Cloudflare.cloudflared -e"
}

if ((Test-Path $PidFile) -and (Test-Path $PublicUrlFile)) {
    $existingPid = 0
    if ([int]::TryParse((Get-Content $PidFile -Raw).Trim(), [ref]$existingPid)) {
        $existingProc = Get-Process -Id $existingPid -ErrorAction SilentlyContinue
        $existingUrl = (Get-Content $PublicUrlFile -Raw).Trim()
        if ($existingProc -and $existingUrl -match '^https://[a-zA-Z0-9-]+\.trycloudflare\.com$') {
            Write-Output $existingUrl
            exit 0
        }
    }
}

if (Test-Path $PidFile) {
    $stalePid = 0
    if ([int]::TryParse((Get-Content $PidFile -Raw).Trim(), [ref]$stalePid)) {
        Stop-Process -Id $stalePid -Force -ErrorAction SilentlyContinue
    }
    Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
}
Remove-Item $TunnelLog -Force -ErrorAction SilentlyContinue
Remove-Item $PublicUrlFile -Force -ErrorAction SilentlyContinue

$proc = Start-Process -FilePath $CloudflaredExe `
    -ArgumentList "tunnel", "--url", "http://127.0.0.1:8000", "--no-autoupdate", "--logfile", $TunnelLog `
    -WorkingDirectory $BackendDir `
    -WindowStyle Hidden `
    -RedirectStandardOutput $CfStdoutLog `
    -RedirectStandardError $CfStderrLog `
    -PassThru

$proc.Id | Out-File -FilePath $PidFile -Encoding ascii -Force

$resolvedUrl = $null
for ($i = 0; $i -lt 50; $i++) {
    Start-Sleep -Milliseconds 500
    if ($proc.HasExited) {
        break
    }
    if (Test-Path $TunnelLog) {
        $rawLog = Get-Content $TunnelLog -Raw -ErrorAction SilentlyContinue
        if ($rawLog -match 'https://[a-zA-Z0-9-]+\.trycloudflare\.com') {
            $resolvedUrl = $Matches[0]
            break
        }
    }
}

if (-not $resolvedUrl) {
    throw "Khong lay duoc URL tu Cloudflare Tunnel trong 25 giay. Kiem tra $TunnelLog"
}

$resolvedUrl | Out-File -FilePath $PublicUrlFile -Encoding utf8 -NoNewline -Force
Write-Output $resolvedUrl
