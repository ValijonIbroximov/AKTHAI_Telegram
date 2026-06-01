#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Lokal Messenger — Windows Server to'liq avtomatik sozlash skripti.
    PostgreSQL 16, Redis (Windows port), TLS sertifikat va birinchi admin yaratiladi.

.NOTES
    Administrator sifatida ishga tushiriladi.
    Foydalanish: .\setup_windows.ps1
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ── Rang konstantalari ─────────────────────────────────────────────────────────
function Write-Step  { param($msg) Write-Host "`n[$([char]0x25BA)] $msg" -ForegroundColor Cyan }
function Write-OK    { param($msg) Write-Host "    [OK] $msg" -ForegroundColor Green }
function Write-Warn  { param($msg) Write-Host "    [!!] $msg" -ForegroundColor Yellow }
function Write-Err   { param($msg) Write-Host "    [XX] $msg" -ForegroundColor Red }

# ── Sozlamalar ─────────────────────────────────────────────────────────────────
$DB_PASSWORD    = "STRONG_DB_PASSWORD"   # <-- o'zgartiring
$ADMIN_PASSWORD = "AdminParol123!"       # <-- o'zgartiring
$SERVER_IP      = "127.0.0.1"           # <-- tarmoq serverida haqiqiy IP yozing
$INSTALL_ROOT   = "C:\lokal-msg"
$PG_VERSION     = "16"
$PG_BIN         = "C:\Program Files\PostgreSQL\$PG_VERSION\bin"
$PG_DATA        = "C:\Program Files\PostgreSQL\$PG_VERSION\data"
$SERVER_DIR     = "d:\Loyihalar\AKTHAI_Telegram-1\lokal-messenger\server"
$OPENSSL        = "C:\Program Files\Git\usr\bin\openssl.exe"

# ── 1. TAYYORLOV ───────────────────────────────────────────────────────────────
Write-Step "Kerakli papkalar yaratilmoqda..."
@("$INSTALL_ROOT\tls", "$INSTALL_ROOT\tmp") | ForEach-Object {
    New-Item -ItemType Directory -Force -Path $_ | Out-Null
}
Write-OK "$INSTALL_ROOT papka tuzilmasi tayyor"

# ── 2. POSTGRESQL O'RNATISH ────────────────────────────────────────────────────
Write-Step "PostgreSQL $PG_VERSION tekshirilmoqda..."

$pgInstalled = Test-Path "$PG_BIN\psql.exe"

if (-not $pgInstalled) {
    Write-Warn "PostgreSQL topilmadi. Yuklab o'rnatilmoqda..."

    $pgInstaller = "$INSTALL_ROOT\tmp\pg_installer.exe"
    $pgUrl = "https://get.enterprisedb.com/postgresql/postgresql-$PG_VERSION.6-1-windows-x64.exe"

    Write-Host "    Yuklanmoqda: $pgUrl"
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $pgUrl -OutFile $pgInstaller -UseBasicParsing

    Write-Host "    O'rnatilmoqda (sukut bilan, ~2 daqiqa)..."
    $args = @(
        "--mode", "unattended",
        "--superpassword", $DB_PASSWORD,
        "--servicename", "postgresql-x64-$PG_VERSION",
        "--servicepassword", $DB_PASSWORD,
        "--serverport", "5432",
        "--datadir", $PG_DATA
    )
    Start-Process -FilePath $pgInstaller -ArgumentList $args -Wait -NoNewWindow
    Write-OK "PostgreSQL o'rnatildi"
} else {
    Write-OK "PostgreSQL allaqachon o'rnatilgan: $PG_BIN"
}

# PATH'ga qo'shamiz (joriy sessiya uchun)
if ($env:PATH -notlike "*$PG_BIN*") {
    $env:PATH = "$PG_BIN;$env:PATH"
    # Doimiy qilish
    [System.Environment]::SetEnvironmentVariable("PATH",
        "$PG_BIN;" + [System.Environment]::GetEnvironmentVariable("PATH", "Machine"),
        "Machine")
    Write-OK "PostgreSQL PATH'ga qo'shildi"
}

# Xizmat ishga tushirish
$pgSvc = "postgresql-x64-$PG_VERSION"
$svc = Get-Service -Name $pgSvc -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -ne "Running") {
    Start-Service -Name $pgSvc
    Start-Sleep -Seconds 3
    Write-OK "PostgreSQL xizmati ishga tushirildi"
} elseif ($svc -and $svc.Status -eq "Running") {
    Write-OK "PostgreSQL xizmati allaqachon ishlayapti"
} else {
    Write-Warn "PostgreSQL xizmat nomi boshqacha bo'lishi mumkin — qo'lda tekshiriladi"
}

# ── 3. POSTGRESQL BAZA VA FOYDALANUVCHI ───────────────────────────────────────
Write-Step "Ma'lumotlar bazasi tayyorlanmoqda..."

$env:PGPASSWORD = $DB_PASSWORD
$psqlExe = "$PG_BIN\psql.exe"

