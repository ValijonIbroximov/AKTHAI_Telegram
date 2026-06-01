// Fayl: server/internal/middleware/auth.go
// Maqsad: Har bir himoyalangan so'rovga JWT tekshiruvi va rol tekshiruvi (RBAC) qo'llaniladi.
package middleware

import (
	"strings"

	"github.com/gofiber/contrib/websocket"
	"github.com/gofiber/fiber/v2"
	"github.com/military/lokal-messenger/server/internal/auth"
	"github.com/military/lokal-messenger/server/internal/cache"
	"github.com/redis/go-redis/v9"
)

// verify — token satri tekshiriladi, sessiya Redis'da mavjudligi nazorat qilinadi
// va kontekstga foydalanuvchi ma'lumoti yoziladi.
func verify(c *fiber.Ctx, tokenStr string, jwtMgr *auth.JWTManager, rdb *redis.Client) error {
	claims, err := jwtMgr.Verify(tokenStr)
	if err != nil {
		return fiber.NewError(fiber.StatusUnauthorized, "token yaroqsiz")
	}

	// Sessiya bekor qilinmaganligi Redis'dan tekshiriladi (logout/expire holatlari)
	exists, err := rdb.Exists(c.Context(), cache.SessionKey(claims.ID)).Result()
	if err != nil || exists == 0 {
		return fiber.NewError(fiber.StatusUnauthorized, "sessiya tugagan")
	}

	// Kontekstga foydalanuvchi ma'lumoti yoziladi (keyingi handlerlar foydalanadi)
	c.Locals("user_id", claims.UserID)
	c.Locals("role", claims.Role)
	c.Locals("jti", claims.ID)
	return nil
}

// Authenticate — odatiy REST so'rovlari uchun: token "Authorization: Bearer" sarlavhasidan olinadi.
func Authenticate(jwtMgr *auth.JWTManager, rdb *redis.Client) fiber.Handler {
	return func(c *fiber.Ctx) error {
		header := c.Get("Authorization")
		if !strings.HasPrefix(header, "Bearer ") {
			return fiber.NewError(fiber.StatusUnauthorized, "token ko'rsatilmagan")
		}
		tokenStr := strings.TrimPrefix(header, "Bearer ")
		if err := verify(c, tokenStr, jwtMgr, rdb); err != nil {
			return err
		}
		return c.Next()
	}
}

// AuthenticateWS — WebSocket ulanishi uchun: brauzer WebSocket'i maxsus sarlavha
// yubora olmagani sababli, token "?token=..." so'rov parametridan olinadi
// (zaxira sifatida sarlavha ham qabul qilinadi). Tekshiruvdan so'ng ulanishni
// WebSocket darajasiga ko'tarishga ruxsat beriladi.
func AuthenticateWS(jwtMgr *auth.JWTManager, rdb *redis.Client) fiber.Handler {
	return func(c *fiber.Ctx) error {
		tokenStr := c.Query("token")
		if tokenStr == "" {
			header := c.Get("Authorization")
			if strings.HasPrefix(header, "Bearer ") {
				tokenStr = strings.TrimPrefix(header, "Bearer ")
			}
		}
		if tokenStr == "" {
			return fiber.NewError(fiber.StatusUnauthorized, "token ko'rsatilmagan")
		}
		if err := verify(c, tokenStr, jwtMgr, rdb); err != nil {
			return err
		}

		// So'rov haqiqatan WebSocket ulanishini so'rayotgani tasdiqlanadi
		if websocket.IsWebSocketUpgrade(c) {
			c.Locals("allowed", true)
			return c.Next()
		}
		return fiber.ErrUpgradeRequired
	}
}

// RequireRole — faqat berilgan rollardan biriga ega foydalanuvchini o'tkazadi.
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
