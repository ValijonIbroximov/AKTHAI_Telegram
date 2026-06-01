// Fayl: server/internal/cache/redis.go
// Maqsad: Redis mijozi tayyorlanadi va bog'liqlik tekshiriladi.
package cache

import (
	"context"

	"github.com/redis/go-redis/v9"
	"github.com/military/lokal-messenger/server/internal/config"
)

// NewClient — Redis ulanishi o'rnatiladi.
// Ping orqali server mavjudligi tekshiriladi; xato bo'lsa qaytariladi.
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