# msg foydalanuvchi va lokal_messenger bazasi yaratiladi
$setupSQL = @"
DO `$`$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'msg') THEN
    CREATE USER msg WITH PASSWORD '$DB_PASSWORD';
  ELSE
    ALTER USER msg WITH PASSWORD '$DB_PASSWORD';
  END IF;
END
`$`$;

SELECT 'CREATE DATABASE lokal_messenger OWNER msg'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'lokal_messenger')\gexec

GRANT ALL PRIVILEGES ON DATABASE lokal_messenger TO msg;
"@

$setupSQL | & $psqlExe -U postgres -h 127.0.0.1 -p 5432 -d postgres
Write-OK "msg foydalanuvchi va lokal_messenger bazasi tayyor"

# ── 4. MIGRATSIYA ─────────────────────────────────────────────────────────────
Write-Step "Migratsiya bajarilmoqda..."

$migFile = "$SERVER_DIR\db\migrations\0001_init.sql"
if (-not (Test-Path $migFile)) {
    Write-Err "Migratsiya fayli topilmadi: $migFile"
    exit 1
}

# Jadvallar allaqachon mavjud bo'lsa xato chiqarmasligi uchun — IF NOT EXISTS ishlatilgan
$env:PGPASSWORD = $DB_PASSWORD
& $psqlExe -h 127.0.0.1 -U msg -d lokal_messenger -f $migFile
Write-OK "Migratsiya bajarildi"

# ── 5. REDIS O'RNATISH ─────────────────────────────────────────────────────────
Write-Step "Redis tekshirilmoqda..."

$redisExe = "C:\Redis\redis-server.exe"
$redisCli = "C:\Redis\redis-cli.exe"
$redisInstalled = Test-Path $redisExe

if (-not $redisInstalled) {
    Write-Warn "Redis topilmadi. Yuklab o'rnatilmoqda (tporadowski Windows port)..."

    $redisUrl = "https://github.com/tporadowski/redis/releases/download/v5.0.14.1/Redis-x64-5.0.14.1.zip"
    $redisZip = "$INSTALL_ROOT\tmp\redis.zip"
    $redisDir = "C:\Redis"

    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $redisUrl -OutFile $redisZip -UseBasicParsing

    New-Item -ItemType Directory -Force -Path $redisDir | Out-Null
    Expand-Archive -Path $redisZip -DestinationPath $redisDir -Force

    # Redis konfiguratsiyasi
    $redisCfg = @"
bind 127.0.0.1
protected-mode yes
port 6379
maxmemory 256mb
maxmemory-policy allkeys-lru
loglevel notice
logfile C:\Redis\redis.log
"@
    $redisCfg | Out-File -FilePath "C:\Redis\redis.conf" -Encoding ASCII

    # Windows xizmati sifatida ro'yxatga olinadi
    & $redisExe --service-install "C:\Redis\redis.conf" --service-name "Redis" 2>$null
    Start-Service -Name "Redis" -ErrorAction SilentlyContinue
    Write-OK "Redis o'rnatildi va xizmat sifatida ishga tushirildi"
} else {
    $rSvc = Get-Service "Redis" -ErrorAction SilentlyContinue
    if ($rSvc -and $rSvc.Status -ne "Running") {
        Start-Service "Redis"
        Write-OK "Redis xizmati ishga tushirildi"
    } else {
        Write-OK "Redis allaqachon ishlayapti"
    }
}

# Redis tekshiruvi
Start-Sleep -Seconds 2
$pingResult = & $redisCli -h 127.0.0.1 -p 6379 ping 2>&1
if ($pingResult -eq "PONG") {
    Write-OK "Redis javob berdi: PONG"
} else {
    Write-Warn "Redis javob bermadi: $pingResult"
}

# ── 6. TLS SERTIFIKAT ─────────────────────────────────────────────────────────
Write-Step "TLS sertifikat va JWT kaliti yaratilmoqda..."

$certFile = "$INSTALL_ROOT\tls\server.crt"
$keyFile  = "$INSTALL_ROOT\tls\server.key"
$jwtFile  = "$INSTALL_ROOT\jwt.key"

