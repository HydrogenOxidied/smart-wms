[CmdletBinding()]
param(
    [ValidateSet('launcher', 'start', 'start-silent', 'setup', 'stop', 'status', 'check-update', 'update', 'install-autostart', 'remove-autostart')]
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
$VenvDir = Join-Path $BackendDir '.venv'
$PythonExe = Join-Path $VenvDir 'Scripts\python.exe'
$ReqFile = Join-Path $BackendDir 'requirements.txt'
$ReqHashFile = Join-Path $VenvDir '.requirements.sha256'
$QrScript = Join-Path $ScriptsDir 'qr_matrix.py'
$LogsDir = Join-Path $BackendDir 'logs'
$BackupsDir = Join-Path $BackendDir 'backups'
$DbFile = Join-Path $BackendDir 'smart_wms.db'
$UvicornPidFile = Join-Path $LogsDir 'uvicorn.pid'
$BackendStdout = Join-Path $LogsDir 'backend.stdout.log'
$BackendStderr = Join-Path $LogsDir 'backend.stderr.log'
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

function Refresh-ProcessPath {
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $parts = @($userPath, $machinePath, $env:Path) | Where-Object { $_ -and ($_.Trim().Length -gt 0) }
    $env:Path = ($parts -join ';')
}

function Invoke-NativeQuiet {
    param(
        [string]$ExePath,
        [string[]]$ArgumentList,
        [switch]$SuppressOutput
    )
    if ((-not $ExePath) -or (-not (Test-Path $ExePath))) {
        return 1
    }
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        if ($SuppressOutput) {
            & $ExePath @ArgumentList 2>$null | Out-Null
        } else {
            & $ExePath @ArgumentList 2>&1 | Out-Host
        }
        return [int]$LASTEXITCODE
    } catch {
        return 1
    } finally {
        $ErrorActionPreference = $prevEap
    }
}

function Test-PythonImports {
    param(
        [string]$ExePath,
        [string]$ImportExpr = 'import sys'
    )
    return ((Invoke-NativeQuiet -ExePath $ExePath -ArgumentList @('-c', $ImportExpr) -SuppressOutput) -eq 0)
}

function Test-UsableSystemPython {
    param([string]$CandidatePath)

    if ((-not $CandidatePath) -or (-not (Test-Path $CandidatePath))) {
        return $false
    }
    if ($CandidatePath -match '[\\/]Microsoft[\\/]WindowsApps[\\/]') {
        return $false
    }
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $verOut = & $CandidatePath -c "import sys, venv, sqlite3; print('%d.%d' % (sys.version_info[0], sys.version_info[1]))" 2>$null
        if ($LASTEXITCODE -ne 0) {
            return $false
        }
        $verText = ([string]($verOut | Select-Object -First 1)).Trim()
        if ($verText -match '^(\d+)\.(\d+)$') {
            $maj = [int]$Matches[1]
            $min = [int]$Matches[2]
            return (($maj -gt 3) -or (($maj -eq 3) -and ($min -ge 10)))
        }
        return $false
    } catch {
        return $false
    } finally {
        $ErrorActionPreference = $prevEap
    }
}

