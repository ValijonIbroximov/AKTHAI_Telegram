# Windows'da Lokal Messenger — Bosqichma-bosqich Qoʻllanma

> Siz Go oʻrnatdingiz va birinchi server sinashi muvaffaqiyatli. Endi qoʻyidagi qadamlarni Windows'da bajariladi.

---

## 1. PostgreSQL oʻrnatish (Windows)

### 1.1. Yuklab olish va oʻrnatish

1. **https://www.postgresql.org/download/windows/** saytiga oʻting
2. **PostgreSQL 16.0** (yoki yangriroq) WindowsInstallerni yuklab oling
3. O'rnatishni boshlang:
   - **Installation directory:** `C:\Program Files\PostgreSQL\16`
   - **Port:** `5432` (standart)
   - **Password:** `STRONG_DB_PASSWORD` (qoʻyidagi buyruqlarda bu parol ishlatiladi)
   - **Locale:** `English, United States` yoki mamlakatingiz

4. **Stack Builder** (oʻrnatish oxirida soʻraladigan qoʻshimcha) **Skip** qilinadi.

### 1.2. PostgreSQL xizmati Windows'da ishga tushdi

O'rnatish oxirida xizmat avtomatik ishga tushadi. Tekshirish uchun:

```powershell
# PowerShell'da (admin sifatida oching)
Get-Service PostgreSQL*
```

Javob bo'lishi kerak (Status = Running):

```
Status   Name                DisplayName
------   ----                -----------
Running  postgresql-x64-16   postgresql-x64-16
```

### 1.3. pgAdmin bilan ulanish (ixtiyoriy, GUI orqali)

O'rnatishda pgAdmin qo'yiladi. Uni Windows Start Menu'dan oching:
- URL: `http://localhost:5050`
- Login: `postgres`
- Master password: oʻrnatishda belgilangan parol

**Yoki** command-line orqali (qoʻshtiradi):

```powershell
# PostgreSQL CLI'ga ulanish
psql -U postgres -h 127.0.0.1
# Parol soʻraladi — oʻrnatishda kiritgan parol yoziladi
```

### 1.4. Baza va foydalanuvchi yaratish

PowerShell'da (admin sifatida):

```powershell
# PostgreSQL'ning bin katalogini PATH'ga qoʻshish (permanent qilish yoʻl):
$env:Path += ";C:\Program Files\PostgreSQL\16\bin"

# msg foydalanuvchi va lokal_messenger bazasi yaratiladi
psql -U postgres -h 127.0.0.1 -d postgres -c `
"CREATE USER msg WITH PASSWORD 'STRONG_DB_PASSWORD'; CREATE DATABASE lokal_messenger OWNER msg; GRANT ALL PRIVILEGES ON DATABASE lokal_messenger TO msg;"
```

Agar `psql` topilmasa, to'liq yoʻl bilan chaqirish:

```powershell
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -h 127.0.0.1 -d postgres -c `
"CREATE USER msg WITH PASSWORD 'STRONG_DB_PASSWORD'; CREATE DATABASE lokal_messenger OWNER msg; GRANT ALL PRIVILEGES ON DATABASE lokal_messenger TO msg;"
```

### 1.5. Migratsiya faylini yuklab olish

`QURISH_QOLLANMASI.md` 3.2 boʻlimidagi `0001_init.sql` faylini quyida joylashtiriladi:

```
C:\Users\admin\lokal-messenger\server\db\migrations\0001_init.sql
```

Papkani qoʻl bilan yaratish:

```powershell
mkdir "C:\Users\admin\lokal-messenger\server\db\migrations" -Force
```

`0001_init.sql` kontent `HARBIY_MESSENJER.md`'dagi **1.1 boʻlimdan** nusxalanib faylga joylashtiriladi.

### 1.6. Migratsiya bajariladi

