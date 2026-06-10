#Requires -RunAsAdministrator
param(
    [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot)
)

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

function Write-Step { param($m) Write-Host "" ; Write-Host ">> $m" -ForegroundColor Cyan }
function Write-OK   { param($m) Write-Host "   [OK] $m" -ForegroundColor Green }
function Write-Warn { param($m) Write-Host "   [!!] $m" -ForegroundColor Yellow }
function Write-Err  { param($m) Write-Host "   [XX] $m" -ForegroundColor Red }

function Find-PgBin {
    foreach ($ver in @(17, 16, 15, 14)) {
        $p = "C:\Program Files\PostgreSQL\$ver\bin\psql.exe"
        if (Test-Path $p) { return "C:\Program Files\PostgreSQL\$ver\bin" }
    }
    return $null
}

function Test-Cmd { param($n) return [bool](Get-Command $n -ErrorAction SilentlyContinue) }

function Install-WingetPackage {
    param([string]$Id, [string]$Label)
    if (-not (Test-Cmd winget)) {
        Write-Warn "winget topilmadi - $Label ni qolda ornating"
        return $false
    }
    $listed = winget list --id $Id -e 2>$null
    if ($LASTEXITCODE -eq 0 -and ($listed -match [regex]::Escape($Id))) {
        Write-OK "$Label allaqachon o'rnatilgan"
        return $true
    }
    Write-Host "   Yuklanmoqda: $Label ($Id)..."
    winget install --id $Id -e --accept-package-agreements --accept-source-agreements --silent | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-OK "$Label o'rnatildi"
        return $true
    }
    Write-Warn "$Label winget orqali o'rnatilmadi"
    return $false
}

