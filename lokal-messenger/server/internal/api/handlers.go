// Fayl: server/internal/api/handlers.go
// Maqsad: Barcha REST handlerlar uchun umumiy bog'liqliklar konteyneri va
//         yordamchi handlerlar to'plami saqlanadi.
package api

import (
	"context"
	"log"
	"time"

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
		if code >= fiber.StatusInternalServerError {
			log.Printf("[API] ERROR %s %s → %d: %s", c.Method(), c.Path(), code, e.Message)
		}
	} else {
		log.Printf("[API] ERROR %s %s → 500: %v", c.Method(), c.Path(), err)
	}
	return c.Status(code).JSON(fiber.Map{"error": msg})
}

// internalError — ichki xatolikni log qilib, mijozga xavfsiz javob qaytaradi.
func internalError(step string, err error) error {
	if err == nil {
		return nil
	}
	log.Printf("[API] ERROR %s: %v", step, err)
	return fiber.NewError(fiber.StatusInternalServerError, "ichki xatolik")
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

// Logout — JWT sessiyasi Redis'dan o'chiriladi.
func (h *Handlers) Logout(c *fiber.Ctx) error {
	jti, _ := c.Locals("jti").(string)
	userID, _ := c.Locals("user_id").(string)
	if jti != "" {
		h.untrackSession(c.Context(), userID, jti)
	}
	return c.SendStatus(fiber.StatusNoContent)
}

// Me — joriy foydalanuvchining identifikatori, roli va maxfiylik sozlamalari.
func (h *Handlers) Me(c *fiber.Ctx) error {
	uid, _ := c.Locals("user_id").(string)
	role, _ := c.Locals("role").(string)

	var hideLastSeen bool
	var canCreateChannel, canCreateGroup bool
	if err := h.deps.DB.QueryRow(c.Context(),
		`SELECT COALESCE(hide_last_seen, FALSE),
		        COALESCE(can_create_channel, TRUE),
		        COALESCE(can_create_group, TRUE)
		   FROM users WHERE id = $1::uuid`, uid,
	).Scan(&hideLastSeen, &canCreateChannel, &canCreateGroup); err != nil {
		return internalError("[ME] users query", err)
	}

	return c.JSON(fiber.Map{
		"user_id":            uid,
		"role":               role,
		"hide_last_seen":     hideLastSeen,
		"can_create_channel": canCreateChannel,
		"can_create_group":   canCreateGroup,
	})
}

type privacySettingsRequest struct {
	HideLastSeen *bool `json:"hide_last_seen"`
}

// UpdatePrivacy — so'nggi faollikni yashirish kabi maxfiylik sozlamalarini yangilaydi.
func (h *Handlers) UpdatePrivacy(c *fiber.Ctx) error {
	uid, _ := c.Locals("user_id").(string)

	var req privacySettingsRequest
	if err := c.BodyParser(&req); err != nil || req.HideLastSeen == nil {
		return fiber.NewError(fiber.StatusBadRequest, "hide_last_seen talab qilinadi")
	}

	if _, err := h.deps.DB.Exec(c.Context(),
		`UPDATE users SET hide_last_seen = $1 WHERE id = $2::uuid`, *req.HideLastSeen, uid,
	); err != nil {
		return internalError("[PRIVACY] update", err)
	}

	// Offline bo'lsa va yashirish o'chirilsa — oxirgi faollikni yangilash (ixtiyoriy ko'rinish)
	if !*req.HideLastSeen && !h.deps.Hub.IsOnline(uid) {
		var lastSeen time.Time
		if err := h.deps.DB.QueryRow(c.Context(),
			`SELECT last_seen_at FROM users WHERE id = $1::uuid`, uid,
		).Scan(&lastSeen); err == nil && !lastSeen.IsZero() {
			h.deps.Hub.BroadcastPresence(uid, false, &lastSeen)
		}
	} else if *req.HideLastSeen {
		h.deps.Hub.BroadcastPresenceHidden(uid, false)
	}

	return c.JSON(fiber.Map{"hide_last_seen": *req.HideLastSeen})
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