```powershell
$env:PGPASSWORD = 'STRONG_DB_PASSWORD'
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" `
  -h 127.0.0.1 -U msg -d lokal_messenger `
  -f "C:\Users\admin\lokal-messenger\server\db\migrations\0001_init.sql"
```

**Natija:** Xatosiz (warning boʻlishi mumkin, lekin error bo'lmasa tamom).

---

## 2. Redis oʻrnatish (Windows)

Windows'da Redis murakkab. **Ikkita variant:**

### Variant A: Windows Subsystem for Linux (WSL2) — Tavsiyalangan

WSL2 ishlatib, Linux'da Redis o'rnatish eng oson:

```powershell
# PowerShell'da (admin sifatida)
wsl --install -d Ubuntu
# Windows qayta ishga tushadi

# Ubuntu qayta ishga tushgach, Ubuntu terminalida:
sudo apt update
sudo apt install -y redis-server
sudo systemctl start redis-server
sudo systemctl enable redis-server

# Tekshirish
redis-cli ping
# Javob: PONG
```

**Windows'dagi Go server** WSL'dagi Redis'ga qoʻyidagi manzil orqali ulanadi:

```
redis:
  addr: "localhost:6379"   # Windows'dan WSL2 localhost
  password: ""
  db: 0
```

### Variant B: Memurai (Native Windows Redis)

1. **https://github.com/microsoftarchive/redis/releases** saytiga oʻting
2. **Redis-x64-7.0.0.msi** (yoki yangroq) yuklab oling
3. O'rnatishni boshlang
4. O'rnatish oxirida xizmat avtomatik ishga tushadi

Tekshirish:

```powershell
redis-cli ping
# Javob: PONG
```

---

## 3. TLS sertifikat yasash (Windows)

### 3.1. OpenSSL o'rnatish (agar bo'lmasa)

```powershell
# Choco (package manager) orqali:
choco install openssl -y

# Yoki manual: https://slproweb.com/products/Win32OpenSSL.html
# "Win64 OpenSSL v3.0.x Light" yuklab oling va o'rnating
```

### 3.2. Sertifikat fayllari uchun katalog

```powershell
mkdir "C:\lokal-msg\tls" -Force
```

### 3.3. Self-signed sertifikat yasash

PowerShell'da (admin sifatida):

```powershell
$certPath = "C:\lokal-msg\tls"
cd $certPath

# OpenSSL buyrug'i — bitta qatordan
openssl req -x509 -newkey rsa:4096 -nodes `
  -keyout server.key `
  -out server.crt `
  -days 3650 `
  -subj "/C=UZ/O=Harbiy/CN=server.lokal" `
  -addext "subjectAltName=DNS:server.lokal,IP:127.0.0.1,IP:192.168.X.X"
```

> `192.168.X.X` oʻrniga **haqiqiy server kompyuteri IP adresi** qoʻyiladi (masalan, `192.168.1.100`).

**Tekshirish:**

```powershell
dir "C:\lokal-msg\tls"
# server.crt va server.key fayllari koʻrinishi kerak
```

### 3.4. JWT kalit yasash

```powershell
# 64 baytli tasodifiy kalit
$randomBytes = New-Object byte[] 64
$rng = New-Object System.Security.Cryptography.RNGCryptoServiceProvider
$rng.GetBytes($randomBytes)
$base64 = [Convert]::ToBase64String($randomBytes)

# Faylga yozish
$base64 | Out-File -NoNewline "C:\lokal-msg\jwt.key"

# Tekshirish
Get-Content "C:\lokal-msg\jwt.key"
```

---

## 4. Server konfiguratsiyasi

### 4.1. `config.yaml` faylini yaratish

`HARBIY_MESSENJER.md` 2.1 boʻlimidagi namuna konfiguratsiya Windows'ga moslashtiriladi:

**Fayl yoʻli:** `C:\Users\admin\lokal-messenger\server\config.yaml`

```yaml
server:
  bind_address: "0.0.0.0:8443"
  tls:
    enabled: true
    cert_file: "C:\\lokal-msg\\tls\\server.crt"
    key_file:  "C:\\lokal-msg\\tls\\server.key"

database:
  dsn: "postgres://msg:STRONG_DB_PASSWORD@127.0.0.1:5432/lokal_messenger?sslmode=disable"
  max_open_conns: 20
  max_idle_conns: 5

redis:
  addr: "127.0.0.1:6379"
  password: ""
  db: 0

auth:
  jwt_secret_file: "C:\\lokal-msg\\jwt.key"
  access_ttl_minutes: 720
  argon2:
    memory_kb: 65536
    iterations: 3
    parallelism: 2
    salt_length: 16
    key_length: 32

limits:
  max_message_size_bytes: 65536
  max_file_size_bytes: 52428800
  rate_login_per_5min: 5
```

**Muhim:** YAML'da path'lar Windows'da `\\` (backslash double) yoziladi.

### 4.2. Go qaramliklar (to'liq ro'yxat)

PowerShell'da `C:\Users\admin\lokal-messenger\server` katalogida:

```powershell
go get github.com/gofiber/fiber/v2@v2.52.5
go get github.com/gofiber/contrib/websocket@v1.3.2
go get github.com/golang-jwt/jwt/v5@v5.2.1
go get github.com/jackc/pgx/v5@v5.6.0
go get github.com/redis/go-redis/v9@v9.5.3
go get golang.org/x/crypto@v0.24.0
go get github.com/google/uuid@v1.6.0
go get gopkg.in/yaml.v3@v3.0.1

go mod tidy
```

---

## 5. Server kodu joylashtiriladi (Windows)

`QURISH_QOLLANMASI.md` 4.4–4.9 boʻlimlari boʻyicha barcha fayllar joylashtiriladi. Windows'da paths quyidagicha:

```
C:\Users\admin\lokal-messenger\server\
├── cmd\server\main.go           (HARBIY_MESSENJER.md 2.2)
├── internal\
│   ├── config\config.go         (QURISH_QOLLANMASI.md 4.4)
│   ├── db\pool.go               (QURISH_QOLLANMASI.md 4.5)
│   ├── cache\redis.go           (QURISH_QOLLANMASI.md 4.5)
│   ├── auth\
│   │   ├── password.go          (HARBIY_MESSENJER.md 2.3)
│   │   └── jwt.go               (HARBIY_MESSENJER.md 2.4)
│   ├── middleware\auth.go       (HARBIY_MESSENJER.md 2.5)
│   ├── api\
│   │   ├── handlers.go          (QURISH_QOLLANMASI.md 4.6)
│   │   ├── auth_routes.go       (HARBIY_MESSENJER.md 2.6)
│   │   ├── admin_routes.go      (HARBIY_MESSENJER.md 2.6)
│   │   ├── keys_routes.go       (HARBIY_MESSENJER.md 2.7)
│   │   └── router.go            (HARBIY_MESSENJER.md 2.9)
│   ├── ws\
│   │   ├── hub.go               (HARBIY_MESSENJER.md 2.8)
│   │   └── handler.go           (HARBIY_MESSENJER.md 2.8)
│   └── models\ (bo'sh, keyin to'ldiriladi)
├── db\migrations\0001_init.sql  (HARBIY_MESSENJER.md 1.1)
├── config.yaml                  (shu boʻlim 4.1)
├── go.mod
├── go.sum
└── lokal-server.exe             (qurilgandan keyin)
```

### 5.1. Fayllarni qoʻl bilan qoʻshish (VS Code orqali)

```powershell
# Terminal'da bosqich bo'yicha papkalar yaratiladi:
mkdir "C:\Users\admin\lokal-messenger\server\cmd\server"
mkdir "C:\Users\admin\lokal-messenger\server\internal\config"
mkdir "C:\Users\admin\lokal-messenger\server\internal\db"
mkdir "C:\Users\admin\lokal-messenger\server\internal\cache"
mkdir "C:\Users\admin\lokal-messenger\server\internal\auth"
mkdir "C:\Users\admin\lokal-messenger\server\internal\api"
mkdir "C:\Users\admin\lokal-messenger\server\internal\middleware"
mkdir "C:\Users\admin\lokal-messenger\server\internal\ws"
mkdir "C:\Users\admin\lokal-messenger\server\internal\models"
mkdir "C:\Users\admin\lokal-messenger\server\db\migrations"
```

Har bir `.go` fayli uchun:
1. VS Code'da o'ng panel'dan `File > New File` yoki Ctrl+N
2. Kod nusxalanib qo'yiladi
3. Fayl nom bilan saqlanadi (masalan, `password.go`)

---

## 6. Server kompilyatsiyasi va ishga tushirilishi

### 6.1. Kompilyatsiya

```powershell
cd "C:\Users\admin\lokal-messenger\server"

# Qaramliklar yangilanadi
go mod tidy

# Kompilyatsiya (Windows'da .exe chiqadi)
go build -o lokal-server.exe .\cmd\server\main.go
```

Agar xato chiqsa, tekshiriladi:
- `config.yaml` oxshashliginig va path'lar to'g'riligi
- Barcha import yoʻllari to'g'riligi
- PostgreSQL va Redis ishga tushganligini

### 6.2. Server ishga tushiriladi

```powershell
# PowerShell'da, C:\Users\admin\lokal-messenger\server katalogida:
.\lokal-server.exe

# Yoki config boshqa joyda boʻlsa:
.\lokal-server.exe config.yaml
```

**Kutilgan output:**

```
2026/05/05 13:25:05 Server TLS bilan tinglanmoqda: 0.0.0.0:8443
 ┌───────────────────────────────────────────────────┐
 │            LokalMessenger Server v1.0             │
 │                  Fiber v2.52.13                   │
 │               https://127.0.0.1:8443              │
 │       (bound on host 0.0.0.0 and port 8443)       │
 │                                                   │
 │ Handlers ............. 12 Processes ........... 1 │
 │ Prefork ....... Disabled  PID ............. 5432 │
 └───────────────────────────────────────────────────┘
```

---

## 7. Birinchi admin yaratish (Windows'da)

### 7.1. Argon2 xesh vositasi

`QURISH_QOLLANMASI.md` 6.1 boʻlimdagi hashtool Go fayli yaratiladi:

**Fayl:** `C:\Users\admin\lokal-messenger\server\cmd\hashtool\main.go`

```go
package main

import (
    "fmt"
    "os"
    "github.com/military/lokal-messenger/server/internal/auth"
)

func main() {
    if len(os.Args) < 2 {
        fmt.Println("Foydalanish: hashtool.exe <parol>")
        os.Exit(1)
    }
    h, err := auth.HashPassword(os.Args[1], auth.Argon2Params{
        Memory: 65536, Iterations: 3, Parallelism: 2,
        SaltLength: 16, KeyLength: 32,
    })
    if err != nil { panic(err) }
    fmt.Println(h)
}
```

Kompilyatsiya va ishga tushirish:

```powershell
cd "C:\Users\admin\lokal-messenger\server"

# Kompilyatsiya
go build -o cmd\hashtool\hashtool.exe .\cmd\hashtool\main.go

# Ishga tushirish — parol sifatida "AdminParol123!" ishlatiladi
.\cmd\hashtool\hashtool.exe "AdminParol123!"

# Output (nusxalanadi — keyin SQL'da ishlatiladi):
# argon2id$v=19$m=65536,t=3,p=2$...
```

### 7.2. Admin SQL'ga qoʻshiladi

PowerShell'da:

```powershell
$adminHash = "argon2id$v=19$m=65536,t=3,p=2$..."  # Yuqoridagi output

$env:PGPASSWORD = 'STRONG_DB_PASSWORD'
$insertSQL = @"
INSERT INTO users (username, password_hash, display_name, role, must_change_password)
VALUES ('admin', '$adminHash', 'Bosh Administrator', 'admin', FALSE);
"@

& "C:\Program Files\PostgreSQL\16\bin\psql.exe" `
  -h 127.0.0.1 -U msg -d lokal_messenger -c $insertSQL
```

**Tekshirish:**

```powershell
$env:PGPASSWORD = 'STRONG_DB_PASSWORD'
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" `
  -h 127.0.0.1 -U msg -d lokal_messenger -c "SELECT username, role FROM users;"
```

**Output:** `admin | admin` qatori koʻrinishi kerak.

---

## 8. Server sinab koʻriladi (curl yoki PowerShell)

### 8.1. Login soʻrovi (PowerShell)

```powershell
# TLS hisobi bilan login
$body = @{
    username = "admin"
    password = "AdminParol123!"
} | ConvertTo-Json

$response = Invoke-WebRequest `
  -Uri "https://server.lokal:8443/api/v1/auth/login" `
  -Method Post `
  -Body $body `
  -ContentType "application/json" `
  -SkipCertificateCheck

$response.Content | ConvertFrom-Json
```

**Kutilgan javob:**

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "role": "admin",
  "must_change_password": false
}
```

Token qoʻyidagida ishlatiladi.

### 8.2. Yangi foydalanuvchi yaratish

```powershell
$token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."  # Yuqoridan

