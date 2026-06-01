-- Fayl: server/db/migrations/0001_init.sql
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
    password_hash           TEXT NOT NULL,
    display_name            VARCHAR(128) NOT NULL,
    role                    VARCHAR(16) NOT NULL DEFAULT 'user',
    rank_title              VARCHAR(64),
    unit_code               VARCHAR(64),
    is_active               BOOLEAN NOT NULL DEFAULT TRUE,
    must_change_password    BOOLEAN NOT NULL DEFAULT TRUE,
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
    identity_key       BYTEA NOT NULL,
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
-- X3DH almashish uchun foydalanilgach, used=TRUE qo'yiladi.
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
    type            VARCHAR(16) NOT NULL,
    title           VARCHAR(128),
    created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chats_type_check CHECK (type IN ('private', 'group'))
);

-- ============================================================
-- Suhbat a'zolari
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
-- Plain matnni server hech qachon ko'rmaydi.
-- ============================================================
CREATE TABLE messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_id         UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    sender_id       UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
    recipient_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ciphertext      BYTEA NOT NULL,
    msg_type        SMALLINT NOT NULL,
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
-- Faylning o'zi diskda shifrlangan blob sifatida saqlanadi.
-- ============================================================
CREATE TABLE files (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    uploader_id     UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
    storage_key     TEXT NOT NULL,
    size_bytes      BIGINT NOT NULL,
    sha256          BYTEA NOT NULL,
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
