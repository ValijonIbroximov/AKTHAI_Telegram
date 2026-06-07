// Fayl: server/internal/middleware/auth.go
// Maqsad: Har bir himoyalangan so'rovga JWT tekshiruvi va rol tekshiruvi qo'llaniladi.
package middleware

import (
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/redis/go-redis/v9"

	"github.com/military/lokal-messenger/server/internal/auth"
)

// Authenticate — Authorization headeridan yoki WebSocket uchun
// "token" query parametridan JWT olinadi va tekshiriladi.
// Redis'dan sessiya faolligi ham tekshiriladi.
func Authenticate(jwtMgr *auth.JWTManager, rdb *redis.Client) fiber.Handler {
	return func(c *fiber.Ctx) error {
		var tokenStr string

		header := c.Get("Authorization")
		if strings.HasPrefix(header, "Bearer ") {
			tokenStr = strings.TrimPrefix(header, "Bearer ")
		} else {
			// WebSocket ulanishlari header o'rniga query parametr ishlatadi
			tokenStr = c.Query("token")
		}

		if tokenStr == "" {
			return fiber.NewError(fiber.StatusUnauthorized, "token ko'rsatilmagan")
		}

		claims, err := jwtMgr.Verify(tokenStr)
		if err != nil {
			return fiber.NewError(fiber.StatusUnauthorized, "token yaroqsiz")
		}

		// Sessiya bekor qilinmaganligi Redis'dan tekshiriladi
		exists, err := rdb.Exists(c.Context(), "session:"+claims.ID).Result()
		if err != nil || exists == 0 {
			return fiber.NewError(fiber.StatusUnauthorized, "sessiya tugagan")
		}

		// Bloklangan hisob
		blocked, err := rdb.Exists(c.Context(), "user_blocked:"+claims.UserID).Result()
		if err == nil && blocked > 0 {
			return fiber.NewError(fiber.StatusForbidden, "hisob bloklangan")
		}

		// Konteksga foydalanuvchi ma'lumoti yoziladi
		c.Locals("user_id", claims.UserID)
		c.Locals("role", claims.Role)
		c.Locals("jti", claims.ID)
		return c.Next()
	}
}

// RequireRole — faqat ko'rsatilgan rollarga ega foydalanuvchini o'tkazadi.
// Ruxsatsiz rol uchun 403 Forbidden qaytariladi.
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