$body = @{
    username = "soldat01"
    display_name = "Sergeant Aliyev"
    role = "user"
    rank_title = "Serjant"
    unit_code = "B-12"
} | ConvertTo-Json

$response = Invoke-WebRequest `
  -Uri "https://server.lokal:8443/api/v1/admin/users" `
  -Method Post `
  -Headers @{ Authorization = "Bearer $token" } `
  -Body $body `
  -ContentType "application/json" `
  -SkipCertificateCheck

$response.Content | ConvertFrom-Json
```

**Javob:**

```json
{
  "user_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "temporary_password": "base64encodedpassword"
}
```

Vaqtinchalik parol (temporary_password) foydalanuvchiga yetkaziladi.

---

## 9. Mijoz (Tauri + React) — Windows'da qurib chiqarish

### 9.1. Kerakli dasturlar

Windows'da **Developer mashinasida** quyidagilar o'rnatiladi (Server mashinasidan farq qilib):

#### 9.1.1. Node.js va npm

1. **https://nodejs.org/en/download** saytiga oʻting
2. **LTS version** (20 yoki yangiroq) yuklab oling va o'rnating
3. Tekshirish:

```powershell
node --version
npm --version
```

#### 9.1.2. Visual Studio C++ Build Tools

Tauri/Rust kompilyatsiyasi uchun zarur:

1. **https://visualstudio.microsoft.com/visual-cpp-build-tools/** saytiga oʻting
2. **Visual C++ Build Tools** yuklab oling
3. O'rnatishda **"Desktop development with C++"** workload tanlanadi
4. Installation oxiri

#### 9.1.3. Rust + cargo

```powershell
# https://rustup.rs/ saytiga oʻting yoki:
Invoke-WebRequest -Uri https://win.rustup.rs/x86_64 -OutFile rustup-init.exe
.\rustup-init.exe -y
```

PowerShell qayta oching (PATH yangilanishi uchun).

Tekshirish:

```powershell
rustc --version
cargo --version
```

#### 9.1.4. Tauri CLI

```powershell
npm install -g @tauri-apps/cli@^2.0
# yoki
cargo install tauri-cli --version "^2.0" --locked
```

### 9.2. Tauri loyihasi yaratiladi

```powershell
cd "C:\Users\admin\lokal-messenger"

