# Harbiy Lokal Messenjer — Toʻliq Arxitektura va Kod Bazasi

> **Loyiha:** Yopiq tarmoqda ishlovchi, Telegram interfeysiga oʻxshash, E2EE shifrlangan, kuchsiz mijoz mashinalariga moslashtirilgan messenjer.
> **Stack:** Go 1.22 (server) · PostgreSQL 16 · Redis 7 · Tauri 2.0 + React 18 (mijoz) · Signal Protocol (E2EE)
> **Izohlar uslubi:** Barcha kod izohlari **tavsiflovchi** bayonotlar shaklida yoziladi (masalan, "Server ishga tushiriladi", "Xabar shifrlanadi").

---

## Mundarija

1. [Umumiy arxitektura](#0-umumiy-arxitektura)
2. [1-Bosqich: Maʼlumotlar bazasi va arxitektura](#1-bosqich-malumotlar-bazasi-va-arxitektura)
3. [2-Bosqich: Xavfsiz backend (Go)](#2-bosqich-xavfsiz-backend-go)
4. [3-Bosqich: Kriptografiya (Signal Protocol E2EE)](#3-bosqich-kriptografiya-signal-protocol-e2ee)
5. [4-Bosqich: Tauri mijoz ilovasi](#4-bosqich-tauri-mijoz-ilovasi)
6. [Ishga tushirish va sinov](#ishga-tushirish-va-sinov)

---

## 0. Umumiy arxitektura

```
┌─────────────────────────┐         ┌──────────────────────────────┐
│  Tauri Client (Rust+JS) │         │  Tauri Client (Rust+JS)      │
│  ┌──────────────────┐   │         │  ┌──────────────────┐        │
│  │ React UI (TG-UX) │   │         │  │ React UI (TG-UX) │        │
│  └────────┬─────────┘   │         │  └────────┬─────────┘        │
│           │ IPC         │         │           │ IPC              │
│  ┌────────▼─────────┐   │         │  ┌────────▼─────────┐        │
│  │ libsignal (Rust) │   │         │  │ libsignal (Rust) │        │
│  │   X3DH + DR      │   │         │  │   X3DH + DR      │        │
│  └────────┬─────────┘   │         │  └────────┬─────────┘        │
└───────────┼─────────────┘         └───────────┼──────────────────┘
            │ WSS (TLS)                         │ WSS (TLS)
            │  + JWT                            │  + JWT
            └─────────────┬─────────────────────┘
                          │
                ┌─────────▼──────────┐
                │   Go Server        │
                │  ┌──────────────┐  │
                │  │ REST  (Auth, │  │
                │  │  Admin, Keys)│  │
                │  └──────┬───────┘  │
                │  ┌──────▼───────┐  │
                │  │  WS Hub      │  │
                │  │  (Relay)     │  │
                │  └──┬────────┬──┘  │
                └─────┼────────┼─────┘
                      │        │
              ┌───────▼──┐  ┌──▼────────┐
              │ Postgres │  │   Redis   │
              │ (durable)│  │ (presence,│
              │          │  │  sessions)│
              └──────────┘  └───────────┘
```

**Asosiy tamoyillar:**

- Server **hech qachon** ochiq xabar matnini koʻrmaydi — faqat shifrlangan baytlarni marshrutlaydi.
- Hisob yaratish faqat admin orqali — ochiq roʻyxatdan oʻtish butunlay oʻchirilgan.
- Mijozda libsignal Rust kutubxonasi ishlatiladi (Tauri sidecar emas, balki ichki kreyt sifatida).
- Tauri brauzer komponentini chaqirmasdan tizim WebView'sidan foydalanadi — natijada bin ~6–10 MB, RAM ~50–80 MB.

---

# 1-Bosqich: Maʼlumotlar bazasi va arxitektura

## 1.1. PostgreSQL sxemasi

Migratsiya fayli `db/migrations/0001_init.sql` sifatida saqlanadi. Schema yopiq tarmoqda nomli IP cheklovlari ostida ishlashi mo'ljallangan.

```sql
-- Fayl: db/migrations/0001_init.sql
-- Maqsad: Lokal messenjer uchun butun ma'lumotlar modeli yaratiladi.

-- UUID generatori uchun kengaytma yoqiladi
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- Foydalanuvchilar jadvali
-- Faqat admin foydalanuvchi hisoblarini yarata oladi.
-- Parol argon2id hash qilinib saqlanadi (clear text emas).
-- ============================================================
CREATE TABLE users (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username                VARCHAR(64) UNIQUE NOT NULL,
    password_hash           TEXT NOT NULL,                  -- argon2id$...$...
    display_name            VARCHAR(128) NOT NULL,
    role                    VARCHAR(16) NOT NULL DEFAULT 'user',
                                                            -- 'admin' yoki 'user'
    rank_title              VARCHAR(64),                    -- Harbiy unvon (ixtiyoriy)
    unit_code               VARCHAR(64),                    -- Boʻlinma kodi
    is_active               BOOLEAN NOT NULL DEFAULT TRUE,
    must_change_password    BOOLEAN NOT NULL DEFAULT TRUE,  -- Birinchi kirishda
    failed_login_attempts   INTEGER NOT NULL DEFAULT 0,
    locked_until            TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at            TIMESTAMPTZ,
    CONSTRAINT users_role_check CHECK (role IN ('admin', 'user'))
);

CREATE INDEX idx_users_username ON users(username) WHERE is_active = TRUE;

-- ============================================================
-- Signal Protocol identifikator kalitlari
-- Har bir foydalanuvchining doimiy identity public key'i shu yerda saqlanadi.
-- Server faqat OCHIQ kalitlarni biladi.
-- ============================================================
CREATE TABLE identity_keys (
    user_id            UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    registration_id    INTEGER NOT NULL,
    identity_key       BYTEA NOT NULL,            -- Curve25519 public key (33 bayt)
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Imzolangan oldindan-kalit (Signed PreKey)
-- Vaqtinchalik, mijoz tomonidan davriy yangilanadi.
-- ============================================================
CREATE TABLE signed_prekeys (
    id              BIGSERIAL PRIMARY KEY,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key_id          INTEGER NOT NULL,
    public_key      BYTEA NOT NULL,
    signature       BYTEA NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, key_id)
);

CREATE INDEX idx_signed_prekeys_user ON signed_prekeys(user_id, created_at DESC);

-- ============================================================
-- Bir martalik oldindan-kalitlar (One-Time PreKeys)
-- X3DH almashish uchun foydalanilgach, used=TRUE qoʻyiladi.
-- ============================================================
CREATE TABLE one_time_prekeys (
    id              BIGSERIAL PRIMARY KEY,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key_id          INTEGER NOT NULL,
    public_key      BYTEA NOT NULL,
    used            BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, key_id)
);

CREATE INDEX idx_otpk_user_unused
    ON one_time_prekeys(user_id) WHERE used = FALSE;

-- ============================================================
-- Suhbatlar (chats): shaxsiy yoki guruh
-- ============================================================
CREATE TABLE chats (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type            VARCHAR(16) NOT NULL,           -- 'private' yoki 'group'
    title           VARCHAR(128),                   -- Guruhlar uchun
    created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chats_type_check CHECK (type IN ('private', 'group'))
);

-- ============================================================
-- Suhbat aʼzolari
-- ============================================================
CREATE TABLE chat_members (
    chat_id         UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role            VARCHAR(16) NOT NULL DEFAULT 'member',
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_read_at    TIMESTAMPTZ,
    PRIMARY KEY (chat_id, user_id),
    CONSTRAINT chat_members_role_check CHECK (role IN ('owner', 'admin', 'member'))
);

CREATE INDEX idx_chat_members_user ON chat_members(user_id);

-- ============================================================
-- Xabarlar — server faqat shifrlangan ciphertext'ni saqlaydi.
-- Plain matnni server hech qachon koʻrmaydi.
-- ============================================================
CREATE TABLE messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_id         UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    sender_id       UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
    -- Har bir aʼzo uchun alohida ciphertext yozuvi yaratiladi
    -- (chunki Signal Double Ratchet juftliklar boʻyicha ishlaydi).
    recipient_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ciphertext      BYTEA NOT NULL,
    msg_type        SMALLINT NOT NULL,             -- 1=PreKeySignalMessage, 2=SignalMessage
    delivered_at    TIMESTAMPTZ,
    read_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_messages_chat_time
    ON messages(chat_id, created_at DESC);
CREATE INDEX idx_messages_undelivered
    ON messages(recipient_id, created_at)
    WHERE delivered_at IS NULL;

-- ============================================================
-- Shifrlangan fayl/medianing metama'lumoti.
-- Faylning oʻzi diskda shifrlangan blob sifatida saqlanadi.
-- ============================================================
CREATE TABLE files (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    uploader_id     UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
    storage_key     TEXT NOT NULL,           -- Diskdagi fayl manzili
    size_bytes      BIGINT NOT NULL,
    sha256          BYTEA NOT NULL,          -- Yaxlitlik tekshiruvi uchun
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Audit jurnali — admin amallari va xavfsizlik hodisalari yoziladi.
-- ============================================================
CREATE TABLE audit_log (
    id              BIGSERIAL PRIMARY KEY,
    actor_id        UUID REFERENCES users(id) ON DELETE SET NULL,
    action          VARCHAR(64) NOT NULL,
    target_id       UUID,
    metadata        JSONB,
    ip_address      INET,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_log_action_time
    ON audit_log(action, created_at DESC);
```

## 1.2. Redis sxemasi

Redis quyidagi maqsadlar uchun ishlatiladi: sessiya, onlayn-status va ko'p-instans yetkazib berish.

```
# Sessiya tokenlari (TTL: kirish vaqti + 12 soat)
session:{jwt_jti}            -> {user_id, role, issued_at}

# Onlayn statuslar (TTL: 60 sekund — har zarbada yangilanadi)
presence:{user_id}           -> last_heartbeat_unix

# Onlayn foydalanuvchilar to'plami (tezkor so'rov uchun)
presence:online_set          -> SET<user_id>

# Ko'p-instans yetkazib berish (Pub/Sub)
deliver:user:{user_id}       -> Pub/Sub channel

# Kirish urinishlarini cheklash
ratelimit:login:{ip}         -> counter (TTL: 300s)

# Bir martalik kalitlar zaxirasi past darajaga tushganda ogohlantirish
otpk_low:{user_id}           -> 1 (TTL: 1 soat)
```

## 1.3. Loyihaning umumiy katalog tuzilishi

```
lokal-messenger/
├── server/                  # Go backend
│   ├── cmd/server/main.go
│   ├── internal/
│   │   ├── auth/            # JWT, parol hash
│   │   ├── api/             # REST handlerlar
│   │   ├── ws/              # WebSocket hub
│   │   ├── db/              # PostgreSQL repo'lari
│   │   ├── cache/           # Redis client
│   │   ├── models/
│   │   └── middleware/
│   ├── db/migrations/
│   ├── go.mod
│   └── config.yaml
├── client/                  # Tauri + React mijoz
│   ├── src-tauri/           # Rust backend (libsignal shu yerda)
│   │   ├── src/
│   │   │   ├── main.rs
│   │   │   ├── crypto.rs
│   │   │   └── store.rs
│   │   ├── Cargo.toml
│   │   └── tauri.conf.json
│   └── src/                 # React frontend
│       ├── components/
│       ├── pages/
│       ├── stores/
│       └── App.tsx
└── deploy/
    └── docker-compose.yml
```

---

# 2-Bosqich: Xavfsiz backend (Go)

## 2.1. Konfiguratsiya va `go.mod`

```go
// Fayl: server/go.mod
module github.com/military/lokal-messenger/server

go 1.22

require (
    github.com/gofiber/fiber/v2 v2.52.5     // Yengil HTTP freymvork (low-mem)
    github.com/gofiber/contrib/websocket v1.3.2
    github.com/golang-jwt/jwt/v5 v5.2.1
    github.com/jackc/pgx/v5 v5.6.0
    github.com/redis/go-redis/v9 v9.5.3
    golang.org/x/crypto v0.24.0              // argon2 uchun
    github.com/google/uuid v1.6.0
    gopkg.in/yaml.v3 v3.0.1
)
```

```yaml
# Fayl: server/config.yaml
# Server konfiguratsiyasi shu yerdan oʻqiladi.
server:
  bind_address: "0.0.0.0:8443"
  tls:
    enabled: true
    cert_file: "/etc/lokal-msg/server.crt"
    key_file:  "/etc/lokal-msg/server.key"

database:
  dsn: "postgres://msg:STRONG@127.0.0.1:5432/lokal_messenger?sslmode=disable"
  max_open_conns: 20
  max_idle_conns: 5

redis:
  addr: "127.0.0.1:6379"
  password: ""
  db: 0

auth:
  jwt_secret_file: "/etc/lokal-msg/jwt.key"   # 32 baytli tasodifiy fayl
  access_ttl_minutes: 720                     # 12 soat
  argon2:
    memory_kb: 65536
    iterations: 3
    parallelism: 2
    salt_length: 16
    key_length: 32

limits:
  max_message_size_bytes: 65536               # 64 KB shifrlangan
  max_file_size_bytes: 52428800               # 50 MB
  rate_login_per_5min: 5
```

## 2.2. Asosiy server (`main.go`)

```go
// Fayl: server/cmd/server/main.go
// Maqsad: Server jarayoni ishga tushiriladi, barcha qism-tizimlar ulanadi.
package main

import (
    "context"
    "log"
    "os"
    "os/signal"
    "syscall"
    "time"

    "github.com/gofiber/fiber/v2"
    "github.com/gofiber/fiber/v2/middleware/logger"
    "github.com/gofiber/fiber/v2/middleware/recover"
    "github.com/military/lokal-messenger/server/internal/api"
    "github.com/military/lokal-messenger/server/internal/auth"
    "github.com/military/lokal-messenger/server/internal/cache"
    "github.com/military/lokal-messenger/server/internal/config"
    "github.com/military/lokal-messenger/server/internal/db"
    "github.com/military/lokal-messenger/server/internal/ws"
)

func main() {
    // Konfiguratsiya fayldan oʻqiladi
    cfg, err := config.Load("config.yaml")
    if err != nil {
        log.Fatalf("Konfiguratsiyani oʻqib boʻlmadi: %v", err)
    }

    // Maʼlumotlar bazasi (PostgreSQL) ga ulanish hosil qilinadi
    pgPool, err := db.NewPool(context.Background(), cfg.Database)
    if err != nil {
        log.Fatalf("PostgreSQL ulanishi xato: %v", err)
    }
    defer pgPool.Close()

    // Redis kesh ulanishi tayyorlanadi
    redisClient, err := cache.NewClient(cfg.Redis)
    if err != nil {
        log.Fatalf("Redis ulanishi xato: %v", err)
    }
    defer redisClient.Close()

    // JWT manager — sessiya tokenlarini chiqarish va tekshirish uchun
    jwtMgr, err := auth.NewJWTManager(cfg.Auth)
    if err != nil {
        log.Fatalf("JWT kalit yuklanmadi: %v", err)
    }

    // WebSocket Hub — bogʻlangan mijozlar uchun markaziy yetkazuvchi
    hub := ws.NewHub(pgPool, redisClient)
    go hub.Run(context.Background())

    // Fiber HTTP/WS freymvorki sozlanadi (kam xotira sarfi rejimida)
    app := fiber.New(fiber.Config{
        AppName:               "LokalMessenger/1.0",
        DisableStartupMessage: true,
        ReadTimeout:           30 * time.Second,
        WriteTimeout:          30 * time.Second,
        BodyLimit:             int(cfg.Limits.MaxMessageSizeBytes),
        ErrorHandler:          api.ErrorHandler,
    })

    // Logger va panic-recovery middlewarelari ulanadi
    app.Use(recover.New())
    app.Use(logger.New(logger.Config{
        Format: "[${time}] ${status} ${method} ${path} (${ip}) ${latency}\n",
    }))

    // REST va WebSocket marshrutlari roʻyxatdan oʻtkaziladi
    api.RegisterRoutes(app, &api.Deps{
        DB:     pgPool,
        Cache:  redisClient,
        JWT:    jwtMgr,
        Hub:    hub,
        Config: cfg,
    })

    // Server ishga tushiriladi (TLS yoqilgan boʻlsa shifrlangan kanalda)
    go func() {
        if cfg.Server.TLS.Enabled {
            log.Printf("Server TLS bilan tinglanmoqda: %s", cfg.Server.BindAddress)
            if err := app.ListenTLS(cfg.Server.BindAddress,
                cfg.Server.TLS.CertFile, cfg.Server.TLS.KeyFile); err != nil {
                log.Fatalf("TLS server xatosi: %v", err)
            }
        } else {
            log.Printf("Server tinglanmoqda: %s", cfg.Server.BindAddress)
            if err := app.Listen(cfg.Server.BindAddress); err != nil {
                log.Fatalf("Server xatosi: %v", err)
            }
        }
    }()

    // Tizim signali kutiladi (Ctrl+C, SIGTERM)
    sigCh := make(chan os.Signal, 1)
    signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
    <-sigCh
    log.Println("Server toʻxtatish jarayoni boshlandi...")

    // Bogʻlangan mijozlar nazokat bilan uziladi
    shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
    defer cancel()
    _ = app.ShutdownWithContext(shutdownCtx)
    log.Println("Server toʻxtatildi.")
}
```

## 2.3. Parol xeshlash (Argon2id)

```go
// Fayl: server/internal/auth/password.go
// Maqsad: Foydalanuvchi parollari Argon2id algoritmi bilan xeshlanadi.
package auth

import (
    "crypto/rand"
    "crypto/subtle"
    "encoding/base64"
    "errors"
    "fmt"
    "strings"

    "golang.org/x/crypto/argon2"
)

// Argon2 parametrlari konfiguratsiyadan keladi
type Argon2Params struct {
    Memory      uint32
    Iterations  uint32
    Parallelism uint8
    SaltLength  uint32
    KeyLength   uint32
}

// Yangi parol xeshlanadi — natija "argon2id$..." formatda qaytariladi
func HashPassword(password string, p Argon2Params) (string, error) {
    salt := make([]byte, p.SaltLength)
    if _, err := rand.Read(salt); err != nil {
        return "", fmt.Errorf("tuz yaratilmadi: %w", err)
    }

    // Argon2id xeshi hisoblanadi
    hash := argon2.IDKey([]byte(password), salt,
        p.Iterations, p.Memory, p.Parallelism, p.KeyLength)

    // Standart formatda kodlanadi
    encoded := fmt.Sprintf("argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
        argon2.Version, p.Memory, p.Iterations, p.Parallelism,
        base64.RawStdEncoding.EncodeToString(salt),
        base64.RawStdEncoding.EncodeToString(hash))
    return encoded, nil
}

// Parol xesh bilan solishtiriladi (vaqt-konstantali taqqoslash)
func VerifyPassword(password, encoded string) (bool, error) {
    parts := strings.Split(encoded, "$")
    if len(parts) != 6 || parts[0] != "argon2id" {
        return false, errors.New("xesh formati notoʻgʻri")
    }

    var version int
    fmt.Sscanf(parts[1], "v=%d", &version)

    var memory, iterations uint32
    var parallelism uint8
    fmt.Sscanf(parts[2], "m=%d,t=%d,p=%d", &memory, &iterations, &parallelism)

    salt, err := base64.RawStdEncoding.DecodeString(parts[3])
    if err != nil {
        return false, err
    }
    expected, err := base64.RawStdEncoding.DecodeString(parts[4])
    if err != nil {
        return false, err
    }

    // Foydalanuvchi kiritgan parolning xeshi qayta hisoblanadi
    actual := argon2.IDKey([]byte(password), salt,
        iterations, memory, parallelism, uint32(len(expected)))

    // Vaqt-konstantali solishtirish bajariladi (timing attack'dan himoya)
    return subtle.ConstantTimeCompare(actual, expected) == 1, nil
}
```

## 2.4. JWT Manager

```go
// Fayl: server/internal/auth/jwt.go
// Maqsad: Sessiya tokenlari (JWT) chiqariladi va tekshiriladi.
package auth

import (
    "errors"
    "fmt"
    "os"
    "time"

    "github.com/golang-jwt/jwt/v5"
    "github.com/google/uuid"
)

type JWTManager struct {
    secret     []byte
    accessTTL  time.Duration
}

type Claims struct {
    UserID string `json:"sub"`
    Role   string `json:"role"`
    jwt.RegisteredClaims
}

// JWT manager kalit faylidan tayyorlanadi
func NewJWTManager(cfg AuthConfig) (*JWTManager, error) {
    secret, err := os.ReadFile(cfg.JWTSecretFile)
    if err != nil {
        return nil, fmt.Errorf("JWT kalit oʻqilmadi: %w", err)
    }
    if len(secret) < 32 {
        return nil, errors.New("JWT kalit kamida 32 bayt boʻlishi shart")
    }
    return &JWTManager{
        secret:    secret,
        accessTTL: time.Duration(cfg.AccessTTLMinutes) * time.Minute,
    }, nil
}

// Yangi token chiqariladi
func (m *JWTManager) Issue(userID, role string) (string, string, error) {
    jti := uuid.NewString()
    claims := Claims{
        UserID: userID,
        Role:   role,
        RegisteredClaims: jwt.RegisteredClaims{
            ID:        jti,
            ExpiresAt: jwt.NewNumericDate(time.Now().Add(m.accessTTL)),
            IssuedAt:  jwt.NewNumericDate(time.Now()),
            Issuer:    "lokal-messenger",
        },
    }
    token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
    signed, err := token.SignedString(m.secret)
    return signed, jti, err
}

// Token tekshiriladi va Claim qaytariladi
func (m *JWTManager) Verify(tokenStr string) (*Claims, error) {
    parsed, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(t *jwt.Token) (interface{}, error) {
        if t.Method.Alg() != jwt.SigningMethodHS256.Alg() {
            return nil, errors.New("kutilmagan imzolash usuli")
        }
        return m.secret, nil
    })
    if err != nil {
        return nil, err
    }
    claims, ok := parsed.Claims.(*Claims)
    if !ok || !parsed.Valid {
        return nil, errors.New("token notoʻgʻri")
    }
    return claims, nil
}
```

## 2.5. Autentifikatsiya middleware va RBAC

```go
// Fayl: server/internal/middleware/auth.go
// Maqsad: Har bir himoyalangan soʻrovga JWT tekshiruvi va rol tekshiruvi qoʻllaniladi.
package middleware

import (
    "strings"

    "github.com/gofiber/fiber/v2"
    "github.com/military/lokal-messenger/server/internal/auth"
    "github.com/redis/go-redis/v9"
)

// Authenticate middleware'i — tokenni headerdan oladi va Redis sessiyasini tekshiradi
func Authenticate(jwtMgr *auth.JWTManager, rdb *redis.Client) fiber.Handler {
    return func(c *fiber.Ctx) error {
        header := c.Get("Authorization")
        if !strings.HasPrefix(header, "Bearer ") {
            return fiber.NewError(fiber.StatusUnauthorized, "token koʻrsatilmagan")
        }
        tokenStr := strings.TrimPrefix(header, "Bearer ")

        claims, err := jwtMgr.Verify(tokenStr)
        if err != nil {
            return fiber.NewError(fiber.StatusUnauthorized, "token yaroqsiz")
        }

        // Sessiya bekor qilinmaganligi Redis'dan tekshiriladi
        exists, err := rdb.Exists(c.Context(), "session:"+claims.ID).Result()
        if err != nil || exists == 0 {
            return fiber.NewError(fiber.StatusUnauthorized, "sessiya tugagan")
        }

        // Konteksga foydalanuvchi maʼlumoti yoziladi
        c.Locals("user_id", claims.UserID)
        c.Locals("role", claims.Role)
        c.Locals("jti", claims.ID)
        return c.Next()
    }
}

// RequireRole middleware'i — faqat berilgan rolga ega foydalanuvchini oʻtkazadi
func RequireRole(allowed ...string) fiber.Handler {
    return func(c *fiber.Ctx) error {
        role, _ := c.Locals("role").(string)
        for _, r := range allowed {
            if r == role {
                return c.Next()
            }
        }
        return fiber.NewError(fiber.StatusForbidden, "ruxsat berilmagan")
    }
}
```

## 2.6. Login va admin REST API

```go
// Fayl: server/internal/api/auth_routes.go
// Maqsad: Login va parol oʻzgartirish marshrutlari xizmatga qoʻyiladi.
package api

import (
    "context"
    "errors"
    "fmt"
    "time"

    "github.com/gofiber/fiber/v2"
    "github.com/jackc/pgx/v5"
)

type loginRequest struct {
    Username string `json:"username"`
    Password string `json:"password"`
}

type loginResponse struct {
    Token              string `json:"token"`
    UserID             string `json:"user_id"`
    Role               string `json:"role"`
    MustChangePassword bool   `json:"must_change_password"`
}

// Login marshruti — foydalanuvchi tekshiriladi va token chiqariladi
func (h *Handlers) Login(c *fiber.Ctx) error {
    var req loginRequest
    if err := c.BodyParser(&req); err != nil {
        return fiber.NewError(fiber.StatusBadRequest, "soʻrov tanasi notoʻgʻri")
    }

    // Kirish urinishlari soni cheklanadi (brute-force'dan himoya)
    rateKey := fmt.Sprintf("ratelimit:login:%s", c.IP())
    count, _ := h.deps.Cache.Incr(c.Context(), rateKey).Result()
    if count == 1 {
        h.deps.Cache.Expire(c.Context(), rateKey, 5*time.Minute)
    }
    if count > int64(h.deps.Config.Limits.RateLoginPer5Min) {
        return fiber.NewError(fiber.StatusTooManyRequests, "juda koʻp urinish")
    }

    // Foydalanuvchi maʼlumoti DB'dan olinadi
    var (
        userID, hash, role string
        active             bool
        mustChange         bool
        lockedUntil        *time.Time
    )
    err := h.deps.DB.QueryRow(c.Context(), `
        SELECT id::text, password_hash, role, is_active, must_change_password, locked_until
          FROM users
         WHERE username = $1
    `, req.Username).Scan(&userID, &hash, &role, &active, &mustChange, &lockedUntil)

    if errors.Is(err, pgx.ErrNoRows) {
        return fiber.NewError(fiber.StatusUnauthorized, "login yoki parol notoʻgʻri")
    }
    if err != nil {
        return err
    }
    if !active {
        return fiber.NewError(fiber.StatusForbidden, "hisob bloklangan")
    }
    if lockedUntil != nil && lockedUntil.After(time.Now()) {
        return fiber.NewError(fiber.StatusForbidden, "hisob vaqtincha bloklangan")
    }

    // Parol Argon2id orqali tekshiriladi
    ok, _ := auth.VerifyPassword(req.Password, hash)
    if !ok {
        // Muvaffaqiyatsiz urinish hisoblanadi va kerak bolsa hisob qulflanadi
        _, _ = h.deps.DB.Exec(c.Context(), `
            UPDATE users
               SET failed_login_attempts = failed_login_attempts + 1,
                   locked_until = CASE WHEN failed_login_attempts + 1 >= 5
                                       THEN NOW() + INTERVAL '15 minutes'
                                       ELSE locked_until END
             WHERE id = $1::uuid`, userID)
        return fiber.NewError(fiber.StatusUnauthorized, "login yoki parol notoʻgʻri")
    }

    // Muvaffaqiyatli kirishda hisoblagich tozalanadi
    _, _ = h.deps.DB.Exec(c.Context(), `
        UPDATE users
           SET failed_login_attempts = 0,
               locked_until = NULL,
               last_seen_at = NOW()
         WHERE id = $1::uuid`, userID)

    // Token chiqariladi va sessiya Redis'ga yoziladi
    token, jti, err := h.deps.JWT.Issue(userID, role)
    if err != nil {
        return err
    }
    _ = h.deps.Cache.Set(c.Context(), "session:"+jti, userID,
        time.Duration(h.deps.Config.Auth.AccessTTLMinutes)*time.Minute).Err()

    // Audit jurnaliga yozuv qoʻshiladi
    _ = h.audit(c.Context(), userID, "login.success", nil, c.IP())

    return c.JSON(loginResponse{
        Token:              token,
        UserID:             userID,
        Role:               role,
        MustChangePassword: mustChange,
    })
}

// Audit yozuvi yordamchi funksiya
func (h *Handlers) audit(ctx context.Context, actorID, action string, target *string, ip string) error {
    _, err := h.deps.DB.Exec(ctx, `
        INSERT INTO audit_log (actor_id, action, target_id, ip_address)
        VALUES ($1::uuid, $2, NULLIF($3, '')::uuid, $4::inet)
    `, actorID, action, ifNil(target), ip)
    return err
}

func ifNil(p *string) string {
    if p == nil {
        return ""
    }
    return *p
}
```

```go
// Fayl: server/internal/api/admin_routes.go
// Maqsad: Faqat admin foydalanuvchilarga ochiq amallar — hisob yaratish va boshqarish.
package api

import (
    "crypto/rand"
    "encoding/base64"

    "github.com/gofiber/fiber/v2"
    "github.com/military/lokal-messenger/server/internal/auth"
)

type createUserRequest struct {
    Username    string `json:"username"`
    DisplayName string `json:"display_name"`
    Role        string `json:"role"`        // 'user' yoki 'admin'
    RankTitle   string `json:"rank_title"`
    UnitCode    string `json:"unit_code"`
}

type createUserResponse struct {
    UserID            string `json:"user_id"`
    TemporaryPassword string `json:"temporary_password"`
}

// Admin yangi foydalanuvchi hisobi yaratadi.
// Vaqtinchalik parol bir martalik chiqariladi va birinchi kirishda almashtiriladi.
func (h *Handlers) AdminCreateUser(c *fiber.Ctx) error {
    var req createUserRequest
    if err := c.BodyParser(&req); err != nil {
        return fiber.NewError(fiber.StatusBadRequest, "soʻrov tanasi notoʻgʻri")
    }
    if req.Role != "user" && req.Role != "admin" {
        return fiber.NewError(fiber.StatusBadRequest, "rol notoʻgʻri")
    }

    // 16 baytli kuchli vaqtinchalik parol generatsiya qilinadi
    raw := make([]byte, 16)
    _, _ = rand.Read(raw)
    tempPass := base64.RawURLEncoding.EncodeToString(raw)

    hash, err := auth.HashPassword(tempPass, h.deps.Config.Auth.Argon2)
    if err != nil {
        return err
    }

    var newID string
    err = h.deps.DB.QueryRow(c.Context(), `
        INSERT INTO users
            (username, password_hash, display_name, role, rank_title, unit_code, must_change_password)
        VALUES ($1, $2, $3, $4, NULLIF($5,''), NULLIF($6,''), TRUE)
        RETURNING id::text
    `, req.Username, hash, req.DisplayName, req.Role, req.RankTitle, req.UnitCode).Scan(&newID)
    if err != nil {
        return fiber.NewError(fiber.StatusConflict, "foydalanuvchi yaratilmadi: "+err.Error())
    }

    actorID, _ := c.Locals("user_id").(string)
    _ = h.audit(c.Context(), actorID, "admin.user.create", &newID, c.IP())

    return c.Status(fiber.StatusCreated).JSON(createUserResponse{
        UserID:            newID,
        TemporaryPassword: tempPass,
    })
}

// Admin foydalanuvchini bloklashi yoki faollashtirishi mumkin
func (h *Handlers) AdminSetActive(c *fiber.Ctx) error {
    targetID := c.Params("id")
    var body struct{ IsActive bool `json:"is_active"` }
    if err := c.BodyParser(&body); err != nil {
        return fiber.NewError(fiber.StatusBadRequest, "soʻrov notoʻgʻri")
    }
    _, err := h.deps.DB.Exec(c.Context(), `
        UPDATE users SET is_active = $1 WHERE id = $2::uuid
    `, body.IsActive, targetID)
    if err != nil {
        return err
    }
    actorID, _ := c.Locals("user_id").(string)
    _ = h.audit(c.Context(), actorID, "admin.user.set_active", &targetID, c.IP())
    return c.SendStatus(fiber.StatusNoContent)
}
```

## 2.7. Kalit-bundle marshrutlari (X3DH uchun)

```go
// Fayl: server/internal/api/keys_routes.go
// Maqsad: Mijoz oʻzining ochiq kalitlarini yuklaydi va boshqalarning bundle'ini soʻraydi.
package api

import (
    "encoding/base64"
    "github.com/gofiber/fiber/v2"
)

type uploadIdentityRequest struct {
    RegistrationID int    `json:"registration_id"`
    IdentityKeyB64 string `json:"identity_key"`
    SignedPreKey   struct {
        KeyID     int    `json:"key_id"`
        PublicKey string `json:"public_key"`
        Signature string `json:"signature"`
    } `json:"signed_prekey"`
    OneTimePreKeys []struct {
        KeyID     int    `json:"key_id"`
        PublicKey string `json:"public_key"`
    } `json:"one_time_prekeys"`
}

// Foydalanuvchi roʻyxatdan oʻtgach (admin yaratgach) oʻz ochiq kalitlarini yuklaydi
func (h *Handlers) UploadKeyBundle(c *fiber.Ctx) error {
    userID, _ := c.Locals("user_id").(string)

    var req uploadIdentityRequest
    if err := c.BodyParser(&req); err != nil {
        return fiber.NewError(fiber.StatusBadRequest, "soʻrov notoʻgʻri")
    }

    identityKey, err := base64.StdEncoding.DecodeString(req.IdentityKeyB64)
    if err != nil {
        return fiber.NewError(fiber.StatusBadRequest, "identity_key noaniq")
    }

    tx, err := h.deps.DB.Begin(c.Context())
    if err != nil {
        return err
    }
    defer tx.Rollback(c.Context())

    // Identity kalit upsert qilinadi
    _, err = tx.Exec(c.Context(), `
        INSERT INTO identity_keys (user_id, registration_id, identity_key)
        VALUES ($1::uuid, $2, $3)
        ON CONFLICT (user_id) DO UPDATE
            SET registration_id = EXCLUDED.registration_id,
                identity_key   = EXCLUDED.identity_key
    `, userID, req.RegistrationID, identityKey)
    if err != nil {
        return err
    }

    // Imzolangan oldindan-kalit yangilanadi
    spkPub, _ := base64.StdEncoding.DecodeString(req.SignedPreKey.PublicKey)
    spkSig, _ := base64.StdEncoding.DecodeString(req.SignedPreKey.Signature)
    _, err = tx.Exec(c.Context(), `
        INSERT INTO signed_prekeys (user_id, key_id, public_key, signature)
        VALUES ($1::uuid, $2, $3, $4)
        ON CONFLICT (user_id, key_id) DO UPDATE
            SET public_key = EXCLUDED.public_key,
                signature  = EXCLUDED.signature,
                created_at = NOW()
    `, userID, req.SignedPreKey.KeyID, spkPub, spkSig)
    if err != nil {
        return err
    }

    // Bir martalik oldindan-kalitlar partiya bilan kiritiladi
    for _, otpk := range req.OneTimePreKeys {
        pub, _ := base64.StdEncoding.DecodeString(otpk.PublicKey)
        _, err = tx.Exec(c.Context(), `
            INSERT INTO one_time_prekeys (user_id, key_id, public_key)
            VALUES ($1::uuid, $2, $3)
            ON CONFLICT (user_id, key_id) DO NOTHING
        `, userID, otpk.KeyID, pub)
        if err != nil {
            return err
        }
    }

    if err := tx.Commit(c.Context()); err != nil {
        return err
    }
    return c.SendStatus(fiber.StatusNoContent)
}

// Sherikning kalit-bundle'i olinadi.
// Bir martalik kalitlardan eng kichik raqamlisi tanlab, used=TRUE qoʻyiladi.
func (h *Handlers) FetchKeyBundle(c *fiber.Ctx) error {
    targetID := c.Params("id")

    type bundle struct {
        UserID        string `json:"user_id"`
        RegistrationID int    `json:"registration_id"`
        IdentityKey   string `json:"identity_key"`
        SignedPreKey  struct {
            KeyID     int    `json:"key_id"`
            PublicKey string `json:"public_key"`
            Signature string `json:"signature"`
        } `json:"signed_prekey"`
        OneTimePreKey *struct {
            KeyID     int    `json:"key_id"`
            PublicKey string `json:"public_key"`
        } `json:"one_time_prekey,omitempty"`
    }
    var b bundle
    b.UserID = targetID

    var ikRaw, spkRaw, sigRaw []byte
    var spkID int
    err := h.deps.DB.QueryRow(c.Context(), `
        SELECT ik.registration_id, ik.identity_key,
               spk.key_id, spk.public_key, spk.signature
          FROM identity_keys ik
          JOIN LATERAL (
              SELECT key_id, public_key, signature
                FROM signed_prekeys
               WHERE user_id = ik.user_id
               ORDER BY created_at DESC
               LIMIT 1
          ) spk ON TRUE
         WHERE ik.user_id = $1::uuid
    `, targetID).Scan(&b.RegistrationID, &ikRaw, &spkID, &spkRaw, &sigRaw)
    if err != nil {
        return fiber.NewError(fiber.StatusNotFound, "foydalanuvchi kalitlari topilmadi")
    }
    b.IdentityKey = base64.StdEncoding.EncodeToString(ikRaw)
    b.SignedPreKey.KeyID = spkID
    b.SignedPreKey.PublicKey = base64.StdEncoding.EncodeToString(spkRaw)
    b.SignedPreKey.Signature = base64.StdEncoding.EncodeToString(sigRaw)

    // Bir martalik kalit atom tarzda olinadi va used=TRUE qoʻyiladi
    var otpkID int
    var otpkPub []byte
    err = h.deps.DB.QueryRow(c.Context(), `
        UPDATE one_time_prekeys
           SET used = TRUE
         WHERE id = (
            SELECT id FROM one_time_prekeys
             WHERE user_id = $1::uuid AND used = FALSE
             ORDER BY id ASC
             LIMIT 1
             FOR UPDATE SKIP LOCKED
         )
        RETURNING key_id, public_key
    `, targetID).Scan(&otpkID, &otpkPub)
    if err == nil {
        b.OneTimePreKey = &struct {
            KeyID     int    `json:"key_id"`
            PublicKey string `json:"public_key"`
        }{KeyID: otpkID, PublicKey: base64.StdEncoding.EncodeToString(otpkPub)}
    }
    return c.JSON(b)
}
```

## 2.8. WebSocket Hub (xabar marshrutlash)

```go
// Fayl: server/internal/ws/hub.go
// Maqsad: Bogʻlangan mijozlar ro'yxati saqlanadi va shifrlangan xabarlar
//         tegishli adresatga uzatiladi.
package ws

import (
    "context"
    "encoding/json"
    "log"
    "sync"
    "time"

    "github.com/jackc/pgx/v5/pgxpool"
    "github.com/redis/go-redis/v9"
)

// Mijoz aloqasi
type Client struct {
    UserID string
    Send   chan []byte           // Yuboriladigan paket navbati
    closed bool
}

// Hub — markaziy yetkazib beruvchi
type Hub struct {
    db        *pgxpool.Pool
    rdb       *redis.Client
    mu        sync.RWMutex
    clients   map[string]*Client    // userID -> Client
    register  chan *Client
    unreg     chan *Client
    inbound   chan inboundEnvelope
}

// Mijozdan kelayotgan paket konvert formati
type inboundEnvelope struct {
    From    string          `json:"-"`
    Type    string          `json:"type"`        // "msg.send", "msg.delivered", "ping"
    Payload json.RawMessage `json:"payload"`
}

func NewHub(db *pgxpool.Pool, rdb *redis.Client) *Hub {
    return &Hub{
        db:       db,
        rdb:      rdb,
        clients:  make(map[string]*Client),
        register: make(chan *Client, 64),
        unreg:    make(chan *Client, 64),
        inbound:  make(chan inboundEnvelope, 1024),
    }
}

// Hub asosiy halqasi
func (h *Hub) Run(ctx context.Context) {
    presenceTick := time.NewTicker(30 * time.Second)
    defer presenceTick.Stop()

    for {
        select {
        case <-ctx.Done():
            return
        case c := <-h.register:
            h.mu.Lock()
            h.clients[c.UserID] = c
            h.mu.Unlock()
            _ = h.rdb.SAdd(ctx, "presence:online_set", c.UserID).Err()
            _ = h.rdb.Set(ctx, "presence:"+c.UserID, time.Now().Unix(), 90*time.Second).Err()
            log.Printf("Mijoz ulandi: %s", c.UserID)
            // Ushbu foydalanuvchining yetkazilmagan xabarlari uzatiladi
            go h.flushPending(ctx, c)

        case c := <-h.unreg:
            h.mu.Lock()
            if cur, ok := h.clients[c.UserID]; ok && cur == c {
                delete(h.clients, c.UserID)
                close(c.Send)
                c.closed = true
            }
            h.mu.Unlock()
            _ = h.rdb.SRem(ctx, "presence:online_set", c.UserID).Err()
            _ = h.rdb.Del(ctx, "presence:"+c.UserID).Err()
            log.Printf("Mijoz uzildi: %s", c.UserID)

        case env := <-h.inbound:
            h.handleInbound(ctx, env)

        case <-presenceTick.C:
            // Onlayn vaqtlama yangilanadi
            h.mu.RLock()
            for uid := range h.clients {
                _ = h.rdb.Set(ctx, "presence:"+uid, time.Now().Unix(), 90*time.Second).Err()
            }
            h.mu.RUnlock()
        }
    }
}

// Kiruvchi paketni turi boʻyicha qayta ishlanadi
func (h *Hub) handleInbound(ctx context.Context, env inboundEnvelope) {
    switch env.Type {
    case "msg.send":
        h.routeMessage(ctx, env)
    case "msg.delivered":
        h.markDelivered(ctx, env)
    case "msg.read":
        h.markRead(ctx, env)
    }
}

// "msg.send" — shifrlangan xabar bazaga yoziladi va onlayn boʻlsa darrov uzatiladi
type sendPayload struct {
    ChatID         string `json:"chat_id"`
    RecipientID    string `json:"recipient_id"`
    CiphertextB64  string `json:"ciphertext"`
    MsgType        int    `json:"msg_type"`        // 1 yoki 2
    ClientMsgID    string `json:"client_msg_id"`   // mijoz tomonida yaratilgan id
}

func (h *Hub) routeMessage(ctx context.Context, env inboundEnvelope) {
    var p sendPayload
    if err := json.Unmarshal(env.Payload, &p); err != nil {
        return
    }

    // Server ciphertextni hech qachon ochmaydi — faqat bayt sifatida saqlaydi
    var msgID string
    err := h.db.QueryRow(ctx, `
        INSERT INTO messages (chat_id, sender_id, recipient_id, ciphertext, msg_type)
        VALUES ($1::uuid, $2::uuid, $3::uuid, decode($4, 'base64'), $5)
        RETURNING id::text
    `, p.ChatID, env.From, p.RecipientID, p.CiphertextB64, p.MsgType).Scan(&msgID)
    if err != nil {
        log.Printf("xabar saqlanmadi: %v", err)
        return
    }

    // Yuboruvchiga tasdiq qaytariladi
    h.sendTo(env.From, "msg.ack", map[string]any{
        "client_msg_id": p.ClientMsgID,
        "server_msg_id": msgID,
    })

    // Adresat onlayn boʻlsa darrov uzatiladi
    delivered := h.sendTo(p.RecipientID, "msg.recv", map[string]any{
        "msg_id":     msgID,
        "chat_id":    p.ChatID,
        "sender_id":  env.From,
        "ciphertext": p.CiphertextB64,
        "msg_type":   p.MsgType,
    })
    if delivered {
        _, _ = h.db.Exec(ctx, `UPDATE messages SET delivered_at = NOW() WHERE id = $1::uuid`, msgID)
    }
}

// Ulanmagan vaqtdagi xabarlar mijoz bogʻlanganda uzatiladi
func (h *Hub) flushPending(ctx context.Context, c *Client) {
    rows, err := h.db.Query(ctx, `
        SELECT id::text, chat_id::text, sender_id::text,
               encode(ciphertext, 'base64'), msg_type
          FROM messages
         WHERE recipient_id = $1::uuid AND delivered_at IS NULL
         ORDER BY created_at ASC
         LIMIT 500
    `, c.UserID)
    if err != nil {
        return
    }
    defer rows.Close()

    for rows.Next() {
        var msgID, chatID, senderID, ct string
        var mtype int
        if err := rows.Scan(&msgID, &chatID, &senderID, &ct, &mtype); err != nil {
            continue
        }
        if h.sendTo(c.UserID, "msg.recv", map[string]any{
            "msg_id":     msgID,
            "chat_id":    chatID,
            "sender_id":  senderID,
            "ciphertext": ct,
            "msg_type":   mtype,
        }) {
            _, _ = h.db.Exec(ctx,
                `UPDATE messages SET delivered_at = NOW() WHERE id = $1::uuid`, msgID)
        }
    }
}

// Ma'lum foydalanuvchiga paket yuborish urinib koʻriladi
func (h *Hub) sendTo(userID, eventType string, payload any) bool {
    h.mu.RLock()
    c, ok := h.clients[userID]
    h.mu.RUnlock()
    if !ok || c.closed {
        return false
    }
    raw, _ := json.Marshal(map[string]any{"type": eventType, "payload": payload})
    select {
    case c.Send <- raw:
        return true
    default:
        // Bufer toʻlgan boʻlsa mijoz uziladi
        h.unreg <- c
        return false
    }
}

// Yetkazib berildi belgisi
func (h *Hub) markDelivered(ctx context.Context, env inboundEnvelope) {
    var p struct{ MsgID string `json:"msg_id"` }
    if err := json.Unmarshal(env.Payload, &p); err != nil {
        return
    }
    _, _ = h.db.Exec(ctx,
        `UPDATE messages SET delivered_at = COALESCE(delivered_at, NOW())
            WHERE id = $1::uuid AND recipient_id = $2::uuid`, p.MsgID, env.From)
}

// Oʻqilgan belgisi
func (h *Hub) markRead(ctx context.Context, env inboundEnvelope) {
    var p struct{ MsgID string `json:"msg_id"` }
    if err := json.Unmarshal(env.Payload, &p); err != nil {
        return
    }
    _, _ = h.db.Exec(ctx,
        `UPDATE messages SET read_at = NOW()
            WHERE id = $1::uuid AND recipient_id = $2::uuid`, p.MsgID, env.From)
}

// Tashqi koddan paket yuborish
func (h *Hub) Inbound() chan<- inboundEnvelope { return h.inbound }
func (h *Hub) Register() chan<- *Client       { return h.register }
func (h *Hub) Unregister() chan<- *Client     { return h.unreg }
```

```go
// Fayl: server/internal/ws/handler.go
// Maqsad: HTTP soʻrovini WebSocket aloqasiga koʻtarish va paketlarni Hub'ga uzatish.
package ws

import (
    "encoding/json"
    "time"

    fws "github.com/gofiber/contrib/websocket"
)

// WebSocket'ga ulangan har bir mijoz uchun ishlovchi gorutin
func ServeWS(hub *Hub) func(c *fws.Conn) {
    return func(c *fws.Conn) {
        userID, _ := c.Locals("user_id").(string)

        client := &Client{
            UserID: userID,
            Send:   make(chan []byte, 64),
        }
        hub.Register() <- client
        defer func() { hub.Unregister() <- client }()

        // Yozish gorutini — Send kanalidagi paketlar mijozga uzatiladi
        go func() {
            ticker := time.NewTicker(30 * time.Second)
            defer ticker.Stop()
            for {
                select {
                case msg, ok := <-client.Send:
                    if !ok {
                        _ = c.WriteMessage(fws.CloseMessage, []byte{})
                        return
                    }
                    _ = c.SetWriteDeadline(time.Now().Add(10 * time.Second))
                    if err := c.WriteMessage(fws.TextMessage, msg); err != nil {
                        return
                    }
                case <-ticker.C:
                    _ = c.SetWriteDeadline(time.Now().Add(10 * time.Second))
                    if err := c.WriteMessage(fws.PingMessage, nil); err != nil {
                        return
                    }
                }
            }
        }()

        // Oʻqish halqasi — kiruvchi paketlar Hub'ga yuboriladi
        c.SetReadLimit(128 * 1024)
        c.SetReadDeadline(time.Now().Add(60 * time.Second))
        c.SetPongHandler(func(string) error {
            c.SetReadDeadline(time.Now().Add(60 * time.Second))
            return nil
        })

        for {
            _, raw, err := c.ReadMessage()
            if err != nil {
                return
            }
            var env inboundEnvelope
            if err := json.Unmarshal(raw, &env); err != nil {
                continue
            }
            env.From = userID
            hub.Inbound() <- env
        }
    }
}
```

## 2.9. Marshrutlar roʻyxatga olinadi

```go
// Fayl: server/internal/api/router.go
// Maqsad: Barcha REST va WS marshrutlari yagona joyda roʻyxatdan oʻtkaziladi.
package api

import (
    "github.com/gofiber/fiber/v2"
    fws "github.com/gofiber/contrib/websocket"
    "github.com/military/lokal-messenger/server/internal/middleware"
    "github.com/military/lokal-messenger/server/internal/ws"
)

func RegisterRoutes(app *fiber.App, deps *Deps) {
    h := &Handlers{deps: deps}

    // Sogʻliq tekshiruvi
    app.Get("/healthz", func(c *fiber.Ctx) error { return c.SendString("ok") })

    // Ochiq marshrutlar (autentifikatsiyasiz)
    app.Post("/api/v1/auth/login", h.Login)

    // Autentifikatsiya talab qilinadigan marshrutlar
    authMW := middleware.Authenticate(deps.JWT, deps.Cache)
    api := app.Group("/api/v1", authMW)

    // Foydalanuvchining oʻzi
    api.Post("/auth/change-password", h.ChangePassword)
    api.Post("/auth/logout", h.Logout)
    api.Get("/me", h.Me)

    // Kalit-bundle
    api.Post("/keys/upload", h.UploadKeyBundle)
    api.Get("/keys/:id/bundle", h.FetchKeyBundle)
    api.Post("/keys/refill-otpks", h.RefillOneTimePreKeys)

    // Suhbatlar va xabarlar tarixi (shifrlangan)
    api.Get("/chats", h.ListChats)
    api.Post("/chats", h.CreateChat)
    api.Get("/chats/:id/messages", h.ChatHistory)

    // Foydalanuvchilar katalogi (kim bilan yozish mumkin)
    api.Get("/users", h.ListUsers)

    // Faqat admin uchun marshrutlar
    admin := api.Group("/admin", middleware.RequireRole("admin"))
    admin.Post("/users", h.AdminCreateUser)
    admin.Patch("/users/:id/active", h.AdminSetActive)
    admin.Get("/audit-log", h.AdminAuditLog)

    // WebSocket marshruti
    app.Use("/ws", authMW, fws.New(fws.Config{
        ReadBufferSize:  4096,
        WriteBufferSize: 4096,
    }, func(c *fiber.Ctx) error {
        if fws.IsWebSocketUpgrade(c) {
            c.Locals("allowed", true)
            return c.Next()
        }
        return fiber.ErrUpgradeRequired
    }))
    app.Get("/ws", fws.New(ws.ServeWS(deps.Hub)))
}
```

---

# 3-Bosqich: Kriptografiya (Signal Protocol E2EE)

**Tamoyil:** mijoz tomonida `libsignal` Rust kreyti ishlatiladi (Tauri ichida). Server faqat shifrlangan baytlarni marshrutlaydi.

## 3.1. Mijozdagi Rust kreyti

```toml
# Fayl: client/src-tauri/Cargo.toml (qisman koʻrinish)
[package]
name = "lokal-messenger-client"
version = "1.0.0"
edition = "2021"

[build-dependencies]
tauri-build = { version = "2.0", features = [] }

[dependencies]
tauri = { version = "2.0", features = [] }
tokio = { version = "1.38", features = ["full"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
# Signal Protocol implementatsiyasi
libsignal-protocol = { git = "https://github.com/signalapp/libsignal", tag = "v0.50.0" }
# Mahalliy SQLite saqlovi (ratchet holat)
rusqlite = { version = "0.31", features = ["bundled"] }
# Tarmoq
reqwest = { version = "0.12", features = ["json", "rustls-tls"], default-features = false }
tokio-tungstenite = { version = "0.23", features = ["rustls-tls-webpki-roots"] }
rand = "0.8"
base64 = "0.22"
sha2 = "0.10"
zeroize = "1.7"
keyring = "2"  # OT tomonidagi xavfsiz saqlash
```

## 3.2. Identifikator va kalit-bundle yaratish

```rust
// Fayl: client/src-tauri/src/crypto.rs
// Maqsad: Signal kalitlari mahalliy yaratiladi va saqlanadi.
//         Server bu yerda hech qanday rol oʻynamaydi.

use libsignal_protocol::{
    IdentityKeyPair, KeyPair, PrivateKey, PublicKey, SignedPreKeyRecord,
    PreKeyRecord, ProtocolAddress, SessionRecord, IdentityKeyStore, PreKeyStore,
    SignedPreKeyStore, SessionStore, error::SignalProtocolError, process_prekey_bundle,
    message_encrypt, message_decrypt, PreKeyBundle, CiphertextMessage,
    PreKeySignalMessage, SignalMessage, Direction,
};
use rand::rngs::OsRng;
use serde::{Serialize, Deserialize};
use base64::{Engine, engine::general_purpose::STANDARD as B64};

pub const NUM_ONE_TIME_PREKEYS: u32 = 100;

/// Identifikator paketi — mijoz birinchi marta ishga tushganda yaratiladi
#[derive(Debug, Serialize, Deserialize)]
pub struct GeneratedBundle {
    pub registration_id: u32,
    pub identity_key:    String,                 // base64
    pub identity_priv:   String,                 // shaxsiy — faqat mahalliy diskka
    pub signed_prekey:   GeneratedSignedPreKey,
    pub one_time_prekeys: Vec<GeneratedPreKey>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GeneratedSignedPreKey {
    pub key_id:     u32,
    pub public_key: String,
    pub private_key: String,
    pub signature:  String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GeneratedPreKey {
    pub key_id:      u32,
    pub public_key:  String,
    pub private_key: String,
}

/// Mahalliy holatdan toʻliq kalit-bundle yaratiladi
pub fn generate_full_bundle() -> Result<GeneratedBundle, SignalProtocolError> {
    let mut rng = OsRng;

    // Identifikator (Curve25519) juftligi yaratiladi
    let identity_kp = IdentityKeyPair::generate(&mut rng);

    // Imzolangan oldindan-kalit yaratiladi va identity bilan imzolanadi
    let signed_pre_kp = KeyPair::generate(&mut rng);
    let signature = identity_kp
        .private_key()
        .calculate_signature(&signed_pre_kp.public_key.serialize(), &mut rng)?;
    let signed_prekey_id = 1;

    // Bir martalik kalitlar yaratiladi
    let mut otpks = Vec::with_capacity(NUM_ONE_TIME_PREKEYS as usize);
    for i in 0..NUM_ONE_TIME_PREKEYS {
        let kp = KeyPair::generate(&mut rng);
        otpks.push(GeneratedPreKey {
            key_id:      i + 1,
            public_key:  B64.encode(kp.public_key.serialize()),
            private_key: B64.encode(kp.private_key.serialize()),
        });
    }

    // Tasodifiy registration ID — har qurilmaga unikal
    let registration_id: u32 = (rand::random::<u32>() & 0x3fff) + 1;

    Ok(GeneratedBundle {
        registration_id,
        identity_key:  B64.encode(identity_kp.public_key().serialize()),
        identity_priv: B64.encode(identity_kp.private_key().serialize()),
        signed_prekey: GeneratedSignedPreKey {
            key_id:      signed_prekey_id,
            public_key:  B64.encode(signed_pre_kp.public_key.serialize()),
            private_key: B64.encode(signed_pre_kp.private_key.serialize()),
            signature:   B64.encode(&signature),
        },
        one_time_prekeys: otpks,
    })
}
```

## 3.3. Saqlash qatlami (SQLite + keyring)

```rust
// Fayl: client/src-tauri/src/store.rs
// Maqsad: Identity, prekey va session yozuvlari mahalliy SQLite faylida
//         shifrlangan holda saqlanadi. Database-kalit OT keyring'idan olinadi.
use rusqlite::{Connection, params};
use std::path::PathBuf;
use libsignal_protocol::*;
use async_trait::async_trait;

pub struct LocalSignalStore {
    conn: Connection,
    own_identity: IdentityKeyPair,
    registration_id: u32,
}

impl LocalSignalStore {
    /// Saqlov ochiladi (yoki yaratiladi)
    pub fn open(path: PathBuf, identity: IdentityKeyPair, registration_id: u32) -> rusqlite::Result<Self> {
        let conn = Connection::open(&path)?;
        // Jadvallar yaratiladi
        conn.execute_batch(r#"
            CREATE TABLE IF NOT EXISTS prekeys (
                id INTEGER PRIMARY KEY,
                record BLOB NOT NULL
            );
            CREATE TABLE IF NOT EXISTS signed_prekeys (
                id INTEGER PRIMARY KEY,
                record BLOB NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
                address TEXT PRIMARY KEY,
                record BLOB NOT NULL
            );
            CREATE TABLE IF NOT EXISTS identities (
                address TEXT PRIMARY KEY,
                key BLOB NOT NULL
            );
        "#)?;
        Ok(Self { conn, own_identity: identity, registration_id })
    }
}

// Quyidagi qatlamlar libsignal-protocol traitlari uchun implementatsiya qilinadi.
// Qisqalik uchun qisman koʻrsatilgan.

#[async_trait(?Send)]
impl IdentityKeyStore for LocalSignalStore {
    async fn get_identity_key_pair(&self) -> Result<IdentityKeyPair, SignalProtocolError> {
        Ok(self.own_identity.clone())
    }

    async fn get_local_registration_id(&self) -> Result<u32, SignalProtocolError> {
        Ok(self.registration_id)
    }

    async fn save_identity(
        &mut self,
        address: &ProtocolAddress,
        identity: &IdentityKey,
    ) -> Result<bool, SignalProtocolError> {
        // Yangi identifikator saqlanadi; oldingisidan farqi tahlil qilinadi.
        let key_bytes = identity.serialize();
        let addr_str = format!("{}.{}", address.name(), address.device_id());
        // Hozirgi yozuv olinadi
        let prev: Option<Vec<u8>> = self.conn.query_row(
            "SELECT key FROM identities WHERE address = ?1",
            params![addr_str], |r| r.get(0)).ok();
        // Upsert bajariladi
        self.conn.execute(
            "INSERT INTO identities(address, key) VALUES(?1, ?2)
             ON CONFLICT(address) DO UPDATE SET key = excluded.key",
            params![addr_str, key_bytes.as_ref() as &[u8]],
        ).map_err(|e| SignalProtocolError::ApplicationCallbackError("save_identity", Box::new(e)))?;
        Ok(prev.map(|p| p != key_bytes.to_vec()).unwrap_or(false))
    }

    async fn is_trusted_identity(
        &self, _address: &ProtocolAddress, _identity: &IdentityKey, _direction: Direction,
    ) -> Result<bool, SignalProtocolError> {
        // TOFU sxemasi: birinchi koʻrilgan kalit ishonchli sanaladi.
        // Foydalanuvchi keyin "Xavfsizlik kodi" orqali qayta tasdiqlaydi.
        Ok(true)
    }

    async fn get_identity(
        &self, address: &ProtocolAddress,
    ) -> Result<Option<IdentityKey>, SignalProtocolError> {
        let addr_str = format!("{}.{}", address.name(), address.device_id());
        let row: Option<Vec<u8>> = self.conn.query_row(
            "SELECT key FROM identities WHERE address = ?1",
            params![addr_str], |r| r.get(0)).ok();
        match row {
            Some(b) => Ok(Some(IdentityKey::decode(&b)?)),
            None => Ok(None),
        }
    }
}

// PreKeyStore, SignedPreKeyStore, SessionStore implementatsiyalari shu sxemada davom etadi:
// - prekeys jadvalidan id boʻyicha BLOB oʻqib PreKeyRecord::deserialize qaytariladi.
// - sessions jadvalida har "user.deviceId" boʻyicha SessionRecord saqlanadi.
```

## 3.4. Sessiya oʻrnatish (X3DH) va xabar shifrlash

```rust
// Fayl: client/src-tauri/src/session.rs
// Maqsad: Yangi sherikga birinchi xabar yuborishdan oldin X3DH sessiyasi quriladi.
use libsignal_protocol::*;
use base64::{Engine, engine::general_purpose::STANDARD as B64};

pub struct PeerBundle {
    pub user_id:       String,
    pub device_id:     u32,
    pub registration_id: u32,
    pub identity_key:  IdentityKey,
    pub signed_prekey_id: u32,
    pub signed_prekey: PublicKey,
    pub signed_prekey_sig: Vec<u8>,
    pub onetime_prekey_id: Option<u32>,
    pub onetime_prekey: Option<PublicKey>,
}

/// Server'dan kelgan JSON bundle dekod qilinadi
pub fn decode_bundle(raw: &serde_json::Value) -> Result<PeerBundle, SignalProtocolError> {
    let user_id = raw["user_id"].as_str().unwrap_or("").to_string();
    let registration_id = raw["registration_id"].as_u64().unwrap_or(0) as u32;
    let ik = IdentityKey::decode(
        &B64.decode(raw["identity_key"].as_str().unwrap_or("")).unwrap_or_default()
    )?;
    let spk_id = raw["signed_prekey"]["key_id"].as_u64().unwrap_or(0) as u32;
    let spk = PublicKey::deserialize(
        &B64.decode(raw["signed_prekey"]["public_key"].as_str().unwrap_or("")).unwrap_or_default()
    )?;
    let spk_sig = B64.decode(raw["signed_prekey"]["signature"].as_str().unwrap_or("")).unwrap_or_default();

    let mut otpk_id = None;
    let mut otpk = None;
    if let Some(otp) = raw.get("one_time_prekey") {
        if !otp.is_null() {
            otpk_id = otp["key_id"].as_u64().map(|v| v as u32);
            if let Some(s) = otp["public_key"].as_str() {
                otpk = Some(PublicKey::deserialize(&B64.decode(s).unwrap_or_default())?);
            }
        }
    }

    Ok(PeerBundle {
        user_id,
        device_id: 1,
        registration_id,
        identity_key: ik,
        signed_prekey_id: spk_id,
        signed_prekey: spk,
        signed_prekey_sig: spk_sig,
        onetime_prekey_id: otpk_id,
        onetime_prekey: otpk,
    })
}

/// Sherikning bundle'i asosida sessiya quriladi (X3DH)
pub async fn establish_session(
    store: &mut crate::store::LocalSignalStore,
    bundle: PeerBundle,
) -> Result<(), SignalProtocolError> {
    let address = ProtocolAddress::new(bundle.user_id.clone(), bundle.device_id.into());
    let pre_key_bundle = PreKeyBundle::new(
        bundle.registration_id,
        bundle.device_id.into(),
        bundle.onetime_prekey_id.map(|id| (id.into(), bundle.onetime_prekey.unwrap())),
        bundle.signed_prekey_id.into(),
        bundle.signed_prekey,
        bundle.signed_prekey_sig,
        bundle.identity_key.clone(),
    )?;

    let mut rng = rand::rngs::OsRng;
    process_prekey_bundle(
        &address, store, store, store, store,
        &pre_key_bundle, std::time::SystemTime::now(), &mut rng,
    ).await
}

/// Plaintextni shifrlanadi va serverga yuborish uchun bayt qaytariladi
pub async fn encrypt_for(
    store: &mut crate::store::LocalSignalStore,
    peer_user_id: &str,
    device_id: u32,
    plaintext: &[u8],
) -> Result<(Vec<u8>, u8), SignalProtocolError> {
    let addr = ProtocolAddress::new(peer_user_id.to_string(), device_id.into());
    let now = std::time::SystemTime::now();
    let ct = message_encrypt(plaintext, &addr, store, store, now).await?;
    let (bytes, mtype) = match ct {
        CiphertextMessage::PreKeySignalMessage(m) => (m.serialized().to_vec(), 1u8),
        CiphertextMessage::SignalMessage(m)       => (m.serialized().to_vec(), 2u8),
        _ => return Err(SignalProtocolError::InvalidArgument("kutilmagan tur".into())),
    };
    Ok((bytes, mtype))
}

/// Server'dan kelgan ciphertext shifrlanmaydi
pub async fn decrypt_from(
    store: &mut crate::store::LocalSignalStore,
    peer_user_id: &str,
    device_id: u32,
    msg_type: u8,
    ciphertext: &[u8],
) -> Result<Vec<u8>, SignalProtocolError> {
    let addr = ProtocolAddress::new(peer_user_id.to_string(), device_id.into());
    let mut rng = rand::rngs::OsRng;
    let plaintext = match msg_type {
        1 => {
            let m = PreKeySignalMessage::try_from(ciphertext)?;
            message_decrypt(
                &CiphertextMessage::PreKeySignalMessage(m),
                &addr, store, store, store, store, store,
                &mut rng,
            ).await?
        }
        2 => {
            let m = SignalMessage::try_from(ciphertext)?;
            message_decrypt(
                &CiphertextMessage::SignalMessage(m),
                &addr, store, store, store, store, store,
                &mut rng,
            ).await?
        }
        _ => return Err(SignalProtocolError::InvalidArgument("notoʻgʻri tur".into())),
    };
    Ok(plaintext)
}
```

## 3.5. Tauri command'lari (Rust ↔ React koʻprigi)

```rust
// Fayl: client/src-tauri/src/main.rs
// Maqsad: Frontend (React) chaqirishi uchun ochiq command'lar roʻyxatga olinadi.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod crypto;
mod store;
mod session;
mod net;

use tauri::{Manager, State};
use std::sync::Mutex;

// Mijozning umumiy holati
struct AppState {
    store: Mutex<Option<store::LocalSignalStore>>,
    api:   Mutex<net::ApiClient>,
}

#[tauri::command]
async fn login(state: State<'_, AppState>, username: String, password: String)
    -> Result<serde_json::Value, String>
{
    let mut api = state.api.lock().unwrap().clone();
    api.login(&username, &password).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn bootstrap_keys(state: State<'_, AppState>) -> Result<(), String> {
    // Birinchi kirishda kalit-bundle yaratiladi va serverga yuklanadi
    let bundle = crypto::generate_full_bundle().map_err(|e| e.to_string())?;
    let api = state.api.lock().unwrap().clone();
    api.upload_bundle(&bundle).await.map_err(|e| e.to_string())?;
    // Lokal saqlovga ham yoziladi
    Ok(())
}

#[tauri::command]
async fn send_message(
    state: State<'_, AppState>,
    chat_id: String,
    recipient_id: String,
    plaintext: String,
) -> Result<String, String> {
    let mut store_guard = state.store.lock().unwrap();
    let store_ref = store_guard.as_mut().ok_or("Saqlov yopiq")?;

    // Sessiya hali yoʻq boʻlsa, sherikning bundle'i olinib oʻrnatiladi
    let api = state.api.lock().unwrap().clone();
    if !net::has_session(store_ref, &recipient_id) {
        let raw = api.fetch_bundle(&recipient_id).await.map_err(|e| e.to_string())?;
        let bundle = session::decode_bundle(&raw).map_err(|e| e.to_string())?;
        session::establish_session(store_ref, bundle).await.map_err(|e| e.to_string())?;
    }

    // Xabar shifrlanadi
    let (ct, mtype) = session::encrypt_for(store_ref, &recipient_id, 1, plaintext.as_bytes())
        .await.map_err(|e| e.to_string())?;

    // Shifrlangan baytlar WebSocket orqali yuboriladi
    api.ws_send(&chat_id, &recipient_id, &ct, mtype).await.map_err(|e| e.to_string())?;
    Ok("ok".into())
}

#[tauri::command]
async fn decrypt_incoming(
    state: State<'_, AppState>,
    sender_id: String,
    msg_type: u8,
    ciphertext_b64: String,
) -> Result<String, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&ciphertext_b64).map_err(|e| e.to_string())?;
    let mut store_guard = state.store.lock().unwrap();
    let store_ref = store_guard.as_mut().ok_or("Saqlov yopiq")?;
    let pt = session::decrypt_from(store_ref, &sender_id, 1, msg_type, &bytes)
        .await.map_err(|e| e.to_string())?;
    String::from_utf8(pt).map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .manage(AppState {
            store: Mutex::new(None),
            api:   Mutex::new(net::ApiClient::new("https://server.lokal:8443")),
        })
        .invoke_handler(tauri::generate_handler![
            login, bootstrap_keys, send_message, decrypt_incoming
        ])
        .run(tauri::generate_context!())
        .expect("Tauri ilovasi ishga tushmadi");
}
```

---

# 4-Bosqich: Tauri mijoz UI (Telegram-vari)

## 4.1. Tauri konfiguratsiyasi

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
    "targets": ["msi", "deb", "appimage"],
    "icon": ["icons/icon.png"]
  }
}
```

## 4.2. Frontend struktura va paketlar

```json
// Fayl: client/package.json
{
  "name": "lokal-messenger-ui",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "tauri": "tauri"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "zustand": "^4.5.4",
    "@tauri-apps/api": "^2.0.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "typescript": "^5.5.0",
    "vite": "^5.3.0"
  }
}
```

> **Eslatma:** Komponent kutubxonalari (MUI, Antd va boshqalar) ataylab ishlatilmaydi — kuchsiz mashinada xotira sarfini kamaytirish uchun barchasi sof CSS bilan yoziladi.

## 4.3. Asosiy CSS — Telegram-vari oq va qorongʻi rejim

```css
/* Fayl: client/src/styles/theme.css
   Maqsad: Telegram Desktop'ga oʻxshash ranglar va tipografiya. */

:root {
  --bg-primary: #ffffff;
  --bg-secondary: #f4f5f7;
  --bg-chat: #e5dccd;       /* Telegram'ga oʻxshash bezakli fon */
  --text-primary: #000000;
  --text-secondary: #707579;
  --accent: #3390ec;
  --bubble-out: #effdde;
  --bubble-in:  #ffffff;
  --border: #dadce0;
  --hover: #f1f3f4;
  --selected: #e1e9f7;
}

[data-theme="dark"] {
  --bg-primary: #212121;
  --bg-secondary: #181818;
  --bg-chat: #0e1621;
  --text-primary: #ffffff;
  --text-secondary: #aaaaaa;
  --accent: #8774e1;
  --bubble-out: #2b5278;
  --bubble-in:  #182533;
  --border: #2a2a2a;
  --hover: #2c2c2c;
  --selected: #2b5278;
}

* { box-sizing: border-box; }

html, body, #root {
  margin: 0;
  padding: 0;
  height: 100%;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 14px;
  color: var(--text-primary);
  background: var(--bg-primary);
}

button {
  cursor: pointer;
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
}
input, textarea {
  font: inherit;
  color: inherit;
}
```

## 4.4. Asosiy oyna kompozitsiyasi

```tsx
// Fayl: client/src/App.tsx
// Maqsad: Telegram Desktop'ga oʻxshash ikki-panelli asosiy interfeys quriladi.
import React, { useEffect } from "react";
import { useAuthStore } from "./stores/auth";
import { useThemeStore } from "./stores/theme";
import { LoginPage } from "./pages/LoginPage";
import { ChatList } from "./components/ChatList";
import { ChatView } from "./components/ChatView";
import "./styles/theme.css";
import "./styles/layout.css";

export default function App() {
  // Foydalanuvchi sessiyasi va mavzu (light/dark) holati
  const { token, hydrate } = useAuthStore();
  const { theme } = useThemeStore();

  useEffect(() => {
    // Saqlangan token yuklanadi (mavjud boʻlsa)
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    // Mavzu HTML root elementiga qoʻllaniladi
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  if (!token) {
    // Token yoʻq — login sahifasi koʻrsatiladi
    return <LoginPage />;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <ChatList />
      </aside>
      <main className="chat-pane">
        <ChatView />
      </main>
    </div>
  );
}
```

```css
/* Fayl: client/src/styles/layout.css */
.app-shell {
  display: flex;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
}
.sidebar {
  width: 320px;
  min-width: 240px;
  border-right: 1px solid var(--border);
  background: var(--bg-secondary);
  display: flex;
  flex-direction: column;
}
.chat-pane {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: var(--bg-chat);
}
```

## 4.5. Login sahifasi

```tsx
// Fayl: client/src/pages/LoginPage.tsx
// Maqsad: Faqat hisob maʼlumotlari orqali kirish — ochiq roʻyxatdan oʻtish yoʻq.
import React, { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAuthStore } from "../stores/auth";

export function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { setSession } = useAuthStore();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      // Login chaqiriladi (Rust orqali server bilan aloqa)
      const res: any = await invoke("login", { username, password });
      setSession({
        token:  res.token,
        userId: res.user_id,
        role:   res.role,
        mustChange: res.must_change_password,
      });
      // Birinchi kirishda kalitlar yaratiladi va serverga yuklanadi
      await invoke("bootstrap_keys");
    } catch (err: any) {
      setError(typeof err === "string" ? err : "kirish xatosi");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-shell">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>Lokal Messenger</h1>
        <p className="subtitle">Yopiq tarmoq messenjeri</p>

        <label>Login</label>
        <input
          autoFocus
          autoComplete="username"
          value={username}
          onChange={e => setUsername(e.target.value)}
          required
        />

        <label>Parol</label>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
        />

        {error && <div className="error-line">{error}</div>}

        <button type="submit" disabled={busy} className="btn-primary">
          {busy ? "Tekshirilyapti..." : "Tizimga kirish"}
        </button>

        <div className="hint">
          Hisob faqat administrator tomonidan beriladi.
        </div>
      </form>
    </div>
  );
}
```

```css
/* Fayl: client/src/styles/login.css */
.login-shell {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-secondary);
}
.login-card {
  width: 360px;
  padding: 32px 28px;
  background: var(--bg-primary);
  border-radius: 12px;
  box-shadow: 0 4px 24px rgba(0,0,0,0.08);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.login-card h1 {
  margin: 0; font-size: 22px; font-weight: 600;
}
.login-card .subtitle {
  margin: 0 0 18px 0;
  color: var(--text-secondary);
  font-size: 13px;
}
.login-card label {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 8px;
}
.login-card input {
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-primary);
  color: var(--text-primary);
}
.btn-primary {
  margin-top: 16px;
  background: var(--accent);
  color: #fff;
  padding: 10px;
  border-radius: 8px;
  font-weight: 500;
}
.btn-primary:disabled { opacity: 0.6; }
.error-line { color: #d33; font-size: 12px; margin-top: 6px; }
.hint { color: var(--text-secondary); font-size: 12px; margin-top: 16px; text-align: center; }
```

## 4.6. Chatlar roʻyxati

```tsx
// Fayl: client/src/components/ChatList.tsx
// Maqsad: Yon panel — chatlar roʻyxati va qidiruv maydoni Telegram uslubida.
import React from "react";
import { useChatStore } from "../stores/chats";
import { useThemeStore } from "../stores/theme";

export function ChatList() {
  const { chats, currentChatId, selectChat } = useChatStore();
  const { theme, toggle } = useThemeStore();

  return (
    <>
      <div className="sidebar-header">
        <button className="icon-btn" title="Menyu">☰</button>
        <input className="search-box" placeholder="Qidirish..." />
        <button className="icon-btn" onClick={toggle}
                title={theme === "dark" ? "Yorug‘ rejim" : "Qorong‘i rejim"}>
          {theme === "dark" ? "☀" : "🌙"}
        </button>
      </div>

      <div className="chat-items">
        {chats.map(c => (
          <div
            key={c.id}
            className={`chat-item ${c.id === currentChatId ? "active" : ""}`}
            onClick={() => selectChat(c.id)}
          >
            <div className="avatar" style={{ background: c.color || "#3390ec" }}>
              {c.title?.charAt(0).toUpperCase() ?? "?"}
            </div>
            <div className="chat-meta">
              <div className="chat-row1">
                <span className="chat-title">{c.title}</span>
                <span className="chat-time">{c.lastTime ?? ""}</span>
              </div>
              <div className="chat-row2">
                <span className="chat-preview">
                  {c.lastPreview ?? "Hali xabar yoʻq"}
                </span>
                {c.unread > 0 && <span className="badge">{c.unread}</span>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
```

```css
/* Fayl: client/src/styles/chatlist.css */
.sidebar-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
}
.icon-btn {
  width: 36px; height: 36px;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
}
.icon-btn:hover { background: var(--hover); }
.search-box {
  flex: 1;
  padding: 8px 12px;
  border: none;
  background: var(--bg-primary);
  border-radius: 18px;
}
.chat-items {
  flex: 1;
  overflow-y: auto;
}
.chat-item {
  display: flex;
  gap: 10px;
  padding: 8px 12px;
  cursor: pointer;
  align-items: center;
}
.chat-item:hover { background: var(--hover); }
.chat-item.active { background: var(--selected); }
.avatar {
  width: 44px; height: 44px;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-weight: 600;
  flex-shrink: 0;
}
.chat-meta { flex: 1; min-width: 0; }
.chat-row1 { display: flex; justify-content: space-between; }
.chat-row2 { display: flex; justify-content: space-between; align-items: center; }
.chat-title { font-weight: 500; }
.chat-time { font-size: 11px; color: var(--text-secondary); }
.chat-preview {
  font-size: 13px;
  color: var(--text-secondary);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  max-width: 200px;
}
.badge {
  background: var(--accent);
  color: #fff;
  border-radius: 11px;
  font-size: 11px;
  padding: 2px 7px;
  min-width: 20px;
  text-align: center;
}
```

## 4.7. Chat oynasi va xabar puffaklar

```tsx
// Fayl: client/src/components/ChatView.tsx
// Maqsad: Tanlangan suhbat ochiladi, xabarlar koʻrsatiladi va yozish maydoni boʻladi.
import React, { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useChatStore } from "../stores/chats";
import { useAuthStore } from "../stores/auth";

export function ChatView() {
  const { currentChat, messages, sendMessage } = useChatStore();
  const { userId } = useAuthStore();
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Yangi xabar kelganda pastga skrol qilinadi
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  if (!currentChat) {
    return <div className="empty-state">Suhbatni tanlang</div>;
  }

  async function onSend(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    // Xabar shifrlanadi va serverga yuboriladi
    await sendMessage(text);
  }

  return (
    <>
      <header className="chat-header">
        <div className="avatar" style={{ background: currentChat.color }}>
          {currentChat.title?.charAt(0)}
        </div>
        <div>
          <div className="chat-title">{currentChat.title}</div>
          <div className="chat-status">
            {currentChat.online ? "onlayn" : "oxirgi marta yaqinda"}
          </div>
        </div>
      </header>

      <div className="messages-pane" ref={scrollRef}>
        {messages.map(m => (
          <div
            key={m.id}
            className={`bubble ${m.senderId === userId ? "out" : "in"}`}
          >
            <div className="bubble-text">{m.text}</div>
            <div className="bubble-meta">
              <span>{m.time}</span>
              {m.senderId === userId && (
                <span className="ticks">
                  {m.read ? "✓✓" : m.delivered ? "✓✓" : "✓"}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      <form className="composer" onSubmit={onSend}>
        <button type="button" className="icon-btn" title="Fayl biriktirish">📎</button>
        <textarea
          rows={1}
          placeholder="Xabar yozing..."
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              (e.currentTarget.form as HTMLFormElement).requestSubmit();
            }
          }}
        />
        <button type="submit" className="icon-btn send" title="Yuborish">➤</button>
      </form>
    </>
  );
}
```

```css
/* Fayl: client/src/styles/chatview.css */
.chat-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  background: var(--bg-primary);
  border-bottom: 1px solid var(--border);
}
.chat-status { font-size: 12px; color: var(--text-secondary); }

.messages-pane {
  flex: 1;
  overflow-y: auto;
  padding: 12px 18px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.bubble {
  max-width: 70%;
  padding: 6px 10px 4px 10px;
  border-radius: 12px;
  position: relative;
  word-wrap: break-word;
}
.bubble.in {
  align-self: flex-start;
  background: var(--bubble-in);
  border-bottom-left-radius: 4px;
}
.bubble.out {
  align-self: flex-end;
  background: var(--bubble-out);
  border-bottom-right-radius: 4px;
}
.bubble-text { font-size: 14px; line-height: 1.4; }
.bubble-meta {
  font-size: 11px;
  color: var(--text-secondary);
  text-align: right;
  margin-top: 2px;
}
.ticks { margin-left: 4px; color: #4fae4e; }

.composer {
  display: flex;
  gap: 8px;
  padding: 8px 12px;
  background: var(--bg-primary);
  border-top: 1px solid var(--border);
  align-items: flex-end;
}
.composer textarea {
  flex: 1;
  resize: none;
  border: 1px solid var(--border);
  border-radius: 18px;
  padding: 8px 14px;
  background: var(--bg-primary);
  color: var(--text-primary);
  max-height: 140px;
}
.composer .send {
  background: var(--accent);
  color: #fff;
}
.empty-state {
  flex: 1;
  display: flex; align-items: center; justify-content: center;
  color: var(--text-secondary);
}
```

## 4.8. Holat menejerlari (Zustand)

```ts
// Fayl: client/src/stores/auth.ts
// Maqsad: Foydalanuvchi sessiyasi mahalliy disk va xotirada saqlanadi.
import { create } from "zustand";

interface AuthState {
  token: string | null;
  userId: string | null;
  role: string | null;
  mustChange: boolean;
  setSession: (s: { token: string; userId: string; role: string; mustChange: boolean }) => void;
  clear: () => void;
  hydrate: () => void;
}

const STORAGE_KEY = "auth_session_v1";

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  userId: null,
  role: null,
  mustChange: false,
  setSession: (s) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    set(s);
  },
  clear: () => {
    localStorage.removeItem(STORAGE_KEY);
    set({ token: null, userId: null, role: null, mustChange: false });
  },
  hydrate: () => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try { set(JSON.parse(raw)); } catch {}
    }
  },
}));
```

```ts
// Fayl: client/src/stores/theme.ts
// Maqsad: Yorug'/qorong'i mavzu tanlovi saqlanadi.
import { create } from "zustand";

type Theme = "light" | "dark";
interface ThemeState { theme: Theme; toggle: () => void; set: (t: Theme) => void; }

export const useThemeStore = create<ThemeState>((set) => ({
  theme: (localStorage.getItem("theme") as Theme) || "light",
  toggle: () => set((s) => {
    const next: Theme = s.theme === "dark" ? "light" : "dark";
    localStorage.setItem("theme", next);
    return { theme: next };
  }),
  set: (t) => { localStorage.setItem("theme", t); set({ theme: t }); },
}));
```

```ts
// Fayl: client/src/stores/chats.ts
// Maqsad: Chatlar va xabarlar holati boshqariladi, WebSocket eshitiladi.
import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { useAuthStore } from "./auth";

interface ChatItem {
  id: string;
  title: string;
  color?: string;
  online?: boolean;
  unread: number;
  lastTime?: string;
  lastPreview?: string;
  peerUserId?: string;
}

interface UIMessage {
  id: string;
  senderId: string;
  text: string;
  time: string;
  delivered?: boolean;
  read?: boolean;
}

interface ChatStore {
  chats: ChatItem[];
  currentChatId: string | null;
  currentChat: ChatItem | null;
  messages: UIMessage[];
  selectChat: (id: string) => void;
  sendMessage: (text: string) => Promise<void>;
  ingest: (raw: any) => Promise<void>;
}

export const useChatStore = create<ChatStore>((set, get) => ({
  chats: [],
  currentChatId: null,
  currentChat: null,
  messages: [],

  selectChat: (id) => {
    const chat = get().chats.find((c) => c.id === id) || null;
    set({ currentChatId: id, currentChat: chat, messages: [] });
    // Tarix server'dan tortib olinishi mumkin (ciphertext kelib, mahalliy ochiladi)
  },

  sendMessage: async (text) => {
    const chat = get().currentChat;
    const userId = useAuthStore.getState().userId!;
    if (!chat || !chat.peerUserId) return;
    // Rust tomonida shifrlash + yuborish bajariladi
    await invoke("send_message", {
      chatId: chat.id,
      recipientId: chat.peerUserId,
      plaintext: text,
    });
    // Optimistik tarzda UI'ga yoziladi
    set((s) => ({
      messages: [...s.messages, {
        id: crypto.randomUUID(),
        senderId: userId,
        text,
        time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        delivered: false,
      }],
    }));
  },

  ingest: async (raw) => {
    // WebSocket'dan kelgan paket Rust'ga uzatiladi va ochiladi
    if (raw.type !== "msg.recv") return;
    const p = raw.payload;
    const text: string = await invoke("decrypt_incoming", {
      senderId: p.sender_id,
      msgType: p.msg_type,
      ciphertextB64: p.ciphertext,
    });
    set((s) => {
      if (s.currentChatId !== p.chat_id) return s;
      return {
        messages: [...s.messages, {
          id: p.msg_id,
          senderId: p.sender_id,
          text,
          time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        }],
      };
    });
  },
}));
```

## 4.9. WebSocket ulanishi (mijoz tomonida)

```ts
// Fayl: client/src/net/socket.ts
// Maqsad: Mijoz WebSocket ulanishini ushlab turadi va kiruvchi paketlarni
//         chats store'iga uzatadi.
import { useAuthStore } from "../stores/auth";
import { useChatStore } from "../stores/chats";

let ws: WebSocket | null = null;
let backoff = 1000;

export function connectSocket() {
  const token = useAuthStore.getState().token;
  if (!token) return;
  ws = new WebSocket(`wss://server.lokal:8443/ws?token=${encodeURIComponent(token)}`);

  ws.onopen = () => { backoff = 1000; };
  ws.onmessage = (ev) => {
    try {
      const env = JSON.parse(ev.data);
      useChatStore.getState().ingest(env);
    } catch {}
  };
  ws.onclose = () => {
    // Avtomatik qayta ulanish (eksponentsial kechikish)
    setTimeout(connectSocket, backoff);
    backoff = Math.min(backoff * 2, 30000);
  };
  ws.onerror = () => ws?.close();
}

export function sendOverSocket(payload: any) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}
```

---

# Ishga tushirish va sinov

## Server tomondan (`docker-compose.yml`)

```yaml
# Fayl: deploy/docker-compose.yml
# Maqsad: Server, PostgreSQL va Redis bitta tarmoqda ishga tushiriladi.
services:
  postgres:
    image: postgres:16-alpine
    restart: always
    environment:
      POSTGRES_USER: msg
      POSTGRES_PASSWORD: STRONG
      POSTGRES_DB: lokal_messenger
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ../server/db/migrations:/docker-entrypoint-initdb.d:ro
    networks: [internal]

  redis:
    image: redis:7-alpine
    restart: always
    command: ["redis-server", "--save", "60", "1", "--maxmemory", "256mb", "--maxmemory-policy", "allkeys-lru"]
    networks: [internal]

  server:
    build: ../server
    restart: always
    depends_on: [postgres, redis]
    ports:
      - "8443:8443"
    volumes:
      - ./tls:/etc/lokal-msg:ro
    networks: [internal]

volumes:
  pgdata:

networks:
  internal:
    driver: bridge
```

## Mijoz binari yasash

```bash
# Tauri ilovasi qurib chiqariladi (Windows + Linux uchun bitta buyruqdan)
cd client
npm install
npm run tauri build
# Natija: src-tauri/target/release/bundle/...
```

**Kutilayotgan resurs sarfi:**

| Komponent           | RAM (passiv) | RAM (faol) | Bin hajmi |
|---------------------|--------------|------------|-----------|
| Tauri mijoz (Win)   | ~45 MB       | ~80 MB     | ~7 MB     |
| Tauri mijoz (Linux) | ~38 MB       | ~70 MB     | ~6 MB     |
| Go server (idle)    | ~25 MB       | ~80 MB / 1k mijoz | ~14 MB |

## Xavfsizlikni tekshirish roʻyxati

1. Server JWT kalitiga `chmod 600` qoʻyilgan, `/etc/lokal-msg/jwt.key` faqat root uchun ochiq.
2. PostgreSQL boshqaruvchi parol konfiguratsiyada emas, balki `pg_hba.conf` orqali `peer` rejimida ishlaydi.
3. TLS sertifikati ichki CA tomonidan imzolangan; mijozlarda ushbu CA pinned qilingan.
4. `users.password_hash` argon2id; `must_change_password` qoidasi birinchi kirishda majburiy.
5. Server xabar tanasini hech qachon ochmaydi; ciphertext'ning toʻgʻriligi faqat mijozda tekshiriladi (Signal Double Ratchet integral check).
6. Audit log barcha admin amallari uchun yozuv qoldiradi.
7. Brute-force himoyasi: 5 marta xato kirishdan keyin 15 daqiqaga blok.
8. Tauri CSP siyosati `connect-src` faqat ichki server adresiga ruxsat beradi.

## Yana yaxshilash mumkin boʻlgan jihatlar

- **Ko'p qurilma qo'llab-quvvatlash:** Hozirgi sxemada `device_id = 1` qotirib qoʻyilgan; har bir qurilma uchun alohida session qatori va prekey shoxchasi qo'shish lozim.
- **Guruh chatlar:** Hozirda har bir aʼzo uchun alohida message yozuvi yaratiladi (Sender Keys yo'q). Katta guruhlar uchun Signal'ning Sender Keys protokolini joriy etish samarali boʻladi.
- **Faylni shifrlash:** Yuqorida `files` jadvali sxemasi berilgan, lekin oqim shifrlash kodi (AES-GCM ramkalari) toʻliq yoritilmadi. U mijoz tomonida fayl boʻlaklarini shifrlab, server diskka opaque blob sifatida yozish printsipida qurilishi kerak.
- **Kalit-bundle muvofiqligini koʻrsatuvchi xavfsizlik raqami** (Signal'dagi "safety number") kabi UI ekrani qo'shish.

---

> Hujjat oxiri.
