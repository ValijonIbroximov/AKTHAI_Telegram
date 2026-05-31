// Fayl: server/internal/db/pool.go
// Maqsad: PostgreSQL ulanish hovuzi tayyorlanadi va sozlamalar qo'llaniladi.
package db

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/military/lokal-messenger/server/internal/config"
)

// NewPool — konfiguratsiyadagi DSN asosida ulanish hovuzi yaratiladi.
func NewPool(ctx context.Context, cfg config.DatabaseConfig) (*pgxpool.Pool, error) {
	pcfg, err := pgxpool.ParseConfig(cfg.DSN)
	if err != nil {
		return nil, err
	}
	// Maksimal ochiq ulanishlar soni sozlanadi
	if cfg.MaxOpenConns > 0 {
		pcfg.MaxConns = int32(cfg.MaxOpenConns)
	}
	// Bo'sh turuvchi minimal ulanishlar soni sozlanadi
	if cfg.MaxIdleConns > 0 {
		pcfg.MinConns = int32(cfg.MaxIdleConns)
	}
	return pgxpool.NewWithConfig(ctx, pcfg)
}
