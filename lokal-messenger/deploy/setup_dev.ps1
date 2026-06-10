#Requires -RunAsAdministrator
param(
    [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot)
)

$ProjectRoot = $ProjectRoot.Trim().Trim('"').TrimEnd('\')

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$DB_PASSWORD    = "STRONG_DB_PASSWORD"
$ADMIN_PASSWORD = "AdminParol123!"
$INSTALL_ROOT   = "C:\lokal-msg"
$PG_VERSION     = "16"
$PG_BIN         = "C:\Program Files\PostgreSQL\$PG_VERSION\bin"
$PG_DATA        = "C:\Program Files\PostgreSQL\$PG_VERSION\data"
$SERVER_DIR     = Join-Path $ProjectRoot "server"
$CLIENT_DIR     = Join-Path $ProjectRoot "client"
$DEPLOY_DIR     = Join-Path $ProjectRoot "deploy"
$GO_VERSION     = "1.24.2"
$NODE_VERSION   = "22.16.0"
$GIT_VERSION    = "2.49.0"

function Write-Step { param($m) Write-Host "" ; Write-Host ">> $m" -ForegroundColor Cyan }
function Write-OK   { param($m) Write-Host "   [OK] $m" -ForegroundColor Green }
function Write-Warn { param($m) Write-Host "   [!!] $m" -ForegroundColor Yellow }
function Write-Err  { param($m) Write-Host "   [XX] $m" -ForegroundColor Red }

function Refresh-Path {
    $machine = [Environment]::GetEnvironmentVariable("PATH", "Machine")
    $user    = [Environment]::GetEnvironmentVariable("PATH", "User")
    $env:PATH = "$machine;$user"
}

function Add-MachinePath {
    param([string]$Dir)
    if (-not (Test-Path $Dir)) { return }
    $machinePath = [Environment]::GetEnvironmentVariable("PATH", "Machine")
    if ($machinePath -notlike "*$Dir*") {
        [Environment]::SetEnvironmentVariable("PATH", "$Dir;$machinePath", "Machine")
    }
    if ($env:PATH -notlike "*$Dir*") {
        $env:PATH = "$Dir;$env:PATH"
    }
}

function Test-Cmd {
    param([string]$Name)
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Get-WingetExe {
    $cmd = Get-Command winget -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $localApp = Join-Path $env:LOCALAPPDATA "Microsoft\WindowsApps\winget.exe"
    if (Test-Path $localApp) { return $localApp }
    $glob = Get-ChildItem "$env:ProgramFiles\WindowsApps\Microsoft.DesktopAppInstaller*" -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending | Select-Object -First 1
    if ($glob) {
        $exe = Join-Path $glob.FullName "winget.exe"
        if (Test-Path $exe) { return $exe }
    }
    return $null
}

function Invoke-Download {
    param([string]$Url, [string]$OutFile)
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $Url -OutFile $OutFile -UseBasicParsing
}

function Install-WingetPackage {
    param([string]$Id)
    $winget = Get-WingetExe
    if (-not $winget) { return $false }
    $listed = & $winget list --id $Id -e 2>$null
    if ($LASTEXITCODE -eq 0 -and ($listed -match [regex]::Escape($Id))) {
        return $true
    }
    & $winget install --id $Id -e --accept-package-agreements --accept-source-agreements --silent | Out-Null
    return ($LASTEXITCODE -eq 0)
}

function Install-GoFallback {
    if (Test-Path "C:\Program Files\Go\bin\go.exe") {
        Add-MachinePath "C:\Program Files\Go\bin"
        return
    }
    $msi = Join-Path $INSTALL_ROOT "tmp\go.msi"
    $url = "https://go.dev/dl/go$GO_VERSION.windows-amd64.msi"
    Invoke-Download $url $msi
    Start-Process msiexec.exe -ArgumentList "/i", $msi, "/quiet", "/norestart" -Wait -NoNewWindow
    Add-MachinePath "C:\Program Files\Go\bin"
}

function Install-NodeFallback {
    if (Test-Path "C:\Program Files\nodejs\node.exe") {
        Add-MachinePath "C:\Program Files\nodejs"
        return
    }
    $msi = Join-Path $INSTALL_ROOT "tmp\node.msi"
    $url = "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-x64.msi"
    Invoke-Download $url $msi
    Start-Process msiexec.exe -ArgumentList "/i", $msi, "/quiet", "/norestart" -Wait -NoNewWindow
    Add-MachinePath "C:\Program Files\nodejs"
}

function Install-GitFallback {
    if (Test-Path "C:\Program Files\Git\cmd\git.exe") {
        Add-MachinePath "C:\Program Files\Git\cmd"
        Add-MachinePath "C:\Program Files\Git\bin"
        return
    }
    $exe = Join-Path $INSTALL_ROOT "tmp\git-installer.exe"
    $url = "https://github.com/git-for-windows/git/releases/download/v$GIT_VERSION.windows.1/Git-$GIT_VERSION-64-bit.exe"
    Invoke-Download $url $exe
    Start-Process -FilePath $exe -ArgumentList "/VERYSILENT", "/NORESTART", "/NOCANCEL" -Wait -NoNewWindow
    Add-MachinePath "C:\Program Files\Git\cmd"
    Add-MachinePath "C:\Program Files\Git\bin"
}

function Ensure-Tool {
    param(
        [string]$Name,
        [string]$WingetId,
        [scriptblock]$Fallback,
        [string[]]$KnownDirs = @()
    )
    if (Test-Cmd $Name) {
        Write-OK "$Name mavjud"
        return $true
    }
    foreach ($dir in $KnownDirs) {
        Add-MachinePath $dir
        if (Test-Cmd $Name) {
            Write-OK "$Name mavjud"
            return $true
        }
    }
    Write-Host "   $Name o'rnatilmoqda..."
    if ($WingetId) {
        Install-WingetPackage $WingetId | Out-Null
        Refresh-Path
        if (Test-Cmd $Name) {
            Write-OK "$Name winget orqali o'rnatildi"
            return $true
        }
    }
    if ($Fallback) {
        & $Fallback
        Refresh-Path
        if (Test-Cmd $Name) {
            Write-OK "$Name o'rnatildi"
            return $true
        }
    }
    Write-Err "$Name o'rnatilmadi"
    return $false
}

$script:PgSession = @{
    User     = 'msg'
    Password = $DB_PASSWORD
    Database = 'lokal_messenger'
    PgHost   = '127.0.0.1'
    Port     = '5432'
}

function Get-ConfigDbCredentials {
    $defaults = @{
        User     = 'msg'
        Password = $DB_PASSWORD
        Database = 'lokal_messenger'
        PgHost   = '127.0.0.1'
        Port     = '5432'
    }
    $cfgPath = Join-Path $SERVER_DIR 'config.yaml'
    if (-not (Test-Path $cfgPath)) { return $defaults }
    $raw = Get-Content $cfgPath -Raw
    if ($raw -match 'postgres://([^:\s"]+):([^@\s"]+)@([^:/\s"]+)(?::(\d+))?/([^?\s"]+)') {
        $hostVal = $Matches[3]
        if ($hostVal -eq 'localhost') { $hostVal = '127.0.0.1' }
        return @{
            User     = $Matches[1]
            Password = [Uri]::UnescapeDataString($Matches[2])
            PgHost   = $hostVal
            Port     = if ($Matches[4]) { $Matches[4] } else { '5432' }
            Database = $Matches[5]
        }
    }
    return $defaults
}

function Set-PgSession {
    param(
        [string]$User,
        [string]$Password,
        [string]$Database,
        [string]$PgHost = '127.0.0.1',
        [string]$Port = '5432'
    )
    $script:PgSession.User     = $User
    $script:PgSession.Password = $Password
    $script:PgSession.Database = $Database
    $script:PgSession.PgHost   = $PgHost
    $script:PgSession.Port     = $Port
}

function Escape-CmdArgument {
    param([string]$Arg)
    if ($Arg -match '[\s"]') {
        return '"' + ($Arg.Replace('"', '\"')) + '"'
    }
    return $Arg
}

function Test-PgDirect {
    param(
        [Parameter(Mandatory)][string]$Psql,
        [Parameter(Mandatory)][string]$User,
        [Parameter(Mandatory)][string]$Password,
        [Parameter(Mandatory)][string]$Database,
        [string]$PgHost = '127.0.0.1',
        [string]$Port = '5432'
    )
    $prevUser = $script:PgSession.User
    $prevPass = $script:PgSession.Password
    $prevDb   = $script:PgSession.Database
    $prevHost = $script:PgSession.PgHost
    $prevPort = $script:PgSession.Port
    try {
        Set-PgSession -User $User -Password $Password -Database $Database -PgHost $PgHost -Port $Port
        $null = Invoke-Psql -Psql $Psql -Scalar -Command "SELECT 1"
        return $true
    } catch {
        return $false
    } finally {
        Set-PgSession -User $prevUser -Password $prevPass -Database $prevDb -PgHost $prevHost -Port $prevPort
    }
}

function Invoke-Psql {
    param(
        [Parameter(Mandatory)][string]$Psql,
        [string]$User,
        [string]$Database,
        [string]$PgHost,
        [string]$File,
        [string]$Command,
        [switch]$Scalar
    )
    $pgUser = if ($User) { $User } else { $script:PgSession.User }
    $pgDb   = if ($Database) { $Database } else { $script:PgSession.Database }
    $pgHostVal = if ($PgHost) { $PgHost } else { $script:PgSession.PgHost }
    if ($pgHostVal -eq 'localhost') { $pgHostVal = '127.0.0.1' }
    $pgPass = $script:PgSession.Password
    $pgPort = $script:PgSession.Port

    $outFile = Join-Path $INSTALL_ROOT "tmp\psql_$([guid]::NewGuid().ToString('N')).out"
    $errFile = Join-Path $INSTALL_ROOT "tmp\psql_$([guid]::NewGuid().ToString('N')).err"

    $argParts = @('-w', '-q', '-v', 'ON_ERROR_STOP=1')
    if ($Scalar) { $argParts += @('-t', '-A') }
    if ($File) { $argParts += @('-f', $File) }
    if ($Command) { $argParts += @('-c', $Command) }

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $Psql
    $psi.Arguments = ($argParts | ForEach-Object { Escape-CmdArgument $_ }) -join ' '
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    $psi.EnvironmentVariables['PGHOST'] = $pgHostVal
    $psi.EnvironmentVariables['PGPORT'] = $pgPort
    $psi.EnvironmentVariables['PGUSER'] = $pgUser
    $psi.EnvironmentVariables['PGDATABASE'] = $pgDb
    if ($null -ne $pgPass -and $pgPass -ne '') {
        $psi.EnvironmentVariables['PGPASSWORD'] = $pgPass
    } elseif ($psi.EnvironmentVariables.ContainsKey('PGPASSWORD')) {
        $psi.EnvironmentVariables.Remove('PGPASSWORD')
    }

    $stdout = ''
    $stderr = ''
    $exitCode = 1
    $proc = New-Object System.Diagnostics.Process
    $proc.StartInfo = $psi
    try {
        [void]$proc.Start()
        if (-not $proc.WaitForExit(20000)) {
            try { $proc.Kill() } catch { }
            throw "psql javob bermadi (20 soniya)"
        }
        $stdout = $proc.StandardOutput.ReadToEnd()
        $stderr = $proc.StandardError.ReadToEnd()
        $exitCode = $proc.ExitCode
    } finally {
        if (-not $proc.HasExited) {
            try { $proc.Kill() } catch { }
        }
        $proc.Dispose()
        Remove-Item $outFile, $errFile -ErrorAction SilentlyContinue
    }

    if ($exitCode -ne 0) {
        $errLines = ($stderr -split "`r?`n") | Where-Object {
            $_ -and $_ -notmatch '^\s*NOTICE:' -and $_ -notmatch ': NOTICE:'
        }
        $errMsg = ($errLines -join "`n").Trim()
        if (-not $errMsg) { $errMsg = $stderr.Trim() }
        $logFile = Join-Path $INSTALL_ROOT "tmp\psql_last_err.txt"
        try { Set-Content -Path $logFile -Value $stderr -Encoding UTF8 -Force } catch { }
        throw "psql xato (code ${exitCode}): $errMsg"
    }

    if ($Scalar) {
        $val = ($stdout -split "`r?`n") | Where-Object { $_ -and $_ -notmatch 'NOTICE:' } | Select-Object -Last 1
        return "$val".Trim()
    }
}

function Test-PgConnection {
    param(
        [Parameter(Mandatory)][string]$Psql,
        [string]$User,
        [string]$Database,
        [string]$PgHost,
        [string]$Port,
        [string]$Password
    )
    $prevUser = $script:PgSession.User
    $prevPass = $script:PgSession.Password
    $prevDb   = $script:PgSession.Database
    $prevHost = $script:PgSession.PgHost
    $prevPort = $script:PgSession.Port
    try {
        Set-PgSession `
            -User $(if ($User) { $User } else { $prevUser }) `
            -Password $(if ($null -ne $Password) { $Password } else { $prevPass }) `
            -Database $(if ($Database) { $Database } else { $prevDb }) `
            -PgHost $(if ($PgHost) { $PgHost } else { $prevHost }) `
            -Port $(if ($Port) { $Port } else { $prevPort })
        $null = Invoke-Psql -Psql $Psql -Scalar -Command "SELECT 1"
        return $true
    } catch {
        return $false
    } finally {
        Set-PgSession -User $prevUser -Password $prevPass -Database $prevDb -PgHost $prevHost -Port $prevPort
    }
}

function Test-PgConnectionWithRetry {
    param(
        [Parameter(Mandatory)][string]$Psql,
        [int]$MaxAttempts = 3
    )
    for ($i = 1; $i -le $MaxAttempts; $i++) {
        if (Test-PgConnection -Psql $Psql) { return $true }
        Start-Sleep -Seconds 2
    }
    return $false
}

function Get-PgDataDir {
    param([Parameter(Mandatory)][string]$PgBin)
    $data = Join-Path (Split-Path $PgBin -Parent) "data"
    if (Test-Path (Join-Path $data "pg_hba.conf")) { return $data }
    if (Test-Path (Join-Path $PG_DATA "pg_hba.conf")) { return $PG_DATA }
    return $null
}

function Reload-PgCluster {
    param([Parameter(Mandatory)][string]$PgBin)
    $dataDir = Get-PgDataDir -PgBin $PgBin
    if ($dataDir) {
        $pgCtl = Join-Path $PgBin "pg_ctl.exe"
        & $pgCtl reload -D $dataDir | Out-Null
        Start-Sleep -Seconds 2
        return
    }
    $svc = Get-Service "postgresql*" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($svc -and $svc.Status -ne 'Running') {
        Start-Service $svc.Name
        Start-Sleep -Seconds 3
    }
}

function Restart-PgCluster {
    param([Parameter(Mandatory)][string]$PgBin)
    $svc = Get-Service "postgresql*" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($svc) {
        if ($svc.Status -ne 'Running') { Start-Service $svc.Name }
        else { Restart-Service $svc.Name -Force -ErrorAction SilentlyContinue }
        Start-Sleep -Seconds 3
        return
    }
    Reload-PgCluster -PgBin $PgBin
}

function Enable-PgLocalTrust {
    param([Parameter(Mandatory)][string]$PgBin)
    $dataDir = Get-PgDataDir -PgBin $PgBin
    if (-not $dataDir) { throw "pg_hba.conf topilmadi" }
    $hba = Join-Path $dataDir "pg_hba.conf"
    $bak = Join-Path $INSTALL_ROOT "tmp\pg_hba.conf.bak"
    if (-not (Test-Path $bak)) {
        Copy-Item $hba $bak -Force
    }
    $content = Get-Content $hba -Raw
    $content = $content -replace '(?ms)^# lokal-messenger setup trust \(vaqtincha\)\r?\nhost[^\r\n]+\r?\nhost[^\r\n]+\r?\n', ''
    $trustBlock = @(
        "# lokal-messenger setup trust (vaqtincha)",
        "host    all    all    127.0.0.1/32    trust",
        "host    all    all    ::1/128         trust"
    ) -join "`r`n"
    Set-Content -Path $hba -Value ($trustBlock + "`r`n" + $content.TrimStart()) -Encoding ASCII
    Restart-PgCluster -PgBin $PgBin
    Start-Sleep -Seconds 4
}

function Disable-PgLocalTrust {
    param([Parameter(Mandatory)][string]$PgBin)
    $dataDir = Get-PgDataDir -PgBin $PgBin
    if (-not $dataDir) { return }
    $hba = Join-Path $dataDir "pg_hba.conf"
    $bak = Join-Path $INSTALL_ROOT "tmp\pg_hba.conf.bak"
    if (Test-Path $bak) {
        Copy-Item $bak $hba -Force
        Restart-PgCluster -PgBin $PgBin
        Start-Sleep -Seconds 3
    }
}

function Ensure-PgDatabase {
    param(
        [Parameter(Mandatory)][string]$Psql,
        [Parameter(Mandatory)][string]$PgBin
    )

    $cfgDb = Get-ConfigDbCredentials
    if ($cfgDb.PgHost -eq 'localhost') { $cfgDb.PgHost = '127.0.0.1' }
    Write-Host "   lokal_messenger bazasi tekshirilmoqda..."

    if (Test-PgDirect -Psql $Psql -User $cfgDb.User -Password $cfgDb.Password -Database $cfgDb.Database -PgHost $cfgDb.PgHost -Port $cfgDb.Port) {
        Set-PgSession -User $cfgDb.User -Password $DB_PASSWORD -Database $cfgDb.Database -PgHost $cfgDb.PgHost -Port $cfgDb.Port
        Write-OK "lokal_messenger bazasi mavjud (ishlatilayotgan kompyuter)"
        return
    }
    if ($cfgDb.Password -ne $DB_PASSWORD) {
        if (Test-PgDirect -Psql $Psql -User 'msg' -Password $DB_PASSWORD -Database 'lokal_messenger') {
            Set-PgSession -User 'msg' -Password $DB_PASSWORD -Database 'lokal_messenger' -PgHost '127.0.0.1' -Port '5432'
            Write-OK "lokal_messenger bazasi mavjud (ishlatilayotgan kompyuter)"
            return
        }
    }

    $passwordsToTry = @($cfgDb.Password, $DB_PASSWORD) | Where-Object { $_ } | Select-Object -Unique
    foreach ($pass in $passwordsToTry) {
        Set-PgSession -User $cfgDb.User -Password $pass -Database $cfgDb.Database -PgHost $cfgDb.PgHost -Port $cfgDb.Port
        if (Test-PgConnection -Psql $Psql) {
            Set-PgSession -User $cfgDb.User -Password $DB_PASSWORD -Database $cfgDb.Database -PgHost $cfgDb.PgHost -Port $cfgDb.Port
            Write-OK "lokal_messenger bazasi mavjud (ishlatilayotgan kompyuter)"
            return
        }
    }

    Write-Host "   PostgreSQL foydalanuvchi/bazasi sozlanmoqda..."
    $pgSetupSql = Join-Path $INSTALL_ROOT "tmp\pg_setup.sql"
    Set-Content -Path $pgSetupSql -Encoding ASCII -Value @(
        'DO $$',
        'BEGIN',
        '  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ''msg'') THEN',
        "    CREATE USER msg WITH PASSWORD '$DB_PASSWORD';",
        '  ELSE',
        "    ALTER USER msg WITH PASSWORD '$DB_PASSWORD';",
        '  END IF;',
        'END $$;',
        'SELECT ''CREATE DATABASE lokal_messenger OWNER msg''',
        'WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = ''lokal_messenger'')\gexec',
        'GRANT ALL PRIVILEGES ON DATABASE lokal_messenger TO msg;'
    )

    $usedTrust = $false
    if (Test-PgDirect -Psql $Psql -User 'postgres' -Password $DB_PASSWORD -Database 'postgres') {
        $super = @{ User = 'postgres'; Password = $DB_PASSWORD; Database = 'postgres'; PgHost = '127.0.0.1'; Port = '5432' }
    } else {
        Write-Host "   PostgreSQL local trust vaqtincha yoqilmoqda..."
        Enable-PgLocalTrust -PgBin $PgBin
        $usedTrust = $true
        if (-not (Test-PgDirect -Psql $Psql -User 'postgres' -Password '' -Database 'postgres')) {
            if ($usedTrust) { Disable-PgLocalTrust -PgBin $PgBin }
            throw "PostgreSQL superuser bilan ulanib bo'lmadi"
        }
        $super = @{ User = 'postgres'; Password = $null; Database = 'postgres'; PgHost = '127.0.0.1'; Port = '5432' }
    }

    try {
        Set-PgSession -User $super.User -Password $super.Password -Database $super.Database -PgHost $super.PgHost -Port $super.Port
        Invoke-Psql -Psql $Psql -File $pgSetupSql
        try {
            Invoke-Psql -Psql $Psql -Command "ALTER USER msg WITH PASSWORD '$DB_PASSWORD';"
        } catch { }
        try {
            Invoke-Psql -Psql $Psql -Command "ALTER USER postgres WITH PASSWORD '$DB_PASSWORD';"
        } catch {
            Write-Warn "postgres paroli o'zgartirilmadi (dev uchun muhim emas)"
        }
    } finally {
        if ($usedTrust) {
            Disable-PgLocalTrust -PgBin $PgBin
            Start-Sleep -Seconds 2
        }
    }

    Set-PgSession -User 'msg' -Password $DB_PASSWORD -Database 'lokal_messenger' -PgHost '127.0.0.1' -Port '5432'
    if (Test-PgDirect -Psql $Psql -User 'msg' -Password $DB_PASSWORD -Database 'lokal_messenger') {
        Write-OK "lokal_messenger bazasi yaratildi"
        return
    }

    throw "lokal_messenger bazasi yaratilmadi"
}

function Test-PgTableExists {
    param(
        [Parameter(Mandatory)][string]$Psql,
        [Parameter(Mandatory)][string]$Table
    )
    $safe = $Table.Replace("'", "''")
    $cnt = Invoke-Psql -Psql $Psql -User msg -Database lokal_messenger -Scalar `
        -Command "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='$safe';"
    return ($cnt -eq "1")
}

function Test-PgColumnExists {
    param(
        [Parameter(Mandatory)][string]$Psql,
        [Parameter(Mandatory)][string]$Table,
        [Parameter(Mandatory)][string]$Column
    )
    $t = $Table.Replace("'", "''")
    $c = $Column.Replace("'", "''")
    $cnt = Invoke-Psql -Psql $Psql -User msg -Database lokal_messenger -Scalar `
        -Command "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='$t' AND column_name='$c';"
    return ($cnt -eq "1")
}

function Test-MigrationAlreadyInDb {
    param(
        [Parameter(Mandatory)][string]$Psql,
        [Parameter(Mandatory)][string]$Filename
    )
    switch -Wildcard ($Filename) {
        '0001_*' { return (Test-PgTableExists -Psql $Psql -Table 'users') }
        '0002_*' { return (Test-PgColumnExists -Psql $Psql -Table 'users' -Column 'hide_last_seen') }
        '0003_*' { return (Test-PgColumnExists -Psql $Psql -Table 'users' -Column 'okrug_name') }
        '0004_*' { return (Test-PgColumnExists -Psql $Psql -Table 'users' -Column 'avatar_path') }
        '0005_*' { return (Test-PgColumnExists -Psql $Psql -Table 'chats' -Column 'description') }
        '0006_*' { return (Test-PgTableExists -Psql $Psql -Table 'group_key_envelopes') }
        default   { return $false }
    }
}

function Ensure-MigrationTable {
    param(
        [Parameter(Mandatory)][string]$Psql
    )
    Invoke-Psql -Psql $Psql -User msg -Database lokal_messenger -Command @"
CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
"@
}

function Test-MigrationApplied {
    param(
        [Parameter(Mandatory)][string]$Psql,
        [Parameter(Mandatory)][string]$Filename
    )
    $safe = $Filename.Replace("'", "''")
    $cnt = Invoke-Psql -Psql $Psql -User msg -Database lokal_messenger -Scalar `
        -Command "SELECT COUNT(*) FROM schema_migrations WHERE filename='$safe';"
    return ($cnt -eq "1")
}

function Register-Migration {
    param(
        [Parameter(Mandatory)][string]$Psql,
        [Parameter(Mandatory)][string]$Filename
    )
    $safe = $Filename.Replace("'", "''")
    Invoke-Psql -Psql $Psql -User msg -Database lokal_messenger -Command `
        "INSERT INTO schema_migrations (filename) VALUES ('$safe') ON CONFLICT DO NOTHING;"
}

function Find-PgBin {
    foreach ($ver in @(17, 16, 15, 14)) {
        $p = "C:\Program Files\PostgreSQL\$ver\bin\psql.exe"
        if (Test-Path $p) { return "C:\Program Files\PostgreSQL\$ver\bin" }
    }
    return $null
}

function Get-LanIPv4 {
    foreach ($nic in [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
        if ($nic.OperationalStatus -ne "Up") { continue }
        foreach ($addr in $nic.GetIPProperties().UnicastAddresses) {
            if ($addr.Address.AddressFamily -ne "InterNetwork") { continue }
            $ip = $addr.Address.ToString()
            if ($ip -match '^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)' -and $ip -ne "127.0.0.1") {
                return $ip
            }
        }
    }
    return "127.0.0.1"
}

function Find-OpenSsl {
    $paths = @(
        "C:\Program Files\Git\usr\bin\openssl.exe",
        "C:\Program Files (x86)\Git\usr\bin\openssl.exe"
    )
    foreach ($p in $paths) {
        if (Test-Path $p) { return $p }
    }
    return $null
}

# ── Boshlash ──────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host " ============================================================" -ForegroundColor Cyan
Write-Host "  Lokal-Messenger - Windows dev sozlash" -ForegroundColor Cyan
Write-Host " ============================================================" -ForegroundColor Cyan
Write-Host "  Loyiha: $ProjectRoot"

if (-not (Test-Path $SERVER_DIR)) {
    Write-Err "server papkasi topilmadi: $SERVER_DIR"
    exit 1
}

@("$INSTALL_ROOT\tls", "$INSTALL_ROOT\tmp") | ForEach-Object {
    New-Item -ItemType Directory -Force -Path $_ | Out-Null
}

Write-Step "1/9 - Git, Go, Node.js..."
$okGit  = Ensure-Tool "git"  "Git.Git"            { Install-GitFallback  } @("C:\Program Files\Git\cmd")
$okGo   = Ensure-Tool "go"   "Go.Go"               { Install-GoFallback   } @("C:\Program Files\Go\bin")
$okNode = Ensure-Tool "node" "OpenJS.NodeJS.LTS"   { Install-NodeFallback } @("C:\Program Files\nodejs")
$okNpm  = Ensure-Tool "npm"  "OpenJS.NodeJS.LTS"   { Install-NodeFallback } @("C:\Program Files\nodejs")
if (-not ($okGit -and $okGo -and $okNode -and $okNpm)) {
    Write-Err "Asosiy dasturlar to'liq o'rnatilmadi"
    exit 1
}

Write-Step "2/9 - C:\lokal-msg papkalari..."
Write-OK "TLS va tmp papkalar tayyor"

Write-Step "3/9 - PostgreSQL..."
Get-Process -Name psql -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
$pgBinFound = Find-PgBin
if (-not $pgBinFound -and -not (Test-Path "$PG_BIN\psql.exe")) {
    Write-Host "   PostgreSQL o'rnatilmoqda (3-5 daqiqa)..."
    $pgInstaller = Join-Path $INSTALL_ROOT "tmp\pg_installer.exe"
    $pgUrl = "https://get.enterprisedb.com/postgresql/postgresql-$PG_VERSION.6-1-windows-x64.exe"
    Invoke-Download $pgUrl $pgInstaller
    $pgArgs = @(
        "--mode", "unattended", "--superpassword", $DB_PASSWORD,
        "--servicename", "postgresql-x64-$PG_VERSION", "--servicepassword", $DB_PASSWORD,
        "--serverport", "5432", "--datadir", $PG_DATA
    )
    Start-Process -FilePath $pgInstaller -ArgumentList $pgArgs -Wait -NoNewWindow
    $pgBinFound = Find-PgBin
    if (-not $pgBinFound) { $pgBinFound = $PG_BIN }
    Write-OK "PostgreSQL o'rnatildi"
} else {
    $pgBinFound = if ($pgBinFound) { $pgBinFound } else { $PG_BIN }
    Write-OK "PostgreSQL mavjud"
}

$psqlExe = Join-Path $pgBinFound "psql.exe"
if (-not (Test-Path $psqlExe)) {
    Write-Err "psql.exe topilmadi"
    exit 1
}
Add-MachinePath $pgBinFound

$pgSvc = Get-Service "postgresql*" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($pgSvc -and $pgSvc.Status -ne "Running") {
    Start-Service $pgSvc.Name
    Start-Sleep -Seconds 3
}

try {
    Ensure-PgDatabase -Psql $psqlExe -PgBin $pgBinFound
} catch {
    Write-Err $_.Exception.Message
    exit 1
}
$cfgDb = Get-ConfigDbCredentials
Set-PgSession -User $cfgDb.User -Password $DB_PASSWORD -Database $cfgDb.Database -PgHost $cfgDb.PgHost -Port $cfgDb.Port

$migDir = Join-Path $SERVER_DIR "db\migrations"
if (Test-Path $migDir) {
    Ensure-MigrationTable -Psql $psqlExe
    $applied = 0
    $skipped = 0
    Get-ChildItem $migDir -Filter "*.sql" | Sort-Object Name | ForEach-Object {
        $name = $_.Name
        if (Test-MigrationApplied -Psql $psqlExe -Filename $name) {
            $skipped++
            return
        }
        if (Test-MigrationAlreadyInDb -Psql $psqlExe -Filename $name) {
            Register-Migration -Psql $psqlExe -Filename $name
            $skipped++
            return
        }
        Invoke-Psql -Psql $psqlExe -User msg -Database lokal_messenger -File $_.FullName
        Register-Migration -Psql $psqlExe -Filename $name
        $applied++
    }
    if ($applied -gt 0) {
        Write-OK "SQL migratsiyalar: $applied ta yangi bajarildi"
    } elseif ($skipped -gt 0) {
        Write-OK "SQL migratsiyalar: barchasi mavjud ($skipped ta)"
    } else {
        Write-OK "SQL migratsiyalar tayyor"
    }
}

Write-Step "4/9 - Redis..."
$redisExe = "C:\Redis\redis-server.exe"
$redisCli = "C:\Redis\redis-cli.exe"
if (-not (Test-Path $redisExe)) {
    Write-Host "   Redis o'rnatilmoqda..."
    $redisZip = Join-Path $INSTALL_ROOT "tmp\redis.zip"
    $redisUrl = "https://github.com/tporadowski/redis/releases/download/v5.0.14.1/Redis-x64-5.0.14.1.zip"
    Invoke-Download $redisUrl $redisZip
    New-Item -ItemType Directory -Force -Path "C:\Redis" | Out-Null
    Expand-Archive -Path $redisZip -DestinationPath "C:\Redis" -Force
    $redisCfgPath = "C:\Redis\redis.conf"
    Set-Content -Path $redisCfgPath -Encoding ASCII -Value @(
        "bind 127.0.0.1", "protected-mode yes", "port 6379",
        "maxmemory 256mb", "maxmemory-policy allkeys-lru"
    )
    Start-Process -FilePath $redisExe -ArgumentList "--service-install", $redisCfgPath, "--service-name", "Redis" `
        -Wait -NoNewWindow -RedirectStandardOutput "$INSTALL_ROOT\tmp\redis_svc.out" -RedirectStandardError "$INSTALL_ROOT\tmp\redis_svc.err"
    Start-Service "Redis" -ErrorAction SilentlyContinue
    Write-OK "Redis o'rnatildi"
} else {
    $rSvc = Get-Service "Redis" -ErrorAction SilentlyContinue
    if ($rSvc -and $rSvc.Status -ne "Running") { Start-Service "Redis" }
    Write-OK "Redis mavjud"
}
Start-Sleep -Seconds 1
if (Test-Path $redisCli) {
    $ping = & $redisCli ping 2>&1
    if ($ping -eq "PONG") { Write-OK "Redis: PONG" }
    else {
        Start-Process -FilePath $redisExe -ArgumentList "C:\Redis\redis.conf" -WindowStyle Hidden
        Start-Sleep -Seconds 2
        Write-OK "Redis fon rejimida ishga tushirildi"
    }
}

Write-Step "5/9 - TLS sertifikat va JWT..."
$certFile = "$INSTALL_ROOT\tls\server.crt"
$keyFile  = "$INSTALL_ROOT\tls\server.key"
$jwtFile  = "$INSTALL_ROOT\jwt.key"
$lanIp    = Get-LanIPv4
$openssl  = Find-OpenSsl

if (-not $openssl) {
    if (-not (Test-Cmd git)) {
        Install-GitFallback
        Refresh-Path
    }
    $openssl = Find-OpenSsl
}
if (-not $openssl) {
    Write-Err "OpenSSL topilmadi (Git kerak)"
    exit 1
}

if (-not (Test-Path $certFile)) {
    $san = "subjectAltName=DNS:server.lokal,IP:${lanIp},IP:127.0.0.1"
    Start-Process -FilePath $openssl -ArgumentList @(
        "req", "-x509", "-newkey", "rsa:4096", "-nodes",
        "-keyout", $keyFile, "-out", $certFile, "-days", "3650",
        "-subj", "/C=UZ/O=Lokal/CN=server.lokal", "-addext", $san
    ) -Wait -NoNewWindow -RedirectStandardOutput "$INSTALL_ROOT\tmp\openssl.out" -RedirectStandardError "$INSTALL_ROOT\tmp\openssl.err"
    if (-not (Test-Path $certFile)) {
        Write-Err "TLS sertifikat yaratilmadi"
        exit 1
    }
    Write-OK "TLS sertifikat yaratildi (LAN: $lanIp)"
} else {
    Write-OK "TLS sertifikat mavjud"
}

if (-not (Test-Path $jwtFile)) {
    $bytes = New-Object byte[] 64
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    [IO.File]::WriteAllBytes($jwtFile, $bytes)
    Write-OK "JWT kalit yaratildi"
} else {
    Write-OK "JWT kalit mavjud"
}

Write-Step "6/9 - server/config.yaml..."
$cfgSrc  = Join-Path $DEPLOY_DIR "config.windows.dev.yaml"
$cfgDest = Join-Path $SERVER_DIR "config.yaml"
if (-not (Test-Path $cfgSrc)) {
    Write-Err "config.windows.dev.yaml topilmadi"
    exit 1
}
if (Test-Path $cfgDest) {
    Write-OK "config.yaml mavjud"
} else {
    Copy-Item $cfgSrc $cfgDest
    Write-OK "config.yaml yaratildi"
}

Write-Step "7/9 - Admin foydalanuvchi..."
$hashtool = Join-Path $SERVER_DIR "cmd\hashtool\hashtool.exe"
Push-Location $SERVER_DIR
if (-not (Test-Path $hashtool)) {
    $buildOut = Start-Process -FilePath go -ArgumentList "build", "-o", $hashtool, ".\cmd\hashtool\" `
        -Wait -PassThru -NoNewWindow -RedirectStandardOutput "$INSTALL_ROOT\tmp\hashtool.out" -RedirectStandardError "$INSTALL_ROOT\tmp\hashtool.err"
    if ($buildOut.ExitCode -ne 0) {
        Pop-Location
        Write-Err "hashtool build xato"
        exit 1
    }
}
Pop-Location

$hash = & $hashtool $ADMIN_PASSWORD
$cnt = Invoke-Psql -Psql $psqlExe -Scalar `
    -Command "SELECT COUNT(*) FROM users WHERE username='admin';"
if ($cnt -eq "0") {
    $adminSqlFile = Join-Path $INSTALL_ROOT "tmp\admin_insert.sql"
    Set-Content -Path $adminSqlFile -Encoding ASCII -Value @(
        "INSERT INTO users (username, password_hash, display_name, role, must_change_password)",
        "VALUES ('admin', '$hash', 'Bosh Administrator', 'admin', FALSE);"
    )
    Invoke-Psql -Psql $psqlExe -User msg -Database lokal_messenger -File $adminSqlFile
    Write-OK "Admin yaratildi: admin / $ADMIN_PASSWORD"
} else {
    Write-OK "Admin allaqachon mavjud"
}

Write-Step "8/9 - Go mod va npm install..."
$serverExe = Join-Path $SERVER_DIR "lokal-server.exe"
Push-Location $SERVER_DIR
if (Test-Path $serverExe) {
    Write-OK "lokal-server.exe mavjud"
} else {
    $null = Start-Process -FilePath go -ArgumentList "mod", "download" -Wait -PassThru -NoNewWindow `
        -RedirectStandardOutput "$INSTALL_ROOT\tmp\go_dl.out" -RedirectStandardError "$INSTALL_ROOT\tmp\go_dl.err"
    $build = Start-Process -FilePath go -ArgumentList "build", "-o", "lokal-server.exe", ".\cmd\server\" -Wait -PassThru -NoNewWindow `
        -RedirectStandardOutput "$INSTALL_ROOT\tmp\go_build.out" -RedirectStandardError "$INSTALL_ROOT\tmp\go_build.err"
    if ($build.ExitCode -ne 0 -or -not (Test-Path $serverExe)) {
        Pop-Location
        Write-Err "lokal-server.exe build xato"
        exit 1
    }
    Write-OK "lokal-server.exe qurildi"
}
Pop-Location

$nodeModules = Join-Path $CLIENT_DIR "node_modules"
if ((Test-Path $nodeModules) -and (Test-Path (Join-Path $nodeModules "vite"))) {
    Write-OK "npm: node_modules mavjud"
} else {
    Push-Location $CLIENT_DIR
    $npm = Start-Process -FilePath npm -ArgumentList "install" -Wait -PassThru -NoNewWindow `
        -RedirectStandardOutput "$INSTALL_ROOT\tmp\npm.out" -RedirectStandardError "$INSTALL_ROOT\tmp\npm.err"
    Pop-Location
    if ($npm.ExitCode -ne 0 -or -not (Test-Path $nodeModules)) {
        Write-Err "npm install xato"
        exit 1
    }
    Write-OK "npm install bajarildi"
}

Write-Step "9/9 - hosts fayli (server.lokal)..."
$hostsPath = "$env:SystemRoot\System32\drivers\etc\hosts"
$hostsContent = Get-Content $hostsPath -Raw -ErrorAction SilentlyContinue
if ($hostsContent -notmatch "server\.lokal") {
    Add-Content $hostsPath "`n127.0.0.1  server.lokal"
    Write-OK "hosts: server.lokal qo'shildi"
} else {
    Write-OK "hosts: server.lokal mavjud"
}

Write-Host ""
Write-Host " ============================================================" -ForegroundColor Green
Write-Host "  SOZLASH MUVAFFAQIYATLI TUGADI!" -ForegroundColor Green
Write-Host " ============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Keyingi qadam:" -ForegroundColor Yellow
Write-Host "    1. Ishga tushiring:  $ProjectRoot\start-all.bat"
Write-Host "    2. Brauzer:          https://localhost:1420/"
Write-Host "    3. Login:            admin / $ADMIN_PASSWORD"
Write-Host ""