function Resolve-SystemPython {
    Refresh-ProcessPath

    $candidates = New-Object System.Collections.Generic.List[string]
    $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)

    $addCandidate = {
        param([string]$PathToAdd)
        if ($PathToAdd -and ($PathToAdd.Trim().Length -gt 0)) {
            $trimmed = $PathToAdd.Trim()
            if ($seen.Add($trimmed)) {
                [void]$candidates.Add($trimmed)
            }
        }
    }

    foreach ($verDir in @('Python313', 'Python312', 'Python311', 'Python310')) {
        if ($env:LOCALAPPDATA) {
            & $addCandidate (Join-Path $env:LOCALAPPDATA ("Programs\Python\$verDir\python.exe"))
        }
        if ($env:ProgramFiles) {
            & $addCandidate (Join-Path $env:ProgramFiles ("$verDir\python.exe"))
        }
    }

    $searchRoots = @()
    if ($env:LOCALAPPDATA) {
        $searchRoots += (Join-Path $env:LOCALAPPDATA 'Programs\Python')
    }
    if ($env:ProgramFiles) {
        $searchRoots += $env:ProgramFiles
    }
    $searchRoots += 'C:\'

    foreach ($baseRoot in $searchRoots) {
        if ($baseRoot -and (Test-Path $baseRoot)) {
            $dirs = Get-ChildItem -Path $baseRoot -Directory -Filter 'Python3*' -ErrorAction SilentlyContinue |
                Sort-Object Name -Descending
            foreach ($d in $dirs) {
                & $addCandidate (Join-Path $d.FullName 'python.exe')
            }
        }
    }

    $pyLaunchers = New-Object System.Collections.Generic.List[string]
    $pyCmd = Get-Command py -ErrorAction SilentlyContinue
    if ($pyCmd -and $pyCmd.Source) {
        [void]$pyLaunchers.Add($pyCmd.Source)
    }
    if ($env:LOCALAPPDATA) {
        $userPyLauncher = Join-Path $env:LOCALAPPDATA 'Programs\Python\Launcher\py.exe'
        if (Test-Path $userPyLauncher) { [void]$pyLaunchers.Add($userPyLauncher) }
    }
    if ($env:WINDIR) {
        $winPyLauncher = Join-Path $env:WINDIR 'py.exe'
        if (Test-Path $winPyLauncher) { [void]$pyLaunchers.Add($winPyLauncher) }
    }
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        foreach ($launcherExe in $pyLaunchers) {
            foreach ($flag in @('-3.12', '-3.13', '-3.11', '-3.10', '-3')) {
                try {
                    $exeOut = & $launcherExe $flag -c "import sys; print(sys.executable)" 2>$null
                    if (($LASTEXITCODE -eq 0) -and $exeOut) {
                        & $addCandidate ([string]($exeOut | Select-Object -First 1))
                    }
                } catch {}
            }
        }
    } finally {
        $ErrorActionPreference = $prevEap
    }

    foreach ($cmdName in @('python', 'python3')) {
        $cmds = Get-Command $cmdName -All -ErrorAction SilentlyContinue
        foreach ($c in $cmds) {
            if ($c.Source -and ($c.Source -notmatch '[\\/]Microsoft[\\/]WindowsApps[\\/]')) {
                & $addCandidate $c.Source
            }
        }
    }

    foreach ($cand in $candidates) {
        if (Test-UsableSystemPython -CandidatePath $cand) {
            return $cand
        }
    }
    return $null
}

function Install-PythonRuntime {
    Write-Host '[PRE-INSTALL 1/3] May chua co Python (>= 3.10). Dang tu dong cai dat Python 3.12 (khong can quyen Admin)...' -ForegroundColor Yellow

    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($winget -and $winget.Source) {
        Write-Host '[PRE-INSTALL] Thu cai dat nhanh qua Windows Package Manager (winget)...' -ForegroundColor Cyan
        try {
            $wgProc = Start-Process -FilePath $winget.Source `
                -ArgumentList 'install', '-e', '--id', 'Python.Python.3.12', '--scope', 'user', '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity' `
                -NoNewWindow -Wait -PassThru
            $foundAfterWg = Resolve-SystemPython
            if ($foundAfterWg) {
                Write-Host "[OK] Da cai dat Python thanh cong qua winget: $foundAfterWg" -ForegroundColor Green
                return $foundAfterWg
            }
            Write-Warning "winget ket thuc (exit=$($wgProc.ExitCode)) nhung chua thay Python. Chuyen sang tai goi chinh thuc tu python.org..."
        } catch {
            Write-Warning "Khong the dung winget ($($_)). Chuyen sang tai goi chinh thuc tu python.org..."
        }
    }

    $pyUrl = 'https://www.python.org/ftp/python/3.12.10/python-3.12.10-amd64.exe'
    if (([string]$env:PROCESSOR_ARCHITECTURE).ToUpperInvariant() -eq 'ARM64') {
        $pyUrl = 'https://www.python.org/ftp/python/3.12.10/python-3.12.10-arm64.exe'
    } elseif (-not ([Environment]::Is64BitOperatingSystem)) {
        $pyUrl = 'https://www.python.org/ftp/python/3.12.10/python-3.12.10.exe'
    }

    $installerExe = Join-Path $env:TEMP 'pocketwms-python-3.12.10-setup.exe'
    Remove-Item $installerExe -Force -ErrorAction SilentlyContinue

    try {
        Write-Host "[PRE-INSTALL] Dang tai trinh cai dat chinh thuc: $pyUrl" -ForegroundColor Cyan
        $curlCmd = Get-Command curl.exe -ErrorAction SilentlyContinue
        if ($curlCmd -and $curlCmd.Source) {
            & $curlCmd.Source -fL --retry 3 --connect-timeout 15 -o $installerExe $pyUrl | Out-Host
        } else {
            Invoke-WebRequest -Uri $pyUrl -OutFile $installerExe -UseBasicParsing -TimeoutSec 180
        }

        if ((-not (Test-Path $installerExe)) -or ((Get-Item $installerExe).Length -lt 10MB)) {
            throw 'File cai dat Python tai ve bi thieu hoac khong hop le.'
        }

        $sig = Get-AuthenticodeSignature -FilePath $installerExe -ErrorAction SilentlyContinue
        if ((-not $sig) -or ($sig.Status -ne 'Valid')) {
            throw 'Chu ky so cua trinh cai dat Python khong hop le; tu choi chay vi ly do bao mat.'
        }

        $targetPyDir = Join-Path $env:LOCALAPPDATA 'Programs\Python\Python312'
        Write-Host '[PRE-INSTALL] Dang cai dat ngam Python 3.12 cho tai khoan hien tai (vui long cho)...' -ForegroundColor Cyan
        $instProc = Start-Process -FilePath $installerExe `
            -ArgumentList '/quiet', 'InstallAllUsers=0', 'PrependPath=1', 'Include_pip=1', 'Include_venv=1', 'Include_tcltk=0', 'Include_test=0', 'Include_doc=0', 'Shortcuts=0', ("TargetDir=" + $targetPyDir) `
            -Wait -PassThru
        if ($instProc.ExitCode -ne 0) {
            throw "Trinh cai dat Python tra ve ma loi $($instProc.ExitCode)."
        }

        $foundAfterOrg = Resolve-SystemPython
        if (-not $foundAfterOrg) {
            throw "Da cai dat Python nhung khong tim thay python.exe tai $targetPyDir."
        }
        Write-Host "[OK] Da cai dat Python thanh cong: $foundAfterOrg" -ForegroundColor Green
        return $foundAfterOrg
    } catch {
        throw "Khong the tu dong cai dat Python ($($_)). Vui long cai thu cong Python 3.12+ (tick 'Add python.exe to PATH') tu https://www.python.org/downloads/"
    } finally {
        Remove-Item $installerExe -Force -ErrorAction SilentlyContinue
    }
}

