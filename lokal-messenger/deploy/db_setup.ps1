#Requires -RunAsAdministrator
<#
.SYNOPSIS
    PostgreSQL o'rnatilgandan keyin ishga tushiriladi.
    Baza, foydalanuvchi, migratsiya va birinchi admin yaratiladi.

.NOTES
    Foydalanish (admin PowerShell):
        cd d:\Loyihalar\AKTHAI_Telegram-1\lokal-messenger\deploy
        .\db_setup.ps1
#>

# ── Sozlamalar (kerak bo'lsa o'zgartiring) ─────────────────────────────────────
$PG_SUPER_PASSWORD = "STRONG_DB_PASSWORD"   # PostgreSQL o'rnatishda kiritilgan postgres paroli
$DB_USER_PASSWORD  = "STRONG_DB_PASSWORD"   # msg foydalanuvchi paroli
$ADMIN_PASSWORD    = "AdminParol123!"        # Birinchi admin paroli
$SERVER_DIR        = "d:\Loyihalar\AKTHAI_Telegram-1\lokal-messenger\server"

# ── PostgreSQL bin yo'li avtomatik topiladi ─────────────────────────────────────
$pgBin = @(17, 16, 15, 14) | ForEach-Object {
    "C:\Program Files\PostgreSQL\$_\bin"
} | Where-Object { Test-Path "$_\psql.exe" } | Select-Object -First 1

if (-not $pgBin) {
    Write-Host "[XATO] PostgreSQL topilmadi! Avval o'rnating." -ForegroundColor Red
    exit 1
}
$psql = "$pgBin\psql.exe"
Write-Host "[OK] PostgreSQL topildi: $pgBin" -ForegroundColor Green

# PATH ga qo'shamiz
if ($env:PATH -notlike "*$pgBin*") {
    $env:PATH = "$pgBin;$env:PATH"
}

# ── 1. PostgreSQL xizmati tekshiriladi ─────────────────────────────────────────
Write-Host "`n[1] PostgreSQL xizmati..."
$pgSvc = Get-Service "postgresql*" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($pgSvc -and $pgSvc.Status -ne "Running") {
    Start-Service $pgSvc.Name
    Start-Sleep 3
}
if ($pgSvc -and $pgSvc.Status -eq "Running") {
    Write-Host "    [OK] Xizmat ishlayapti: $($pgSvc.Name)" -ForegroundColor Green
} else {
    Write-Host "    [!!] Xizmat holati: $($pgSvc.Status)" -ForegroundColor Yellow
}

# ── 2. msg foydalanuvchi va lokal_messenger bazasi ─────────────────────────────
Write-Host "`n[2] Baza va foydalanuvchi yaratilmoqda..."
$env:PGPASSWORD = $PG_SUPER_PASSWORD

$setupSQL = @"
DO `$`$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'msg') THEN
    CREATE USER msg WITH PASSWORD '$DB_USER_PASSWORD';
    RAISE NOTICE 'msg foydalanuvchi yaratildi';
  ELSE
    ALTER USER msg WITH PASSWORD '$DB_USER_PASSWORD';
    RAISE NOTICE 'msg paroli yangilandi';
  END IF;
END
`$`$;
"@

$setupSQL | & $psql -U postgres -h 127.0.0.1 -p 5432 -d postgres -f -

# Baza yaratish (mavjud bo'lsa o'tkazib yuboriladi)
$dbExists = & $psql -U postgres -h 127.0.0.1 -p 5432 -t -A -c `
    "SELECT COUNT(*) FROM pg_database WHERE datname='lokal_messenger';" postgres
if ($dbExists.Trim() -eq "0") {
    & $psql -U postgres -h 127.0.0.1 -p 5432 -d postgres -c `
        "CREATE DATABASE lokal_messenger OWNER msg;"
    Write-Host "    [OK] lokal_messenger bazasi yaratildi" -ForegroundColor Green
} else {
    Write-Host "    [OK] lokal_messenger bazasi allaqachon mavjud" -ForegroundColor Green
}

