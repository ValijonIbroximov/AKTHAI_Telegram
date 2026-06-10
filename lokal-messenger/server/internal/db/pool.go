// Fayl: server/internal/db/pool.go
// Maqsad: PostgreSQL ulanish hovuzi tayyorlanadi va qaytariladi.
package db

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/military/lokal-messenger/server/internal/config"
)

// NewPool — konfiguratsiya asosida pgxpool ulanish hovuzi yaratiladi.
// MaxConns va MinConns config.yaml dagi qiymatlardan o'qiladi.
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
	pool, err := pgxpool.NewWithConfig(ctx, pcfg)
	if err != nil {
		return nil, err
	}
	if err := ensureSchema(ctx, pool); err != nil {
		pool.Close()
		return nil, err
	}
	return pool, nil
}

// ensureSchema — mavjud bazaga yangi ustunlar qo'shiladi (qo'lda migratsiyasiz ishlashi uchun).
func ensureSchema(ctx context.Context, pool *pgxpool.Pool) error {
	_, err := pool.Exec(ctx, `
		ALTER TABLE users
		    ADD COLUMN IF NOT EXISTS hide_last_seen BOOLEAN NOT NULL DEFAULT FALSE;
		ALTER TABLE users ADD COLUMN IF NOT EXISTS okrug_name VARCHAR(128);
		ALTER TABLE users ADD COLUMN IF NOT EXISTS okrug_code VARCHAR(32);
		ALTER TABLE users ADD COLUMN IF NOT EXISTS unit_name VARCHAR(128);
		ALTER TABLE users ADD COLUMN IF NOT EXISTS division_name VARCHAR(128);
		ALTER TABLE users ADD COLUMN IF NOT EXISTS division_code VARCHAR(64);
		ALTER TABLE users ADD COLUMN IF NOT EXISTS display_short VARCHAR(64);
		ALTER TABLE users
		    ADD COLUMN IF NOT EXISTS can_create_channel BOOLEAN NOT NULL DEFAULT TRUE;
		ALTER TABLE users
		    ADD COLUMN IF NOT EXISTS can_create_group BOOLEAN NOT NULL DEFAULT TRUE;
		ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_path TEXT;

		ALTER TABLE chats ADD COLUMN IF NOT EXISTS description TEXT;
		ALTER TABLE chats DROP CONSTRAINT IF EXISTS chats_type_check;
		ALTER TABLE chats ADD CONSTRAINT chats_type_check
		    CHECK (type IN ('private', 'group', 'channel'));

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

		CREATE TABLE IF NOT EXISTS group_key_vault (
		    chat_id      UUID PRIMARY KEY REFERENCES chats(id) ON DELETE CASCADE,
		    key_material TEXT NOT NULL,
		    updated_by   UUID REFERENCES users(id) ON DELETE SET NULL,
		    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);

		CREATE TABLE IF NOT EXISTS group_key_requests (
		    chat_id      UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
		    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
		    PRIMARY KEY (chat_id, user_id)
		);`)
	return err
}