function Ensure-PythonEnvironment {
    param([switch]$ForceSyncDeps)

    $expectedHash = if (Test-Path $ReqFile) { (Get-FileHash -Path $ReqFile -Algorithm SHA256).Hash } else { '' }

    if ((-not $ForceSyncDeps) -and (Test-Path $PythonExe)) {
        $savedHash = Read-TextTrimmed -Path $ReqHashFile
        if ($expectedHash -and ($savedHash -eq $expectedHash)) {
            if (Test-PythonImports -ExePath $PythonExe -ImportExpr 'import fastapi, uvicorn') {
                return $true
            }
        } else {
            if (Test-PythonImports -ExePath $PythonExe -ImportExpr 'import fastapi, uvicorn, sqlalchemy, numpy, qrcode, bcrypt, jwt') {
                if ($expectedHash) {
                    Write-TextNoBom -Path $ReqHashFile -Value $expectedHash
                }
                return $true
            }
        }
    }

    $venvPythonOk = Test-PythonImports -ExePath $PythonExe -ImportExpr 'import sys'
    if (-not $venvPythonOk) {
        $sysPy = Resolve-SystemPython
        if (-not $sysPy) {
            $sysPy = Install-PythonRuntime
        } else {
            Write-Host "[PRE-INSTALL 1/3] Da tim thay Python he thong: $sysPy" -ForegroundColor Cyan
        }

        if (Test-Path $VenvDir) {
            Write-Host '[PRE-INSTALL] Dang lam sach moi truong ao .venv bi loi...' -ForegroundColor Yellow
            Remove-Item $VenvDir -Recurse -Force -ErrorAction SilentlyContinue
        }

        Write-Host "[PRE-INSTALL 2/3] Dang tao moi truong ao backend\.venv..." -ForegroundColor Cyan
        $venvExit = Invoke-NativeQuiet -ExePath $sysPy -ArgumentList @('-m', 'venv', $VenvDir)
        if (($venvExit -ne 0) -or (-not (Test-Path $PythonExe))) {
            throw "Tao moi truong ao .venv that bai voi $sysPy"
        }
    }

    if ((Invoke-NativeQuiet -ExePath $PythonExe -ArgumentList @('-m', 'pip', '--version') -SuppressOutput) -ne 0) {
        Write-Host '[PRE-INSTALL] Dang khoi phuc pip cho moi truong ao...' -ForegroundColor Cyan
        if ((Invoke-NativeQuiet -ExePath $PythonExe -ArgumentList @('-m', 'ensurepip', '--upgrade')) -ne 0) {
            throw 'Khong the khoi tao pip trong backend\.venv'
        }
    }

    if (Test-Path $ReqFile) {
        Write-Host '[PRE-INSTALL 3/3] Dang cai dat / dong bo thu vien Python (FastAPI, SQLAlchemy, NumPy, QR)...' -ForegroundColor Cyan
        if ((Invoke-NativeQuiet -ExePath $PythonExe -ArgumentList @('-m', 'pip', 'install', '--disable-pip-version-check', '--prefer-binary', '-r', $ReqFile)) -ne 0) {
            throw 'Cai dat thu vien tu backend\requirements.txt that bai. Vui long kiem tra ket noi mang.'
        }
    }

    if (-not (Test-PythonImports -ExePath $PythonExe -ImportExpr 'import fastapi, uvicorn, sqlalchemy, numpy, qrcode, bcrypt, jwt')) {
        throw 'Thieu module Python bat buoc sau khi cai dat backend\requirements.txt'
    }

    if ($expectedHash) {
        Write-TextNoBom -Path $ReqHashFile -Value $expectedHash
    }
    return $true
}