& $psql -U postgres -h 127.0.0.1 -p 5432 -d postgres -c `
    "GRANT ALL PRIVILEGES ON DATABASE lokal_messenger TO msg;" | Out-Null

# ── 3. Migratsiya ─────────────────────────────────────────────────────────────
Write-Host "`n[3] Migratsiya bajarilmoqda..."
$migFile = "$SERVER_DIR\db\migrations\0001_init.sql"
$env:PGPASSWORD = $DB_USER_PASSWORD

# Jadvallar bor-yo'qligi tekshiriladi
$usersExists = & $psql -U msg -h 127.0.0.1 -p 5432 -t -A -d lokal_messenger -c `
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_name='users';"
if ($usersExists.Trim() -eq "0") {
    & $psql -U msg -h 127.0.0.1 -p 5432 -d lokal_messenger -f $migFile
    Write-Host "    [OK] Jadvallar yaratildi" -ForegroundColor Green
} else {
    Write-Host "    [OK] Jadvallar allaqachon mavjud (migratsiya o'tkazib yuborildi)" -ForegroundColor Green
}

# Jadvallar ro'yxati
Write-Host "`n    Jadvallar:"
& $psql -U msg -h 127.0.0.1 -p 5432 -d lokal_messenger -t -A -c `
    "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;" |
    ForEach-Object { Write-Host "      - $_" }

# ── 4. Birinchi admin ─────────────────────────────────────────────────────────
Write-Host "`n[4] Birinchi admin yaratilmoqda..."
$hashtoolExe = "$SERVER_DIR\cmd\hashtool\hashtool.exe"
if (-not (Test-Path $hashtoolExe)) {
    Write-Host "    hashtool qurilmoqda..."
    Push-Location $SERVER_DIR
    go build -o "cmd\hashtool\hashtool.exe" .\cmd\hashtool\
    Pop-Location
}
$adminHash = & $hashtoolExe $ADMIN_PASSWORD

$env:PGPASSWORD = $DB_USER_PASSWORD
$adminCount = & $psql -U msg -h 127.0.0.1 -p 5432 -t -A -d lokal_messenger -c `
    "SELECT COUNT(*) FROM users WHERE username='admin';"
if ($adminCount.Trim() -eq "0") {
    & $psql -U msg -h 127.0.0.1 -p 5432 -d lokal_messenger -c @"
INSERT INTO users (username, password_hash, display_name, role, must_change_password)
VALUES ('admin', '$adminHash', 'Bosh Administrator', 'admin', FALSE);
"@
    Write-Host "    [OK] Admin yaratildi: admin / $ADMIN_PASSWORD" -ForegroundColor Green
} else {
    Write-Host "    [OK] Admin allaqachon mavjud" -ForegroundColor Green
}

# ── 5. Yakuniy holat ──────────────────────────────────────────────────────────
Write-Host "`n" + ("="*55) -ForegroundColor Cyan
Write-Host " BAZA SOZLASH TUGADI" -ForegroundColor Cyan
Write-Host ("="*55) -ForegroundColor Cyan

$userCount = (& $psql -U msg -h 127.0.0.1 -p 5432 -t -A -d lokal_messenger -c `
    "SELECT COUNT(*) FROM users;").Trim()
Write-Host "    Foydalanuvchilar soni : $userCount"
Write-Host "    TLS sertifikat        : $(Test-Path 'C:\lokal-msg\tls\server.crt')"
Write-Host "    JWT kalit             : $(Test-Path 'C:\lokal-msg\jwt.key')"
Write-Host "    lokal-server.exe      : $(Test-Path "$SERVER_DIR\lokal-server.exe")"

Write-Host @"

 Keyingi qadam — Redis o'rnatish:
   https://github.com/tporadowski/redis/releases/download/v5.0.14.1/Redis-x64-5.0.14.1.msi
   MSI faylni yuklab, o'rnating. Xizmat avtomatik ishga tushadi.

 Redis o'rnatilgandan keyin serverni ishga tushiring:
   cd $SERVER_DIR
   .\lokal-server.exe
"@ -ForegroundColor Green
