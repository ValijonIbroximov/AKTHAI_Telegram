# Noldan ishga tushirish — bosqichma-bosqich qoʻllanma

> Ushbu hujjat sof noldan boshlab loyihani toʻliq ishga tushirish uchun yoʻriqnoma. Har bir bosqichda qaysi dastur oʻrnatiladi, qaysi fayl yaratiladi va ichiga qaysi kod joylashtiriladi koʻrsatilgan. Asosiy kod uchun `HARBIY_MESSENJER.md` faylga murojaat qilinadi (har bosqichdagi havola koʻrsatilgan).

---

## Mundarija

1. [Kerakli dasturlar va uskunalar](#1-kerakli-dasturlar-va-uskunalar)
2. [Loyiha papkasini yaratish](#2-loyiha-papkasini-yaratish)
3. [Maʼlumotlar bazasini koʻtarish (PostgreSQL + Redis)](#3-malumotlar-bazasini-kotarish-postgresql--redis)
4. [Server (Go) — yaratish va ishga tushirish](#4-server-go--yaratish-va-ishga-tushirish)
5. [TLS sertifikat va JWT kalit](#5-tls-sertifikat-va-jwt-kalit)
6. [Birinchi admin hisobini qoʻlda yaratish](#6-birinchi-admin-hisobini-qolda-yaratish)
7. [Mijoz (Tauri + React) — yaratish va qurib chiqarish](#7-mijoz-tauri--react--yaratish-va-qurib-chiqarish)
8. [Birinchi marta sinash](#8-birinchi-marta-sinash)
9. [Mahalliy tarmoqdagi mijoz mashinalarga tarqatish](#9-mahalliy-tarmoqdagi-mijoz-mashinalarga-tarqatish)
10. [Tez-tez uchraydigan muammolar](#10-tez-tez-uchraydigan-muammolar)

---

## 1. Kerakli dasturlar va uskunalar

### 1.1. Server kompyuteri uchun

| Dastur | Versiya | Maqsadi |
|--------|---------|---------|
| **Go** | 1.22+ | Backend kompilyatsiyasi |
| **PostgreSQL** | 16+ | Asosiy maʼlumotlar bazasi |
| **Redis** | 7+ | Sessiya va presence keshi |
| **Docker** + Docker Compose | 24+ | Toʻgʻridan-toʻgʻri yoki konteynerli ishga tushirish |
| **Git** | har qanday | Versiya nazorati |
| **OpenSSL** | 3+ | TLS sertifikat yasash |

### 1.2. Mijoz ilovasini qurish uchun (faqat developer mashinasida)

Mijoz mashinalarida hech nima oʻrnatishga hojat yoʻq — faqat tayyor binari nusxalanadi. Lekin **kim Tauri ilovani QURIB CHIQARADI** kompyuterida quyidagilar boʻlishi kerak:

| Dastur | Versiya | Maqsadi |
|--------|---------|---------|
| **Node.js** + npm | 20+ | Frontend (React/Vite) qurish |
| **Rust** + cargo | 1.78+ | Tauri Rust qismi |
| **Tauri CLI** | 2.0+ | `npm run tauri build` ishlashi uchun |
| Tizim qaramliklari | — | Pastda batafsil |

#### 1.2.1. Linux (Debian/Ubuntu) tizim qaramliklari

```bash
# Tauri uchun zarur paketlar oʻrnatiladi
sudo apt update
sudo apt install -y \
  libwebkit2gtk-4.1-dev \
  build-essential \
  curl \
  wget \
  file \
  libxdo-dev \
  libssl-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev
```

#### 1.2.2. Windows uchun

1. **Microsoft Visual Studio C++ Build Tools** oʻrnatiladi (https://visualstudio.microsoft.com/visual-cpp-build-tools/) — "Desktop development with C++" workload tanlanadi.
2. **WebView2** Windows 11'da oldindan oʻrnatilgan; Windows 10'da Microsoft saytidan yuklab olinadi.

### 1.3. Asosiy dasturlarni oʻrnatish buyruqlari

#### Server uchun (Linux/Ubuntu)

```bash
# Go oʻrnatiladi
wget https://go.dev/dl/go1.22.5.linux-amd64.tar.gz
sudo rm -rf /usr/local/go && sudo tar -C /usr/local -xzf go1.22.5.linux-amd64.tar.gz
echo 'export PATH=$PATH:/usr/local/go/bin' >> ~/.bashrc
source ~/.bashrc
go version    # tekshirish

# PostgreSQL oʻrnatiladi
sudo apt install -y postgresql-16 postgresql-contrib

# Redis oʻrnatiladi
sudo apt install -y redis-server

# Docker oʻrnatiladi (ixtiyoriy — agar konteynerda ishlatmoqchi boʻlsangiz)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER   # qayta loginga kirish kerak
```

#### Developer mashinasi uchun (mijozni quruvchi)

```bash
# Node.js oʻrnatiladi (NodeSource orqali)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Rust oʻrnatiladi
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env
rustc --version

# Tauri CLI oʻrnatiladi
cargo install tauri-cli --version "^2.0" --locked
# Yoki npm orqali:
npm install -g @tauri-apps/cli@^2.0
```

---

## 2. Loyiha papkasini yaratish

```bash
# Bosh papka yaratiladi
mkdir lokal-messenger && cd lokal-messenger

# Quyi papkalar tayyorlanadi
mkdir -p server/cmd/server
mkdir -p server/internal/{auth,api,ws,db,cache,config,middleware,models}
mkdir -p server/db/migrations
mkdir -p deploy/tls
mkdir -p client
```

Yakuniy struktura quyidagicha boʻladi:

```
lokal-messenger/
├── server/
│   ├── cmd/server/
│   ├── internal/
│   │   ├── auth/
│   │   ├── api/
│   │   ├── ws/
│   │   ├── db/
│   │   ├── cache/
│   │   ├── config/
│   │   ├── middleware/
│   │   └── models/
│   ├── db/migrations/
│   ├── go.mod              # 4-bosqichda yaratiladi
│   └── config.yaml         # 4-bosqichda yaratiladi
├── client/                 # 7-bosqichda yaratiladi
└── deploy/
    ├── tls/                # 5-bosqichda toʻldiriladi
    └── docker-compose.yml  # ixtiyoriy
```

---

## 3. Maʼlumotlar bazasini koʻtarish (PostgreSQL + Redis)

### 3.1. PostgreSQL'ni sozlash

```bash
# PostgreSQL xizmati ishga tushiriladi
sudo systemctl enable --now postgresql

# postgres foydalanuvchisi orqali baza va akkaunt yaratiladi
sudo -u postgres psql <<EOF
CREATE USER msg WITH PASSWORD 'STRONG_DB_PASSWORD';
CREATE DATABASE lokal_messenger OWNER msg;
GRANT ALL PRIVILEGES ON DATABASE lokal_messenger TO msg;
EOF
```

### 3.2. Migratsiya faylini yaratish

`HARBIY_MESSENJER.md` ning **1.1 boʻlimidagi SQL** ushbu faylga koʻchiriladi:

**Fayl yoʻli:** `server/db/migrations/0001_init.sql`

> `HARBIY_MESSENJER.md` → "1.1. PostgreSQL sxemasi" boʻlimidagi `CREATE EXTENSION` bilan boshlangan blok toʻliq nusxalab joylashtiriladi.

### 3.3. Migratsiya bajariladi

```bash
# Sxema bazaga yuklanadi
PGPASSWORD=STRONG_DB_PASSWORD psql \
  -h 127.0.0.1 -U msg -d lokal_messenger \
  -f server/db/migrations/0001_init.sql

# Tekshirish — jadvallar roʻyxati koʻriladi
PGPASSWORD=STRONG_DB_PASSWORD psql \
  -h 127.0.0.1 -U msg -d lokal_messenger -c "\dt"
```

Natijada `users`, `chats`, `messages`, `audit_log` va boshqa jadvallar koʻrinishi kerak.

### 3.4. Redis'ni sozlash

```bash
# Redis ishga tushiriladi
sudo systemctl enable --now redis-server

# Tekshirish — javob "PONG" boʻlishi kerak
redis-cli ping
```

Yopiq tarmoq xavfsizligi uchun `/etc/redis/redis.conf` faylida quyidagilar oʻrnatiladi:

```
bind 127.0.0.1
protected-mode yes
maxmemory 256mb
maxmemory-policy allkeys-lru
```

```bash
# Konfiguratsiya yangilangach Redis qayta ishga tushiriladi
sudo systemctl restart redis-server
```

---

## 4. Server (Go) — yaratish va ishga tushirish

### 4.1. Go modulini boshlash

```bash
cd server
go mod init github.com/military/lokal-messenger/server
```

### 4.2. Kerakli paketlar olinadi

```bash
go get github.com/gofiber/fiber/v2@v2.52.5
go get github.com/gofiber/contrib/websocket@v1.3.2
go get github.com/golang-jwt/jwt/v5@v5.2.1
go get github.com/jackc/pgx/v5@v5.6.0
go get github.com/redis/go-redis/v9@v9.5.3
go get golang.org/x/crypto@v0.24.0
go get github.com/google/uuid@v1.6.0
go get gopkg.in/yaml.v3@v3.0.1
```

### 4.3. Konfiguratsiya fayli yaratiladi

**Fayl yoʻli:** `server/config.yaml`

> `HARBIY_MESSENJER.md` → "2.1 Konfiguratsiya va `go.mod`" boʻlimidagi `config.yaml` namuna nusxalanadi va `STRONG` parol oʻrniga 3.1 bosqichda kiritilgan haqiqiy parol yoziladi.

### 4.4. Konfiguratsiya yuklash modulini yozish

**Fayl yoʻli:** `server/internal/config/config.go`

```go
// Fayl: server/internal/config/config.go
// Maqsad: YAML konfiguratsiya fayli oʻqilib, struktura sifatida qaytariladi.
package config

import (
    "os"
    "gopkg.in/yaml.v3"
)

type Config struct {
    Server   ServerConfig   `yaml:"server"`
    Database DatabaseConfig `yaml:"database"`
    Redis    RedisConfig    `yaml:"redis"`
    Auth     AuthConfig     `yaml:"auth"`
    Limits   LimitsConfig   `yaml:"limits"`
}

type ServerConfig struct {
    BindAddress string    `yaml:"bind_address"`
    TLS         TLSConfig `yaml:"tls"`
}
type TLSConfig struct {
    Enabled  bool   `yaml:"enabled"`
    CertFile string `yaml:"cert_file"`
    KeyFile  string `yaml:"key_file"`
}
type DatabaseConfig struct {
    DSN          string `yaml:"dsn"`
    MaxOpenConns int    `yaml:"max_open_conns"`
    MaxIdleConns int    `yaml:"max_idle_conns"`
}
type RedisConfig struct {
    Addr     string `yaml:"addr"`
    Password string `yaml:"password"`
    DB       int    `yaml:"db"`
}
type AuthConfig struct {
    JWTSecretFile    string       `yaml:"jwt_secret_file"`
    AccessTTLMinutes int          `yaml:"access_ttl_minutes"`
    Argon2           Argon2Params `yaml:"argon2"`
}
type Argon2Params struct {
    Memory      uint32 `yaml:"memory_kb"`
    Iterations  uint32 `yaml:"iterations"`
    Parallelism uint8  `yaml:"parallelism"`
    SaltLength  uint32 `yaml:"salt_length"`
    KeyLength   uint32 `yaml:"key_length"`
}
type LimitsConfig struct {
    MaxMessageSizeBytes int64 `yaml:"max_message_size_bytes"`
    MaxFileSizeBytes    int64 `yaml:"max_file_size_bytes"`
    RateLoginPer5Min    int   `yaml:"rate_login_per_5min"`
}

// Konfiguratsiya fayli yuklanadi
func Load(path string) (*Config, error) {
    raw, err := os.ReadFile(path)
    if err != nil {
        return nil, err
    }
    var cfg Config
    if err := yaml.Unmarshal(raw, &cfg); err != nil {
        return nil, err
    }
    return &cfg, nil
}
```

### 4.5. DB va Redis ulanish modullari

**Fayl yoʻli:** `server/internal/db/pool.go`

```go
// Fayl: server/internal/db/pool.go
// Maqsad: PostgreSQL ulanish hovuzi tayyorlanadi.
package db

import (
    "context"
    "github.com/jackc/pgx/v5/pgxpool"
    "github.com/military/lokal-messenger/server/internal/config"
)

func NewPool(ctx context.Context, cfg config.DatabaseConfig) (*pgxpool.Pool, error) {
    pcfg, err := pgxpool.ParseConfig(cfg.DSN)
    if err != nil {
        return nil, err
    }
    if cfg.MaxOpenConns > 0 {
        pcfg.MaxConns = int32(cfg.MaxOpenConns)
    }
    if cfg.MaxIdleConns > 0 {
        pcfg.MinConns = int32(cfg.MaxIdleConns)
    }
    return pgxpool.NewWithConfig(ctx, pcfg)
}
```

**Fayl yoʻli:** `server/internal/cache/redis.go`

```go
// Fayl: server/internal/cache/redis.go
// Maqsad: Redis mijozi tayyorlanadi.
package cache

import (
    "context"
    "github.com/redis/go-redis/v9"
    "github.com/military/lokal-messenger/server/internal/config"
)

func NewClient(cfg config.RedisConfig) (*redis.Client, error) {
    c := redis.NewClient(&redis.Options{
        Addr:     cfg.Addr,
        Password: cfg.Password,
        DB:       cfg.DB,
    })
    if err := c.Ping(context.Background()).Err(); err != nil {
        return nil, err
    }
    return c, nil
}
```

### 4.6. Asosiy server fayllarini joylashtirish

`HARBIY_MESSENJER.md` boʻyicha quyidagi fayllar bir-biriga toʻgʻri kelgan kataloglarga koʻchiriladi:

| Fayl yoʻli | Manba (HARBIY_MESSENJER.md boʻlimi) |
|-----------|-------------------------------------|
| `server/cmd/server/main.go` | 2.2 |
| `server/internal/auth/password.go` | 2.3 |
| `server/internal/auth/jwt.go` | 2.4 |
| `server/internal/middleware/auth.go` | 2.5 |
| `server/internal/api/auth_routes.go` | 2.6 |
| `server/internal/api/admin_routes.go` | 2.6 |
| `server/internal/api/keys_routes.go` | 2.7 |
| `server/internal/ws/hub.go` | 2.8 |
| `server/internal/ws/handler.go` | 2.8 |
| `server/internal/api/router.go` | 2.9 |

`Handlers` strukturasi va `Deps` toʻplami hali yozilmagan, shuning uchun yana bitta yordamchi fayl qoʻshiladi:

**Fayl yoʻli:** `server/internal/api/handlers.go`

```go
// Fayl: server/internal/api/handlers.go
// Maqsad: Barcha REST handlerlar uchun umumiy bogʻliqliklar konteyneri.
package api

import (
    "github.com/gofiber/fiber/v2"
    "github.com/jackc/pgx/v5/pgxpool"
    "github.com/redis/go-redis/v9"
    "github.com/military/lokal-messenger/server/internal/auth"
    "github.com/military/lokal-messenger/server/internal/config"
    "github.com/military/lokal-messenger/server/internal/ws"
)

type Deps struct {
    DB     *pgxpool.Pool
    Cache  *redis.Client
    JWT    *auth.JWTManager
    Hub    *ws.Hub
    Config *config.Config
}

type Handlers struct {
    deps *Deps
}

// Yagona xato handler — barcha xatolarni JSON formatda qaytaradi
func ErrorHandler(c *fiber.Ctx, err error) error {
    code := fiber.StatusInternalServerError
    msg := "ichki xatolik"
    if e, ok := err.(*fiber.Error); ok {
        code = e.Code
        msg = e.Message
    }
    return c.Status(code).JSON(fiber.Map{"error": msg})
}

// Quyidagi handlerlar 'me', 'logout', 'change-password' kabilar
// dastlabki bosqichda boʻsh implementatsiya bilan qoldiriladi.
// Toʻliq versiyasi keyingi takomillashtirishlarda yoziladi.
func (h *Handlers) ChangePassword(c *fiber.Ctx) error {
    return fiber.NewError(fiber.StatusNotImplemented, "tez orada")
}
func (h *Handlers) Logout(c *fiber.Ctx) error {
    jti, _ := c.Locals("jti").(string)
    if jti != "" {
        _ = h.deps.Cache.Del(c.Context(), "session:"+jti).Err()
    }
    return c.SendStatus(fiber.StatusNoContent)
}
func (h *Handlers) Me(c *fiber.Ctx) error {
    uid, _ := c.Locals("user_id").(string)
    role, _ := c.Locals("role").(string)
    return c.JSON(fiber.Map{"user_id": uid, "role": role})
}
func (h *Handlers) RefillOneTimePreKeys(c *fiber.Ctx) error {
    return fiber.NewError(fiber.StatusNotImplemented, "tez orada")
}
func (h *Handlers) ListChats(c *fiber.Ctx) error {
    return c.JSON([]any{})
}
func (h *Handlers) CreateChat(c *fiber.Ctx) error {
    return fiber.NewError(fiber.StatusNotImplemented, "tez orada")
}
func (h *Handlers) ChatHistory(c *fiber.Ctx) error {
    return c.JSON([]any{})
}
func (h *Handlers) ListUsers(c *fiber.Ctx) error {
    rows, err := h.deps.DB.Query(c.Context(),
        `SELECT id::text, username, display_name, role, rank_title, unit_code
           FROM users WHERE is_active = TRUE ORDER BY display_name`)
    if err != nil {
        return err
    }
    defer rows.Close()
    var out []fiber.Map
    for rows.Next() {
        var id, u, dn, role string
        var rank, unit *string
        _ = rows.Scan(&id, &u, &dn, &role, &rank, &unit)
        out = append(out, fiber.Map{
            "id": id, "username": u, "display_name": dn,
            "role": role, "rank_title": rank, "unit_code": unit,
        })
    }
    return c.JSON(out)
}
func (h *Handlers) AdminAuditLog(c *fiber.Ctx) error {
    rows, err := h.deps.DB.Query(c.Context(),
        `SELECT id, actor_id::text, action, target_id::text, ip_address::text, created_at
           FROM audit_log ORDER BY created_at DESC LIMIT 200`)
    if err != nil {
        return err
    }
    defer rows.Close()
    var out []fiber.Map
    for rows.Next() {
        var id int64
        var actor, action, target, ip string
        var created any
        _ = rows.Scan(&id, &actor, &action, &target, &ip, &created)
        out = append(out, fiber.Map{
            "id": id, "actor_id": actor, "action": action,
            "target_id": target, "ip": ip, "created_at": created,
        })
    }
    return c.JSON(out)
}
```

> **Eslatma:** `auth_routes.go`'dagi `auth.VerifyPassword` chaqiruvi ishlashi uchun shu paket import qilingan boʻlishi kerak. Faylning yuqorisida `import "github.com/military/lokal-messenger/server/internal/auth"` mavjud emasligini tekshirish kerak — agar `auth.HashPassword` chaqirilayotgan boʻlsa, import qoʻshiladi.

### 4.7. Loyiha kompilyatsiya qilinadi

```bash
cd server
go mod tidy           # qaramliklar tartibga solinadi
go build -o lokal-server ./cmd/server
```

Agar `go build` muvaffaqiyatsiz tugasa, xato paketlari roʻyxatga olinib, quyida koʻrsatilgan tartibda xatolar tekshiriladi:

- `import` yoʻllari toʻgʻri kelmasa — paket nomi `github.com/military/lokal-messenger/server` bilan boshlanishi kerak.
- Migratsiya bajarilmagan boʻlsa — `lokal_messenger` bazasidagi jadvallar mavjudligi tekshiriladi.

---

## 5. TLS sertifikat va JWT kalit

### 5.1. JWT kaliti yaratiladi

```bash
sudo mkdir -p /etc/lokal-msg
sudo openssl rand -out /etc/lokal-msg/jwt.key 64
sudo chmod 600 /etc/lokal-msg/jwt.key
```

### 5.2. Oʻz-oʻzini imzolovchi TLS sertifikat (yopiq tarmoq uchun)

```bash
# Sertifikat yaratiladi (10 yillik amal qilish muddati bilan)
sudo openssl req -x509 -newkey rsa:4096 -nodes \
  -keyout /etc/lokal-msg/server.key \
  -out /etc/lokal-msg/server.crt \
  -days 3650 \
  -subj "/C=UZ/O=Harbiy/CN=server.lokal" \
  -addext "subjectAltName=DNS:server.lokal,IP:192.168.10.10"
sudo chmod 600 /etc/lokal-msg/server.key
sudo chmod 644 /etc/lokal-msg/server.crt
```

> Yuqoridagi `192.168.10.10` oʻrniga tarmoqdagi haqiqiy server IP adresi yoziladi. Mijozlar shu IP yoki `server.lokal` nom orqali ulanadi.

### 5.3. Mijozlar uchun sertifikatni eksport qilish

`/etc/lokal-msg/server.crt` faylining nusxasi har bir mijoz mashinasiga koʻchiriladi va ishonchli sertifikatlar roʻyxatiga qoʻshiladi (Windows: "Trusted Root Certification Authorities", Linux: `/usr/local/share/ca-certificates/` + `update-ca-certificates`).

Mijoz mashinasi `/etc/hosts` (yoki `C:\Windows\System32\drivers\etc\hosts`) fayliga qator qoʻshiladi:

```
192.168.10.10  server.lokal
```

---

## 6. Birinchi admin hisobini qoʻlda yaratish

Loyihada ochiq roʻyxatdan oʻtish yoʻq. Birinchi admin **toʻgʻridan-toʻgʻri bazaga** qoʻshiladi.

### 6.1. Argon2id xeshini hosil qilish

Eng oson yoʻl — kichik bir Go fayli yaratib, parol xeshlanadi:

**Fayl yoʻli:** `server/cmd/hashtool/main.go`

```go
// Fayl: server/cmd/hashtool/main.go
// Maqsad: Argon2id xeshini terminalda chiqaradigan yordamchi vosita.
package main

import (
    "fmt"
    "os"
    "github.com/military/lokal-messenger/server/internal/auth"
)

func main() {
    if len(os.Args) < 2 {
        fmt.Println("Foydalanish: hashtool <parol>")
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

```bash
cd server
go run ./cmd/hashtool 'AdminParol123!'
# natija: argon2id$v=19$m=65536,t=3,p=2$...$...
```

> **Diqqat:** `auth/password.go`'dagi `Argon2Params` struktura `config.Argon2Params` bilan bir xil maydonlarga ega — agar paket nomida farq boʻlsa, hashtool fayl ichida `auth.Argon2Params` oʻrniga `config.Argon2Params` ishlatish kerak. Asosiy versiyada esa `password.go` ichidagi tip ishlatilgan.

### 6.2. Admin foydalanuvchi qoʻshiladi

```sql
-- Argon2id xeshi yuqoridagi buyruqdan koʻchirib qoʻyiladi
INSERT INTO users (
    username, password_hash, display_name, role, must_change_password
) VALUES (
    'admin',
    'argon2id$v=19$m=65536,t=3,p=2$...$...',   -- bu yerga toʻliq xesh yoziladi
    'Bosh Administrator',
    'admin',
    FALSE
);
```

```bash
PGPASSWORD=STRONG_DB_PASSWORD psql -h 127.0.0.1 -U msg -d lokal_messenger \
  -c "INSERT INTO users (...) VALUES (...);"
```

---

## 7. Mijoz (Tauri + React) — yaratish va qurib chiqarish

### 7.1. Tauri loyihasi tayyorlanadi

```bash
cd ../    # lokal-messenger papkasiga qaytamiz
# Yangi Tauri loyihasi yaratiladi
npm create tauri-app@latest client -- --template react-ts --manager npm
```

Sehrgar quyidagicha javob soʻraydi:

- **App name:** `lokal-messenger-ui`
- **Window title:** `Lokal Messenger`
- **Frontend language:** TypeScript / JavaScript → **TypeScript**
- **Package manager:** **npm**
- **UI template:** **React**
- **UI flavor:** **TypeScript**

### 7.2. Frontend qaramliklari oʻrnatiladi

```bash
cd client
npm install zustand
```

### 7.3. Rust qaramliklarini Cargo.toml'ga qoʻshish

`HARBIY_MESSENJER.md` → "3.1 Mijozdagi Rust kreyti" boʻlimidagi **Cargo.toml** mazmuni `client/src-tauri/Cargo.toml` fayliga koʻchiriladi (mavjud `[dependencies]` boʻlimini almashtirib).

```bash
cd client/src-tauri
cargo build           # birinchi qurilish — uzoq davom etishi mumkin
```

### 7.4. Tauri konfiguratsiyasi yangilanadi

**Fayl yoʻli:** `client/src-tauri/tauri.conf.json`

`HARBIY_MESSENJER.md` → "4.1 Tauri konfiguratsiyasi" boʻlimidagi JSON to'liq nusxalanadi. Diqqat: `connect-src` ichidagi `wss://server.lokal:8443` haqiqiy server adresi bilan moslashtirilishi kerak.

### 7.5. Rust manba fayllari joylashtiriladi

| Fayl yoʻli | Manba (HARBIY_MESSENJER.md) |
|-----------|-----------------------------|
| `client/src-tauri/src/crypto.rs` | 3.2 |
| `client/src-tauri/src/store.rs` | 3.3 |
| `client/src-tauri/src/session.rs` | 3.4 |
| `client/src-tauri/src/main.rs` | 3.5 |

Yana `net.rs` moduli zarur — u API client'ni amalga oshiradi:

**Fayl yoʻli:** `client/src-tauri/src/net.rs`

```rust
// Fayl: client/src-tauri/src/net.rs
// Maqsad: Server bilan REST/WS aloqasi inkapsulyatsiya qilinadi.
use serde_json::Value;
use crate::crypto::GeneratedBundle;
use crate::store::LocalSignalStore;

#[derive(Clone)]
pub struct ApiClient {
    base_url: String,
    token:    Option<String>,
    http:     reqwest::Client,
}

impl ApiClient {
    pub fn new(base_url: &str) -> Self {
        // TLS uchun ichki CA sertifikati ishonchli sanaladi
        let http = reqwest::Client::builder()
            .danger_accept_invalid_certs(true)   // yopiq tarmoqda — pinning keyin qo'yiladi
            .build()
            .unwrap();
        Self { base_url: base_url.into(), token: None, http }
    }

    /// Login soʻrovi yuboriladi va token saqlanadi
    pub async fn login(&mut self, username: &str, password: &str) -> Result<Value, reqwest::Error> {
        let res = self.http
            .post(format!("{}/api/v1/auth/login", self.base_url))
            .json(&serde_json::json!({ "username": username, "password": password }))
            .send().await?
            .error_for_status()?
            .json::<Value>().await?;
        if let Some(t) = res.get("token").and_then(|v| v.as_str()) {
            self.token = Some(t.to_string());
        }
        Ok(res)
    }

    /// Kalit-bundle yuklanadi
    pub async fn upload_bundle(&self, bundle: &GeneratedBundle) -> Result<(), reqwest::Error> {
        let _ = self.http
            .post(format!("{}/api/v1/keys/upload", self.base_url))
            .bearer_auth(self.token.as_deref().unwrap_or(""))
            .json(bundle)
            .send().await?
            .error_for_status()?;
        Ok(())
    }

    /// Sherikning bundle'i olinadi
    pub async fn fetch_bundle(&self, peer_id: &str) -> Result<Value, reqwest::Error> {
        self.http
            .get(format!("{}/api/v1/keys/{}/bundle", self.base_url, peer_id))
            .bearer_auth(self.token.as_deref().unwrap_or(""))
            .send().await?
            .error_for_status()?
            .json::<Value>().await
    }

    /// WebSocket orqali shifrlangan xabar yuboriladi (placeholder)
    pub async fn ws_send(&self, _chat: &str, _to: &str, _ct: &[u8], _t: u8) -> Result<(), reqwest::Error> {
        // Toʻliq versiyada bu yerda WebSocket conn ishlatiladi.
        Ok(())
    }
}

/// Lokal saqlovda berilgan foydalanuvchi bilan sessiya borligini tekshiradi
pub fn has_session(_store: &LocalSignalStore, _peer: &str) -> bool {
    // Hozirda har doim false qaytariladi — sessiya har gal qayta oʻrnatiladi
    false
}
```

### 7.6. React komponentlari joylashtiriladi

```bash
mkdir -p client/src/{components,pages,stores,styles,net}
```

| Fayl yoʻli | Manba (HARBIY_MESSENJER.md) |
|-----------|-----------------------------|
| `client/src/App.tsx` | 4.4 |
| `client/src/styles/theme.css` | 4.3 |
| `client/src/styles/layout.css` | 4.4 |
| `client/src/styles/login.css` | 4.5 |
| `client/src/styles/chatlist.css` | 4.6 |
| `client/src/styles/chatview.css` | 4.7 |
| `client/src/pages/LoginPage.tsx` | 4.5 |
| `client/src/components/ChatList.tsx` | 4.6 |
| `client/src/components/ChatView.tsx` | 4.7 |
| `client/src/stores/auth.ts` | 4.8 |
| `client/src/stores/theme.ts` | 4.8 |
| `client/src/stores/chats.ts` | 4.8 |
| `client/src/net/socket.ts` | 4.9 |

`client/src/main.tsx` faylini quyidagicha tahrirlash kerak (default Tauri shabloniga `App.tsx` import yoʻli moslashtiriladi):

```tsx
// Fayl: client/src/main.tsx
// Maqsad: React ilovasi DOM'ga monatj qilinadi.
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

CSS fayllari faqat shu paytda chaqirilganda yuklanadi; `App.tsx`'da `theme.css` va `layout.css` allaqachon import qilingan. Qolganlari tegishli komponentlardan import qilinishi kerak:

```tsx
// LoginPage.tsx birinchi qatoriga
import "../styles/login.css";

// ChatList.tsx birinchi qatoriga
import "../styles/chatlist.css";

// ChatView.tsx birinchi qatoriga
import "../styles/chatview.css";
```

### 7.7. Mijoz dev rejimda ishga tushiriladi

```bash
cd client
npm run tauri dev
```

Birinchi ishga tushishda Rust kompilyatsiyasi 5–15 daqiqa vaqt oladi. Keyingi safarlarda inkremental kompilyatsiya tufayli sekundlar.

### 7.8. Production binari yasaladi

```bash
npm run tauri build
```

Natija fayllari:

- **Linux:** `client/src-tauri/target/release/bundle/appimage/lokal-messenger-ui_*.AppImage` va `bundle/deb/lokal-messenger-ui_*.deb`
- **Windows:** `client/src-tauri/target/release/bundle/msi/lokal-messenger-ui_*.msi`

---

## 8. Birinchi marta sinash

### 8.1. Server ishga tushiriladi

```bash
cd server
sudo ./lokal-server
# yoki konfiguratsiya boshqa joyda boʻlsa:
# sudo ./lokal-server -config /path/to/config.yaml
```

Logda quyidagi qator koʻrinishi kerak:

```
Server TLS bilan tinglanmoqda: 0.0.0.0:8443
```

### 8.2. Login soʻrovi sinab koʻriladi (curl orqali)

```bash
curl -k -X POST https://server.lokal:8443/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"AdminParol123!"}'
```

Javob:

```json
{
  "token": "eyJhbGciOi...",
  "user_id": "uuid...",
  "role": "admin",
  "must_change_password": false
}
```

### 8.3. Yangi foydalanuvchi yaratiladi

```bash
TOKEN="eyJhbGciOi..."   # yuqoridagi javobdan token qoʻyiladi

curl -k -X POST https://server.lokal:8443/api/v1/admin/users \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "soldat01",
    "display_name": "Sergeant Aliyev",
    "role": "user",
    "rank_title": "Serjant",
    "unit_code": "B-12"
  }'
```

Javobda berilgan `temporary_password` foydalanuvchiga xavfsiz kanal orqali yetkaziladi.

### 8.4. Tauri ilovada login

`npm run tauri dev` orqali ishga tushgan oynada yuqoridagi `soldat01` login va vaqtinchalik parol kiritiladi. Muvaffaqiyatli kirgach, kalit-bundle avtomatik yaratilib serverga yuklanadi.

---

## 9. Mahalliy tarmoqdagi mijoz mashinalarga tarqatish

1. Sizdan biror mijoz mashinasi yopiq tarmoqqa ulanadi va server IP bilan `ping` tekshiriladi.
2. `server.crt` mijoz mashinasi ishonchli sertifikatlariga qoʻshiladi (5.3 boʻlim).
3. `lokal-messenger-ui_*.msi` (Windows) yoki `*.AppImage` (Linux) nusxalanadi va oʻrnatiladi.
4. Birinchi ishga tushganida foydalanuvchi admin bergan login va vaqtinchalik parolni kiritadi.

---

## 10. Tez-tez uchraydigan muammolar

| Belgi | Sabab | Yechim |
|-------|-------|--------|
| `connect: connection refused` | PostgreSQL yoki Redis ishlamayapti | `systemctl status postgresql redis-server` |
| `pq: password authentication failed` | DSN'dagi parol notoʻgʻri | `config.yaml` da DSN tekshiriladi |
| `cannot find package "github.com/..."` | `go mod tidy` qilinmagan | `cd server && go mod tidy` |
| Tauri'da `error: linker cc not found` (Linux) | Build-essential yoʻq | 1.2.1 boʻlimdagi paketlar oʻrnatiladi |
| `TLS handshake failure` mijozda | Sertifikat ishonchli emas | 5.3 boʻlimdagi qadamlar bajariladi |
| Mijoz ulansa-da, xabar yuborilmasa | WebSocket porti yopiq | `firewall-cmd --add-port=8443/tcp --permanent` |
| Login: 429 Too Many Requests | 5 daqiqada 5 dan ortiq urinish | 5 daqiqa kutiladi yoki Redis'da `ratelimit:login:*` tozalaniladi |
| `failed_login_attempts >= 5` | Hisob bloklangan | `UPDATE users SET locked_until = NULL, failed_login_attempts = 0 WHERE username = '...'` |
| `libsignal` qurilmaganda Rust xato | Versiya tagi mos kelmadi | `Cargo.toml`'da `tag = "v0.50.0"` aniq versiya qoʻyiladi |

---

## Qisqa ishga tushirish kun-tartibi

| Vaqt | Qadam |
|------|-------|
| 0–30 daqiqa | Server mashinasiga Go, PostgreSQL, Redis oʻrnatiladi (1 va 3 boʻlimlar) |
| 30–60 daqiqa | Loyiha papkasi tayyorlanadi, baza migratsiyasi bajariladi (2, 3.2, 3.3) |
| 60–120 daqiqa | Server kodi joylashtiriladi va kompilyatsiya qilinadi (4 boʻlim) |
| 120–135 daqiqa | TLS va JWT kalit yasaladi (5 boʻlim) |
| 135–150 daqiqa | Birinchi admin yaratiladi va server sinab koʻriladi (6 va 8.1–8.3) |
| 150–300 daqiqa | Tauri mijoz qurilib chiqariladi (7 boʻlim) |
| 300+ daqiqa | Mijoz mashinalarga tarqatiladi va sinab koʻriladi (9 boʻlim) |

> Birinchi qurilishda Rust kreytlari yuklab olish va kompilyatsiya tufayli vaqt koʻproq ketadi. Keyingi takrorlashlarda inkremental qurilish ancha tezroq.
