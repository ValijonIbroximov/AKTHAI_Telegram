// Fayl: server/internal/api/admin_routes.go
// Maqsad: Faqat admin foydalanuvchilarga ochiq amallar — hisob yaratish va boshqarish.
// Ochiq ro'yxatdan o'tish butunlay o'chirilgan; barcha hisoblar shu yerdan yaratiladi.
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
	Role        string `json:"role"`
	RankTitle   string `json:"rank_title"`
	UnitCode    string `json:"unit_code"`
}

type createUserResponse struct {
	UserID            string `json:"user_id"`
	TemporaryPassword string `json:"temporary_password"`
}

// AdminCreateUser — admin yangi foydalanuvchi hisobi yaratadi.
// Vaqtinchalik parol bir martalik chiqariladi; birinchi kirishda almashtirilishi talab qilinadi.
func (h *Handlers) AdminCreateUser(c *fiber.Ctx) error {
	var req createUserRequest
	if err := c.BodyParser(&req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "so'rov tanasi noto'g'ri")
	}
	if req.Role != "user" && req.Role != "admin" {
		return fiber.NewError(fiber.StatusBadRequest, "rol noto'g'ri: 'user' yoki 'admin' bo'lishi kerak")
	}

	// 16 baytli kriptografik jihatdan kuchli vaqtinchalik parol generatsiya qilinadi
	raw := make([]byte, 16)
	_, _ = rand.Read(raw)
	tempPass := base64.RawURLEncoding.EncodeToString(raw)

	// Parol Argon2id bilan xeshlanadi
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

	return c.Status(fiber.StatusCreated).JSON(createUserResponse{
		UserID:            newID,
		TemporaryPassword: tempPass,
	})
}

// AdminListUsers — admin barcha foydalanuvchilar ro'yxatini ko'radi.
func (h *Handlers) AdminListUsers(c *fiber.Ctx) error {
	rows, err := h.deps.DB.Query(c.Context(), `
		SELECT id::text, username, display_name, role,
		       COALESCE(rank_title, ''), COALESCE(unit_code, ''),
		       is_active
		FROM users
		ORDER BY created_at ASC
	`)
	if err != nil {
		return err
	}
	defer rows.Close()

	type userRow struct {
		ID          string `json:"id"`
		Username    string `json:"username"`
		DisplayName string `json:"display_name"`
		Role        string `json:"role"`
		RankTitle   string `json:"rank_title"`
		UnitCode    string `json:"unit_code"`
		IsActive    bool   `json:"is_active"`
	}

	var result []userRow
	for rows.Next() {
		var u userRow
		if err := rows.Scan(
			&u.ID, &u.Username, &u.DisplayName, &u.Role,
			&u.RankTitle, &u.UnitCode, &u.IsActive,
		); err != nil {
			return err
		}
		result = append(result, u)
	}
	if result == nil {
		result = []userRow{}
	}
	return c.JSON(result)
}

// AdminSetActive — admin foydalanuvchini bloklashi yoki faollashtirishi mumkin.
// is_active=false qilingan foydalanuvchi tizimga kira olmaydi.
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