function Refresh-Path {
    $machine = [Environment]::GetEnvironmentVariable("PATH", "Machine")
    $user    = [Environment]::GetEnvironmentVariable("PATH", "User")
    $env:PATH = "$machine;$user"
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

Write-Host ""
Write-Host " ============================================================" -ForegroundColor Cyan
Write-Host "  Lokal-Messenger - Windows dev sozlash" -ForegroundColor Cyan
Write-Host " ============================================================" -ForegroundColor Cyan
Write-Host "  Loyiha: $ProjectRoot"

if (-not (Test-Path $SERVER_DIR)) {
    Write-Err "server papkasi topilmadi: $SERVER_DIR"
    exit 1
}

Write-Step "1/9 - Git, Go, Node.js tekshirilmoqda..."
Install-WingetPackage "Git.Git" "Git" | Out-Null
Install-WingetPackage "Go.Go" "Go" | Out-Null
Install-WingetPackage "OpenJS.NodeJS.LTS" "Node.js LTS" | Out-Null
Refresh-Path

foreach ($cmd in @("git", "go", "node", "npm")) {
    if (Test-Cmd $cmd) { Write-OK "$cmd topildi" }
    else { Write-Warn "$cmd topilmadi - terminalni yoping va qayta oching" }
}

Write-Step "2/9 - C:\lokal-msg papkalari..."
@("$INSTALL_ROOT\tls", "$INSTALL_ROOT\tmp") | ForEach-Object {
    New-Item -ItemType Directory -Force -Path $_ | Out-Null
}
Write-OK "TLS va tmp papkalar tayyor"

Write-Step "3/9 - PostgreSQL..."
$pgBinFound = Find-PgBin
if (-not $pgBinFound -and -not (Test-Path "$PG_BIN\psql.exe")) {
    Write-Warn "PostgreSQL topilmadi. Ornatilmoqda (3-5 daqiqa)..."
    $pgInstaller = "$INSTALL_ROOT\tmp\pg_installer.exe"
    $pgUrl = "https://get.enterprisedb.com/postgresql/postgresql-$PG_VERSION.6-1-windows-x64.exe"
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $pgUrl -OutFile $pgInstaller -UseBasicParsing
    $pgArgs = @(
        "--mode", "unattended", "--superpassword", $DB_PASSWORD,
        "--servicename", "postgresql-x64-$PG_VERSION", "--servicepassword", $DB_PASSWORD,
        "--serverport", "5432", "--datadir", $PG_DATA
    )
    Start-Process -FilePath $pgInstaller -ArgumentList $pgArgs -Wait -NoNewWindow
    Write-OK "PostgreSQL o'rnatildi"
    $pgBinFound = Find-PgBin
    if (-not $pgBinFound) { $pgBinFound = $PG_BIN }
} else {
    $pgBinFound = if ($pgBinFound) { $pgBinFound } else { $PG_BIN }
    Write-OK "PostgreSQL mavjud: $pgBinFound"
}

$psqlExe = Join-Path $pgBinFound "psql.exe"
if ($env:PATH -notlike "*$pgBinFound*") {
    $env:PATH = "$pgBinFound;$env:PATH"
    [Environment]::SetEnvironmentVariable(
        "PATH",
        "$pgBinFound;" + [Environment]::GetEnvironmentVariable("PATH", "Machine"),
        "Machine"
    )
}

$pgSvc = Get-Service "postgresql*" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($pgSvc -and $pgSvc.Status -ne "Running") {
    Start-Service $pgSvc.Name
    Start-Sleep -Seconds 3
    Write-OK "PostgreSQL xizmati ishga tushirildi"
}

$env:PGPASSWORD = $DB_PASSWORD
$pgSetupSql = Join-Path $INSTALL_ROOT "tmp\pg_setup.sql"
$pgSetupLines = @(
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
Set-Content -Path $pgSetupSql -Encoding ASCII -Value $pgSetupLines
& $psqlExe -U postgres -h 127.0.0.1 -p 5432 -d postgres -f $pgSetupSql 2>&1 | Out-Null
Write-OK "lokal_messenger bazasi tayyor"

$migDir = Join-Path $SERVER_DIR "db\migrations"
if (Test-Path $migDir) {
    Get-ChildItem $migDir -Filter "*.sql" | Sort-Object Name | ForEach-Object {
        & $psqlExe -U msg -h 127.0.0.1 -d lokal_messenger -f $_.FullName 2>&1 | Out-Null
    }
    Write-OK "SQL migratsiyalar bajarildi"
}

Write-Step "4/9 - Redis..."
$redisExe = "C:\Redis\redis-server.exe"
$redisCli = "C:\Redis\redis-cli.exe"
if (-not (Test-Path $redisExe)) {
    Write-Warn "Redis o'rnatilmoqda..."
    $redisZip = "$INSTALL_ROOT\tmp\redis.zip"
    $redisUrl = "https://github.com/tporadowski/redis/releases/download/v5.0.14.1/Redis-x64-5.0.14.1.zip"
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $redisUrl -OutFile $redisZip -UseBasicParsing
    New-Item -ItemType Directory -Force -Path "C:\Redis" | Out-Null
    Expand-Archive -Path $redisZip -DestinationPath "C:\Redis" -Force
    $redisCfgPath = "C:\Redis\redis.conf"
    Set-Content -Path $redisCfgPath -Encoding ASCII -Value @(
        "bind 127.0.0.1",
        "protected-mode yes",
        "port 6379",
        "maxmemory 256mb",
        "maxmemory-policy allkeys-lru"
    )
    & $redisExe --service-install $redisCfgPath --service-name "Redis" 2>$null
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
    if ($ping -eq "PONG") { Write-OK "Redis: PONG" } else { Write-Warn "Redis javob bermadi" }
}

Write-Step "5/9 - TLS sertifikat va JWT..."
$certFile = "$INSTALL_ROOT\tls\server.crt"
$keyFile  = "$INSTALL_ROOT\tls\server.key"
$jwtFile  = "$INSTALL_ROOT\jwt.key"
$lanIp    = Get-LanIPv4
$openssl  = @(
    "C:\Program Files\Git\usr\bin\openssl.exe",
    "C:\Program Files (x86)\Git\usr\bin\openssl.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $openssl) {
    Write-Warn "OpenSSL (Git) topilmadi - TLS ni qolda yarating"
} elseif (-not (Test-Path $certFile)) {
    $san = "subjectAltName=DNS:server.lokal,IP:${lanIp},IP:127.0.0.1"
    & $openssl req -x509 -newkey rsa:4096 -nodes `
        -keyout $keyFile -out $certFile -days 3650 `
        -subj "/C=UZ/O=Lokal/CN=server.lokal" `
        -addext $san 2>&1 | Out-Null
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
Copy-Item $cfgSrc $cfgDest -Force
Write-OK "config.yaml nusxalandi"

Write-Step "7/9 - Admin foydalanuvchi..."
if (Test-Cmd go) {
    $hashtool = Join-Path $SERVER_DIR "cmd\hashtool\hashtool.exe"
    Push-Location $SERVER_DIR
    if (-not (Test-Path $hashtool)) {
        go build -o $hashtool .\cmd\hashtool\ 2>&1 | Out-Null
    }
    Pop-Location
    if (Test-Path $hashtool) {
        $hash = & $hashtool $ADMIN_PASSWORD
        $env:PGPASSWORD = $DB_PASSWORD
        $countSql = "SELECT COUNT(*) FROM users WHERE username='admin';"
        $cnt = (& $psqlExe -U msg -h 127.0.0.1 -d lokal_messenger -t -A -c $countSql).Trim()
        if ($cnt -eq '0') {
            $adminSqlFile = Join-Path $INSTALL_ROOT "tmp\admin_insert.sql"
            $adminLines = @(
                "INSERT INTO users (username, password_hash, display_name, role, must_change_password)",
                "VALUES ('admin', '$hash', 'Bosh Administrator', 'admin', FALSE);"
            )
            Set-Content -Path $adminSqlFile -Encoding ASCII -Value $adminLines
            & $psqlExe -U msg -h 127.0.0.1 -d lokal_messenger -f $adminSqlFile 2>&1 | Out-Null
            Write-OK "Admin yaratildi: admin / $ADMIN_PASSWORD"
        } else {
            Write-OK "Admin allaqachon mavjud"
        }
    }
}

Write-Step "8/9 - Go mod va npm install..."
if (Test-Cmd go) {
    Push-Location $SERVER_DIR
    go mod download 2>&1 | Out-Null
    go build -o lokal-server.exe .\cmd\server\ 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { Write-OK "lokal-server.exe qurildi" }
    else { Write-Warn "go build xato - keyinroq qayta urinib koring" }
    Pop-Location
}
if (Test-Cmd npm) {
    Push-Location $CLIENT_DIR
    npm install 2>&1 | Out-Null
    Write-OK "npm install bajarildi"
    Pop-Location
}

Write-Step "9/9 - hosts fayli (server.lokal)..."
$hostsPath = "$env:SystemRoot\System32\drivers\etc\hosts"
$hostsContent = Get-Content $hostsPath -Raw -ErrorAction SilentlyContinue
if ($hostsContent -notmatch "server\.lokal") {
    Add-Content $hostsPath "`n127.0.0.1  server.lokal"
    Write-OK "hosts: 127.0.0.1 server.lokal qo'shildi"
} else {
    Write-OK "hosts: server.lokal allaqachon mavjud"
}

Write-Host ""
Write-Host " ============================================================" -ForegroundColor Green
Write-Host "  SOZLASH TUGADI!" -ForegroundColor Green
Write-Host " ============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Keyingi qadam:" -ForegroundColor Yellow
Write-Host "    1. Terminalni yoping va qayta oching (PATH yangilanishi uchun)"
Write-Host "    2. Ishga tushiring:  $ProjectRoot\start-all.bat"
Write-Host "    3. Brauzer:          https://localhost:1420/"
Write-Host "    4. Login:            admin / $ADMIN_PASSWORD"
Write-Host ""
Write-Host "  Toxtatish:            $ProjectRoot\stop-all.bat"
Write-Host ""
