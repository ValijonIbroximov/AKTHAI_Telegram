// Fayl: server/internal/cache/redis.go
// Maqsad: Redis mijozi tayyorlanadi va ulanish tekshiriladi.
package cache

import (
	"context"
	"time"

	"github.com/military/lokal-messenger/server/internal/config"
	"github.com/redis/go-redis/v9"
)

// NewClient — Redis mijozi yaratiladi va ulanish PING orqali sinab ko'riladi.
func NewClient(cfg config.RedisConfig) (*redis.Client, error) {
	c := redis.NewClient(&redis.Options{
		Addr:     cfg.Addr,
		Password: cfg.Password,
		DB:       cfg.DB,
	})
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := c.Ping(ctx).Err(); err != nil {
		return nil, err
	}
	return c, nil
}
