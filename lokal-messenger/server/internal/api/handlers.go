// Fayl: server/internal/api/handlers.go
// Maqsad: Barcha REST handlerlar uchun umumiy bog'liqliklar konteyneri va
//
//	yagona xato ishlovchisi e'lon qilinadi.
package api

import (
	"context"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/military/lokal-messenger/server/internal/auth"
	"github.com/military/lokal-messenger/server/internal/config"
	"github.com/military/lokal-messenger/server/internal/ws"
	"github.com/redis/go-redis/v9"
)

// Deps — handlerlar foydalanadigan barcha qism-tizimlar to'plami.
type Deps struct {
	DB     *pgxpool.Pool
	Cache  *redis.Client
	JWT    *auth.JWTManager
	Hub    *ws.Hub
	Config *config.Config
}

// Handlers — barcha REST handler metodlari shu strukturaga biriktiriladi.
type Handlers struct {
	deps *Deps
}

// ErrorHandler — yagona xato ishlovchisi: barcha xatolar JSON formatda qaytariladi.
func ErrorHandler(c *fiber.Ctx, err error) error {
	code := fiber.StatusInternalServerError
	msg := "ichki xatolik"
	if e, ok := err.(*fiber.Error); ok {
		code = e.Code
		msg = e.Message
	}
	return c.Status(code).JSON(fiber.Map{"error": msg})
}

// audit — admin amallari va xavfsizlik hodisalari audit jurnaliga yoziladi.
func (h *Handlers) audit(ctx context.Context, actorID, action string, target *string, ip string) error {
	_, err := h.deps.DB.Exec(ctx, `
        INSERT INTO audit_log (actor_id, action, target_id, ip_address)
        VALUES (NULLIF($1, '')::uuid, $2, NULLIF($3, '')::uuid, NULLIF($4, '')::inet)
    `, actorID, action, ifNil(target), ip)
	return err
}

// ifNil — nil ko'rsatkichni bo'sh satrga aylantiradi (SQL NULLIF bilan ishlash uchun).
func ifNil(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}