# Tauri React + TypeScript loyihasi
npm create tauri-app@latest client -- --template react-ts --manager npm
```

**Savollar va javoblar:**

```
✔ Project name › lokal-messenger-ui
✔ Choose package manager › npm
✔ Choose UI template › React
✔ Choose TypeScript template › Yes
✔ Done
```

### 9.3. Klient kodlari joylashtiriladi

`QURISH_QOLLANMASI.md` 7.5–7.6 boʻlimlari boʻyicha fayllar joylashtiriladi:

```
C:\Users\admin\lokal-messenger\client\
├── src-tauri\src\
│   ├── main.rs              (HARBIY_MESSENJER.md 3.5, taur.conf.json update)
│   ├── crypto.rs            (HARBIY_MESSENJER.md 3.2)
│   ├── store.rs             (HARBIY_MESSENJER.md 3.3)
│   ├── session.rs           (HARBIY_MESSENJER.md 3.4)
│   └── net.rs               (QURISH_QOLLANMASI.md 7.4)
├── src\
│   ├── App.tsx              (HARBIY_MESSENJER.md 4.4)
│   ├── main.tsx             (QURISH_QOLLANMASI.md 7.6)
│   ├── components\
│   │   ├── ChatList.tsx      (HARBIY_MESSENJER.md 4.6)
│   │   └── ChatView.tsx      (HARBIY_MESSENJER.md 4.7)
│   ├── pages\
│   │   └── LoginPage.tsx     (HARBIY_MESSENJER.md 4.5)
│   ├── stores\
│   │   ├── auth.ts          (HARBIY_MESSENJER.md 4.8)
│   │   ├── theme.ts         (HARBIY_MESSENJER.md 4.8)
│   │   └── chats.ts         (HARBIY_MESSENJER.md 4.8)
│   ├── styles\
│   │   ├── theme.css        (HARBIY_MESSENJER.md 4.3)
│   │   ├── layout.css       (HARBIY_MESSENJER.md 4.4)
│   │   ├── login.css        (HARBIY_MESSENJER.md 4.5)
│   │   ├── chatlist.css     (HARBIY_MESSENJER.md 4.6)
│   │   └── chatview.css     (HARBIY_MESSENJER.md 4.7)
│   └── net\
│       └── socket.ts        (HARBIY_MESSENJER.md 4.9)
├── package.json
└── Cargo.toml               (HARBIY_MESSENJER.md 3.1)
```

### 9.4. Tauri konfiguratsiyasi

**Fayl:** `C:\Users\admin\lokal-messenger\client\src-tauri\tauri.conf.json`

`HARBIY_MESSENJER.md` 4.1 boʻlimdagi JSON to'liq yoʻllanadi. Windows'da path'lar slash ishlatadi (backslash emas):

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "LokalMessenger",
  "version": "1.0.0",
  "identifier": "uz.mil.lokal.messenger",
  "build": {
    "beforeDevCommand": "npm run dev",
    "beforeBuildCommand": "npm run build",
    "frontendDist": "../dist",
    "devUrl": "http://localhost:5173"
  },
  "app": {
    "windows": [
      {
        "title": "Lokal Messenger",
        "width": 1100,
        "height": 720,
        "minWidth": 760,
        "minHeight": 500,
        "decorations": true,
        "resizable": true
      }
    ],
    "security": {
      "csp": "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' wss://server.lokal:8443 https://server.lokal:8443"
    }
  },
  "bundle": {
    "active": true,
    "targets": ["msi", "appimage"],
    "icon": ["icons/icon.png"]
  }
}
```

