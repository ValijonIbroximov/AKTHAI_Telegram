// Fayl: server/internal/api/handlers.go
// Maqsad: Barcha REST handlerlar uchun umumiy bog'liqliklar konteyneri va
//         yordamchi handlerlar to'plami saqlanadi.
package api

import (
	"context"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/military/lokal-messenger/server/internal/auth"
	"github.com/military/lokal-messenger/server/internal/config"
	"github.com/military/lokal-messenger/server/internal/ws"
)

// Deps — barcha handler'larga uzatiladigan umumiy bog'liqliklar to'plami.
type Deps struct {
	DB         *pgxpool.Pool
	Cache      *redis.Client
	JWT        *auth.JWTManager
	Hub        *ws.Hub
	Config     *config.Config
	// WebDistDir bo'sh bo'lmasa, SPA statik fayllar xizmati yoqiladi.
	WebDistDir string
}

// Handlers — REST handler metodlari shu strukturaga biriktiriladi.
type Handlers struct {
	deps *Deps
}

// ErrorHandler — Fiber freymvorki uchun yagona xato qayta ishlovchi.
// Barcha xatolar JSON formatda qaytariladi.
func ErrorHandler(c *fiber.Ctx, err error) error {
	code := fiber.StatusInternalServerError
	msg := "ichki xatolik"
	if e, ok := err.(*fiber.Error); ok {
		code = e.Code
		msg = e.Message
	}
	return c.Status(code).JSON(fiber.Map{"error": msg})
}

// audit — audit jurnaliga yozuv qo'shiladi.
// actorID bo'sh bo'lishi mumkin (tizim amallari uchun).
func (h *Handlers) audit(ctx context.Context, actorID, action string, target *string, ip string) error {
	_, err := h.deps.DB.Exec(ctx, `
		INSERT INTO audit_log (actor_id, action, target_id, ip_address)
		VALUES (NULLIF($1, '')::uuid, $2, NULLIF($3, '')::uuid, NULLIF($4, '')::inet)
	`, actorID, action, ifNil(target), ip)
	return err
}

// ifNil — string pointer'dan xavfsiz qiymat olish yordamchisi.
func ifNil(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// ChangePassword — parol almashtirish (kelajakda to'liq yoziladi).
func (h *Handlers) ChangePassword(c *fiber.Ctx) error {
	return fiber.NewError(fiber.StatusNotImplemented, "tez orada")
}

// Logout — JWT sessiyasi Redis'dan o'chiriladi.
func (h *Handlers) Logout(c *fiber.Ctx) error {
	jti, _ := c.Locals("jti").(string)
	if jti != "" {
		_ = h.deps.Cache.Del(c.Context(), "session:"+jti).Err()
	}
	return c.SendStatus(fiber.StatusNoContent)
}

// Me — joriy foydalanuvchining identifikatori va roli qaytariladi.
func (h *Handlers) Me(c *fiber.Ctx) error {
	uid, _ := c.Locals("user_id").(string)
	role, _ := c.Locals("role").(string)
	return c.JSON(fiber.Map{"user_id": uid, "role": role})
}

// RefillOneTimePreKeys — mijozdan yangi bir martalik kalitlar qabul qilinadi (kelajakda).
func (h *Handlers) RefillOneTimePreKeys(c *fiber.Ctx) error {
	return fiber.NewError(fiber.StatusNotImplemented, "tez orada")
}

// AdminAuditLog — oxirgi 200 ta audit yozuvi qaytariladi (faqat admin uchun).
func (h *Handlers) AdminAuditLog(c *fiber.Ctx) error {
	rows, err := h.deps.DB.Query(c.Context(),
		`SELECT id, actor_id::text, action, target_id::text, ip_address::text, created_at
		   FROM audit_log ORDER BY created_at DESC LIMIT 200`)
	if err != nil {
		return err
	}
	defer rows.Close()

	var out []fiber.Map
	for rows.Next() {
		var id int64
		var actor, action, target, ip string
		var created any
		_ = rows.Scan(&id, &actor, &action, &target, &ip, &created)
		out = append(out, fiber.Map{
			"id": id, "actor_id": actor, "action": action,
			"target_id": target, "ip": ip, "created_at": created,
		})
	}
	if out == nil {
		out = []fiber.Map{}
	}
	return c.JSON(out)
}