function Ensure-Backend {
    if (Test-LocalHealth) {
        $ownerPid = Get-ListeningPort8000Pid
        if ($ownerPid) {
            Write-TextNoBom -Path $UvicornPidFile -Value ([string]$ownerPid)
        }
        return $true
    }

    [void](Ensure-PythonEnvironment)

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

function Invoke-StopAll {
    $stoppedAny = $false

    $legacyCf = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object { ($_.Name -eq 'cloudflared.exe') -and ($_.CommandLine -match '127\.0\.0\.1:8000') }
    foreach ($cp in $legacyCf) {
        Stop-Process -Id $cp.ProcessId -Force -ErrorAction SilentlyContinue
        $stoppedAny = $true
    }
    Remove-Item (Join-Path $LogsDir 'cloudflared.*'), (Join-Path $LogsDir 'public_url.txt') -Force -ErrorAction SilentlyContinue

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
        Write-Host '[PocketWMS] Server hien khong chay.'
    }
}

function Backup-AndCheckpointDatabase {
    if (-not (Test-Path $DbFile)) {
        return $null
    }
    if (-not (Test-Path $BackupsDir)) {
        New-Item -ItemType Directory -Force -Path $BackupsDir | Out-Null
    }
    if (Test-Path $PythonExe) {
        & $PythonExe -c "import sqlite3, sys; c = sqlite3.connect(sys.argv[1]); c.execute('PRAGMA wal_checkpoint(TRUNCATE)'); c.close()" $DbFile 2>$null | Out-Null
    }
    $stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
    $backupName = "smart_wms_before_update_${stamp}.db"
    $backupPath = Join-Path $BackupsDir $backupName
    Copy-Item -Path $DbFile -Destination $backupPath -Force

    $oldBackups = Get-ChildItem -Path $BackupsDir -Filter 'smart_wms_before_update_*.db' -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -Skip 5
    foreach ($old in $oldBackups) {
        Remove-Item $old.FullName -Force -ErrorAction SilentlyContinue
    }
    return $backupPath
}

