// Fayl: server/internal/api/admin_routes.go
// Maqsad: Faqat admin foydalanuvchilarga ochiq amallar — hisob yaratish va boshqarish.
package api

import (
	"crypto/rand"
	"encoding/base64"

	"github.com/gofiber/fiber/v2"
	"github.com/military/lokal-messenger/server/internal/auth"
)

type createUserRequest struct {
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
	Role        string `json:"role"` // 'user' yoki 'admin'
	RankTitle   string `json:"rank_title"`
	UnitCode    string `json:"unit_code"`
}

type createUserResponse struct {
	UserID            string `json:"user_id"`
	TemporaryPassword string `json:"temporary_password"`
}

// AdminCreateUser — admin yangi foydalanuvchi hisobi yaratadi.
// Vaqtinchalik parol bir martalik chiqariladi va birinchi kirishda almashtiriladi.
func (h *Handlers) AdminCreateUser(c *fiber.Ctx) error {
	var req createUserRequest
	if err := c.BodyParser(&req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "so'rov tanasi noto'g'ri")
	}
	if req.Username == "" || req.DisplayName == "" {
		return fiber.NewError(fiber.StatusBadRequest, "login va ism majburiy")
	}
	if req.Role != "user" && req.Role != "admin" {
		return fiber.NewError(fiber.StatusBadRequest, "rol noto'g'ri")
	}

	// 16 baytli kuchli vaqtinchalik parol generatsiya qilinadi
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		return err
	}
	tempPass := base64.RawURLEncoding.EncodeToString(raw)

	hash, err := auth.HashPassword(tempPass, h.deps.Config.Auth.Argon2)
	if err != nil {
		return err
	}

	var newID string
	err = h.deps.DB.QueryRow(c.Context(), `
        INSERT INTO users
            (username, password_hash, display_name, role, rank_title, unit_code, must_change_password)
        VALUES ($1, $2, $3, $4, NULLIF($5,''), NULLIF($6,''), TRUE)
        RETURNING id::text
    `, req.Username, hash, req.DisplayName, req.Role, req.RankTitle, req.UnitCode).Scan(&newID)
	if err != nil {
		return fiber.NewError(fiber.StatusConflict, "foydalanuvchi yaratilmadi: "+err.Error())
	}

	actorID, _ := c.Locals("user_id").(string)
	_ = h.audit(c.Context(), actorID, "admin.user.create", &newID, c.IP())

	// Vaqtinchalik parol faqat shu javobda bir marta ko'rsatiladi
	return c.Status(fiber.StatusCreated).JSON(createUserResponse{
		UserID:            newID,
		TemporaryPassword: tempPass,
	})
}

// AdminSetActive — admin foydalanuvchini bloklashi yoki qayta faollashtirishi mumkin.
func (h *Handlers) AdminSetActive(c *fiber.Ctx) error {
	targetID := c.Params("id")
	var body struct {
		IsActive bool `json:"is_active"`
	}
	if err := c.BodyParser(&body); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "so'rov noto'g'ri")
	}
	_, err := h.deps.DB.Exec(c.Context(), `
        UPDATE users SET is_active = $1 WHERE id = $2::uuid
    `, body.IsActive, targetID)
	if err != nil {
		return err
	}
	actorID, _ := c.Locals("user_id").(string)
	_ = h.audit(c.Context(), actorID, "admin.user.set_active", &targetID, c.IP())
	return c.SendStatus(fiber.StatusNoContent)
}

// AdminResetPassword — admin foydalanuvchiga yangi vaqtinchalik parol beradi.
func (h *Handlers) AdminResetPassword(c *fiber.Ctx) error {
	targetID := c.Params("id")

	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		return err
	}
	tempPass := base64.RawURLEncoding.EncodeToString(raw)
	hash, err := auth.HashPassword(tempPass, h.deps.Config.Auth.Argon2)
	if err != nil {
		return err
	}

	tag, err := h.deps.DB.Exec(c.Context(), `
        UPDATE users
           SET password_hash = $1,
               must_change_password = TRUE,
               failed_login_attempts = 0,
               locked_until = NULL
         WHERE id = $2::uuid
    `, hash, targetID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fiber.NewError(fiber.StatusNotFound, "foydalanuvchi topilmadi")
	}

	actorID, _ := c.Locals("user_id").(string)
	_ = h.audit(c.Context(), actorID, "admin.user.reset_password", &targetID, c.IP())
	return c.JSON(fiber.Map{"temporary_password": tempPass})
}

// AdminAuditLog — so'nggi audit yozuvlari qaytariladi.
func (h *Handlers) AdminAuditLog(c *fiber.Ctx) error {
	rows, err := h.deps.DB.Query(c.Context(), `
        SELECT id, COALESCE(actor_id::text, ''), action,
               COALESCE(target_id::text, ''), COALESCE(ip_address::text, ''), created_at
          FROM audit_log
         ORDER BY created_at DESC
         LIMIT 200`)
	if err != nil {
		return err
	}
	defer rows.Close()

	out := make([]fiber.Map, 0, 200)
	for rows.Next() {
		var id int64
		var actor, action, target, ip string
		var created any
		if err := rows.Scan(&id, &actor, &action, &target, &ip, &created); err != nil {
			continue
		}
		out = append(out, fiber.Map{
			"id": id, "actor_id": actor, "action": action,
			"target_id": target, "ip": ip, "created_at": created,
		})
	}
	return c.JSON(out)
}