if (-not (Test-Path $certFile)) {
    Write-Host "    O'z-o'zini imzolovchi sertifikat yaratilmoqda (10 yillik)..."
    & $OPENSSL req -x509 -newkey rsa:4096 -nodes `
        -keyout $keyFile `
        -out $certFile `
        -days 3650 `
        -subj "/C=UZ/O=Harbiy/CN=server.lokal" `
        -addext "subjectAltName=DNS:server.lokal,IP:$SERVER_IP,IP:127.0.0.1" 2>&1 | Out-Null

    Write-OK "TLS sertifikat: $certFile"
    Write-OK "TLS kalit: $keyFile"
} else {
    Write-OK "TLS sertifikat allaqachon mavjud"
}

if (-not (Test-Path $jwtFile)) {
    $randomBytes = New-Object byte[] 64
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($randomBytes)
    [System.IO.File]::WriteAllBytes($jwtFile, $randomBytes)
    Write-OK "JWT kalit yaratildi: $jwtFile (64 bayt tasodifiy)"
} else {
    Write-OK "JWT kalit allaqachon mavjud"
}

# ── 7. BIRINCHI ADMIN YARATISH ────────────────────────────────────────────────
Write-Step "Birinchi admin foydalanuvchi yaratilmoqda..."

$hashtoolExe = "$SERVER_DIR\cmd\hashtool\hashtool.exe"
if (-not (Test-Path $hashtoolExe)) {
    Write-Host "    hashtool.exe qurilmoqda..."
    Set-Location $SERVER_DIR
    go build -o "cmd\hashtool\hashtool.exe" .\cmd\hashtool\ 2>&1
}

$adminHash = & $hashtoolExe $ADMIN_PASSWORD
if (-not $adminHash) {
    Write-Err "Parol xeshi yaratilmadi"
    exit 1
}
Write-OK "Argon2id xesh yaratildi"

# Admin allaqachon bor-yo'qligini tekshirib qo'shamiz
$checkSQL = "SELECT COUNT(*) FROM users WHERE username = 'admin';"
$env:PGPASSWORD = $DB_PASSWORD
$count = & $psqlExe -h 127.0.0.1 -U msg -d lokal_messenger -t -A -c $checkSQL 2>&1
$count = $count.Trim()

if ($count -eq "0") {
    $insertSQL = "INSERT INTO users (username, password_hash, display_name, role, must_change_password) VALUES ('admin', '$adminHash', 'Bosh Administrator', 'admin', FALSE);"
    & $psqlExe -h 127.0.0.1 -U msg -d lokal_messenger -c $insertSQL
    Write-OK "Admin foydalanuvchi yaratildi: admin / $ADMIN_PASSWORD"
} else {
    Write-OK "Admin allaqachon mavjud (o'zgartirilmadi)"
}

# ── 8. CONFIG.YAML TEKSHIRUVI ─────────────────────────────────────────────────
Write-Step "config.yaml manzillar tekshirilmoqda..."
$cfgFile = "$SERVER_DIR\config.yaml"
$cfgContent = Get-Content $cfgFile -Raw

if ($cfgContent -match "STRONG_DB_PASSWORD") {
    $cfgContent = $cfgContent -replace "STRONG_DB_PASSWORD", $DB_PASSWORD
    $cfgContent | Set-Content $cfgFile -Encoding UTF8 -NoNewline
    Write-OK "config.yaml: DB paroli yangilandi"
}
Write-OK "config.yaml tayyor"

# ── 9. SERVER BUILD ───────────────────────────────────────────────────────────
Write-Step "Server qurilmoqda (go build)..."
Set-Location $SERVER_DIR
go build -ldflags="-s -w" -o lokal-server.exe .\cmd\server\ 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-OK "lokal-server.exe muvaffaqiyatli qurildi"
} else {
    Write-Err "Build xatosi yuz berdi!"
    exit 1
}

# ── 10. YAKUNIY TEKSHIRUV ─────────────────────────────────────────────────────
Write-Host "`n" + "="*60 -ForegroundColor Cyan
Write-Host " YAKUNIY HOLAT" -ForegroundColor Cyan
Write-Host "="*60 -ForegroundColor Cyan

$env:PGPASSWORD = $DB_PASSWORD
$userCount = (& $psqlExe -h 127.0.0.1 -U msg -d lokal_messenger -t -A -c "SELECT COUNT(*) FROM users;").Trim()
$tableList = & $psqlExe -h 127.0.0.1 -U msg -d lokal_messenger -t -A -c "\dt" 2>&1

Write-Host "`n PostgreSQL:" -ForegroundColor Yellow
Write-Host "   Foydalanuvchilar soni: $userCount"
Write-Host "   Jadvallar: $($tableList -join ', ')"

$redisPing = & $redisCli ping 2>&1
Write-Host "`n Redis:" -ForegroundColor Yellow
Write-Host "   Ping: $redisPing"

Write-Host "`n Fayllar:" -ForegroundColor Yellow
Write-Host "   $certFile   : $(Test-Path $certFile)"
Write-Host "   $jwtFile    : $(Test-Path $jwtFile)"
Write-Host "   $SERVER_DIR\lokal-server.exe : $(Test-Path "$SERVER_DIR\lokal-server.exe")"

Write-Host @"

============================================================
 HAMMA NARSA TAYYOR!
============================================================
 Serverni ishga tushirish:
   cd $SERVER_DIR
   .\lokal-server.exe

 Test so'rovi (yangi terminalda):
   `$body = @{username="admin";password="$ADMIN_PASSWORD"} | ConvertTo-Json
   Invoke-WebRequest -Uri https://server.lokal:8443/api/v1/auth/login ``
     -Method Post -Body `$body -ContentType application/json ``
     -SkipCertificateCheck | Select-Object -Expand Content

 Hosts faylga qo'shiladi (admin terminalda):
   Add-Content "C:\Windows\System32\drivers\etc\hosts" "127.0.0.1  server.lokal"
============================================================
"@ -ForegroundColor Green
