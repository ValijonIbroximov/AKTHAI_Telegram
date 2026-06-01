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
	return pgxpool.NewWithConfig(ctx, pcfg)
}