function Test-DatabaseIntegrity {
    if (-not (Test-Path $DbFile)) {
        return $false
    }
    if (Test-Path $PythonExe) {
        $chk = & $PythonExe -c "import sqlite3, sys; c = sqlite3.connect(sys.argv[1]); r = c.execute('PRAGMA quick_check').fetchone()[0]; c.close(); print(r)" $DbFile 2>$null
        $firstLine = ($chk | Select-Object -First 1)
        return (($LASTEXITCODE -eq 0) -and ("$firstLine".Trim() -eq 'ok'))
    }
    return (Test-Path $DbFile)
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
    $sc.Description = 'Tu khoi dong ngam PocketWMS Local Wi-Fi Server'
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

    Write-Host '[3/4] Dang dung Server, sao luu DB va cap nhat ma nguon an toan...'
    Invoke-StopAll

    $hadDbBefore = (Test-Path $DbFile)
    $backupPath = if ($hadDbBefore) { Backup-AndCheckpointDatabase } else { $null }
    if ($backupPath) {
        Write-Host "[3/4] Da sao luu an toan database tai: $backupPath" -ForegroundColor Cyan
    }

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
            ($relPath -match '\.(db|db-shm|db-wal|db-journal)$') -or
            ($file.Name -eq '.env') -or
            ($relPath -match '(^|[\\/])(\.venv|venv|node_modules|\.git)([\\/]|$)') -or
            ($relPath -match '^backend[\\/](logs|backups)([\\/]|$)') -or
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

    if ($hadDbBefore -and (-not (Test-DatabaseIntegrity))) {
        if ($backupPath -and (Test-Path $backupPath)) {
            Copy-Item -Path $backupPath -Destination $DbFile -Force
        }
        throw 'Phat hien loi file database sau khi giai nen; da tu dong khoi phuc ban sao luu an toan!'
    }

    if (-not (Test-Path (Join-Path $sourceRoot 'VERSION'))) {
        Write-TextNoBom -Path $VersionFile -Value $UpdateInfo.RemoteVer
    }

    if (Test-Path $ReqFile) {
        Write-Host '[4/4] Dang kiem tra Python & dong bo thu vien backend...'
        [void](Ensure-PythonEnvironment -ForceSyncDeps)
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
        Write-Host 'BACKEND     : ONLINE (Dang chay ngam - Local / Wi-Fi LAN)' -ForegroundColor Green
        $ownerPid = Get-ListeningPort8000Pid
        if ($ownerPid) {
            $proc = Get-Process -Id $ownerPid -ErrorAction SilentlyContinue
            if ($proc) {
                $ramMb = [math]::Round($proc.WorkingSet64 / 1MB, 1)
                Write-Host "PID / RAM   : $ownerPid / $ramMb MB"
            }
        }
        try { Set-Clipboard -Value "http://${lanIp}:8000" } catch {}
    } else {
        Write-Host 'BACKEND     : OFFLINE' -ForegroundColor Red
    }

    Write-Host "WebApp LAN  : http://${lanIp}:8000 (Da COPY)" -ForegroundColor Cyan
    Write-Host 'Localhost   : http://localhost:8000' -ForegroundColor White
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

    if ($localOnline) {
        Invoke-PrintQrCode -Url "http://${lanIp}:8000" -Caption 'QUET MA QR DE MO APP CUNG WI-FI (LAN):'
    }
}

function Invoke-PrintStartBanner {
    param([string]$LanIp)

    $lanUrl = "http://${LanIp}:8000"
    try { Set-Clipboard -Value $lanUrl } catch {}
    Write-Host ''
    Write-Host '==========================================================================' -ForegroundColor Green
    Write-Host "  WebApp Wi-Fi LAN (Da COPY) : $lanUrl" -ForegroundColor Cyan
    Write-Host '  WebApp tren may nay (Local): http://localhost:8000' -ForegroundColor White
    Write-Host "  API URL LAN                : $lanUrl/api/v1" -ForegroundColor White
    Write-Host '  Che do Offline             : Tu luu tren may va dong bo khi co mang' -ForegroundColor Yellow
    Write-Host '==========================================================================' -ForegroundColor Green
    Invoke-PrintQrCode -Url $lanUrl -Caption 'QUET MA QR DE MO APP CUNG WI-FI (LAN):'
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
        Write-Host '[PocketWMS] Dang kiem tra / khoi dong ngam Backend Local Wi-Fi...'
        [void](Ensure-Backend)

        $running = $true
        while ($running) {
            Write-Host ''
            Write-Host '==========================================================================' -ForegroundColor Green
            Invoke-ShowStatus
            Write-Host '--------------------------------------------------------------------------' -ForegroundColor DarkGray
            Write-Host '  [Enter] Dong cua so (Backend van chay ngam)'
            Write-Host '  [1]     Bat Server / Hien thi ma QR Wi-Fi LAN'
            Write-Host '  [2]     Tat Backend Server'
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
                    Write-Host '[...] Dang khoi dong Backend Local Wi-Fi...'
                    [void](Ensure-Backend)
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
        Write-Host '[1/1] Dang kiem tra / khoi dong Backend PocketWMS (cong 8000)...'
        [void](Ensure-Backend)
        Invoke-PrintStartBanner -LanIp $lanIp
        Write-Host '  * Ban co the DONG cua so nay, Server van chay ngam.'
        Write-Host '  * Chay start-wms.bat de xem ma QR, tat server, hoac bat tu khoi dong.'
    }
    'start-silent' {
        Repair-LegacyAutostart
        [void](Ensure-Backend)
    }
    'setup' {
        [void](Ensure-PythonEnvironment)
        Write-Host '[OK] Moi truong Python & thu vien Backend da san sang!' -ForegroundColor Green
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
