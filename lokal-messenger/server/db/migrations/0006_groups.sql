-- Guruhlar: yaratish huquqi, kalit konvertlari, taklif havolalari
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_create_group BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS group_key_envelopes (
    chat_id       UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    from_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
    ciphertext    TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (chat_id, user_id)
);

CREATE TABLE IF NOT EXISTS group_invite_links (
    token       TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    chat_id     UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    expires_at  TIMESTAMPTZ,
    max_uses    INTEGER,
    use_count   INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_group_invite_chat ON group_invite_links(chat_id);