### 9.5. npm qaramliklar

```powershell
cd "C:\Users\admin\lokal-messenger\client"

npm install
npm install zustand
```

### 9.6. Dev rejimda ishga tushirish

```powershell
cd "C:\Users\admin\lokal-messenger\client"

npm run tauri dev
```

Birinchi marta **15–20 daqiqa** Rust kompilyatsiyasi kutiladi. Keyingi safarlarda sekundlarda ishga tushar.

**Natija:** Tauri oynasi ochiladi, React UI koʻrinadi.

---

## 10. Localhost oʻrniga `server.lokal` nomi ishlatish (Windows hosts)

### 10.1. Hosts fayli tahriri

Windows'da:

```
C:\Windows\System32\drivers\etc\hosts
```

**Notepad++** yoki **VS Code** bilan (admin sifatida) oching:

```
127.0.0.1       localhost
127.0.0.1       server.lokal
```

**yoki** (agar network'da alohida server bo'lsa):

```
192.168.X.X     server.lokal
```

Saqlanadi.

### 10.2. TLS sertifikatni Windows'da ishonchli qilish

```powershell
# Sertifikatni import qilish (admin sifatida)
Import-Certificate `
  -FilePath "C:\lokal-msg\tls\server.crt" `
  -CertStoreLocation "Cert:\CurrentUser\Root"
```

