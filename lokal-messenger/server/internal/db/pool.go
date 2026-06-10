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

		ALTER TABLE chats ADD COLUMN IF NOT EXISTS description TEXT;
		ALTER TABLE chats DROP CONSTRAINT IF EXISTS chats_type_check;
		ALTER TABLE chats ADD CONSTRAINT chats_type_check
		    CHECK (type IN ('private', 'group', 'channel'));`)
	return err
}
