// Fayl: server/internal/api/sessions.go
// Maqsad: JWT sessiyalarini Redis'da kuzatish va bekor qilish.
package api

import (
	"context"
	"time"
)

func sessionKey(jti string) string       { return "session:" + jti }
func userSessionsKey(userID string) string { return "user_sessions:" + userID }

func (h *Handlers) trackSession(ctx context.Context, userID, jti string, ttl time.Duration) error {
	pipe := h.deps.Cache.Pipeline()
	pipe.Set(ctx, sessionKey(jti), userID, ttl)
	pipe.SAdd(ctx, userSessionsKey(userID), jti)
	_, err := pipe.Exec(ctx)
	return err
}

func (h *Handlers) untrackSession(ctx context.Context, userID, jti string) {
	pipe := h.deps.Cache.Pipeline()
	pipe.Del(ctx, sessionKey(jti))
	if userID != "" {
		pipe.SRem(ctx, userSessionsKey(userID), jti)
	}
	_, _ = pipe.Exec(ctx)
}

func (h *Handlers) revokeAllUserSessions(ctx context.Context, userID string) error {
	jtis, err := h.deps.Cache.SMembers(ctx, userSessionsKey(userID)).Result()
	if err != nil {
		return err
	}
	pipe := h.deps.Cache.Pipeline()
	for _, jti := range jtis {
		pipe.Del(ctx, sessionKey(jti))
	}
	pipe.Del(ctx, userSessionsKey(userID))
	if _, err := pipe.Exec(ctx); err != nil {
		return err
	}

	// Eski sessiyalar (user_sessions ro'yxatidan oldin ochilgan)
	iter := h.deps.Cache.Scan(ctx, 0, "session:*", 128).Iterator()
	for iter.Next(ctx) {
		key := iter.Val()
		val, getErr := h.deps.Cache.Get(ctx, key).Result()
		if getErr == nil && val == userID {
			_ = h.deps.Cache.Del(ctx, key).Err()
		}
	}
	return iter.Err()
}