Yoki GUI orqali:
1. `C:\lokal-msg\tls\server.crt` faylini o'ng-click → **Open**
2. **Install Certificate** → **Current User** → **Next**
3. **Place all certificates in the following store** → **Trusted Root Certification Authorities** → **Next**
4. **Finish**

---

## 11. Windows'da qo'shimcha masalalar va yechimlar

| Muammo | Yechim |
|--------|--------|
| PostgreSQL ishga tushmaydi | `Services` (services.msc) iconfada postgresql-x64-16 status tekshiriladi, stop/start bosiladi |
| Redis PING javob bermasa | WSL'da Redis ishga tushganligini tekshirish: `wsl redis-cli ping` |
| Tauri Rust xatosi: `cc not found` | Visual Studio C++ Build Tools to'liq o'rnatilganligini tekshirish |
| TLS: `certificate verify failed` | Sertifikat Trusted Root'ga qoʻshilganligini tekshirish (10.2) |
| `psql` 'not found' | Path'ni to'liq yozish: `& "C:\Program Files\PostgreSQL\16\bin\psql.exe"` |
| Server porti `8443` band | `netstat -ano | findstr :8443` bosiladi, process terminate qilinadi |
| Login: 401 Unauthorized | Admin creation qadam tekshiriladi, parol hash to'g'riligi tekshiriladi |

---

## 12. Windows'da oxirgi tekshiruvlar

Birikintilgan blok-test:

```powershell
# 1. PostgreSQL tekshiruvi
$env:PGPASSWORD = 'STRONG_DB_PASSWORD'
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" `
  -h 127.0.0.1 -U msg -d lokal_messenger -c "SELECT COUNT(*) FROM users;"
# Natija: 1 (admin)

# 2. Redis tekshiruvi
redis-cli ping
# Natija: PONG

# 3. Server ishga tushiriladi (yangi terminalda)
cd "C:\Users\admin\lokal-messenger\server"
.\lokal-server.exe

# 4. Login soʻrovi (boshqa terminalda)
$body = @{ username = "admin"; password = "AdminParol123!" } | ConvertTo-Json
(Invoke-WebRequest `
  -Uri https://server.lokal:8443/api/v1/auth/login `
  -Method Post -Body $body -ContentType application/json -SkipCertificateCheck).Content
# Natija: token va user_id

# 5. Tauri client (uchinchi terminalda)
cd "C:\Users\admin\lokal-messenger\client"
npm run tauri dev
# Oyna ochiladi, Login ekrani koʻrinadi
```

---

## Keyingi bosqichlar

Yuqoridagi qadamlar tugagach:
1. Foydalanuvchi `soldat01` qo'shiladi (8.2 boʻlim)
2. Tauri client'da login bajariladi
3. Kalit-bundle avtomatik yaratiladi
4. Tauri .msi (binary) qurib chiqariladi

```powershell
cd "C:\Users\admin\lokal-messenger\client"
npm run tauri build

# Natija:
# C:\Users\admin\lokal-messenger\client\src-tauri\target\release\bundle\msi\lokal-messenger-ui_1.0.0_x64-setup.msi
```

Bu `.msi` fayli boshqa Windows mashinalariga tarqatilishi mumkin.
