// Fayl: server/internal/api/auth_routes.go
// Maqsad: Login, parol o'zgartirish, logout va "me" marshrutlari xizmatga qo'yiladi.
package api

import (
	"errors"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
	"github.com/military/lokal-messenger/server/internal/auth"
	"github.com/military/lokal-messenger/server/internal/cache"
)

type loginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type loginResponse struct {
	Token              string `json:"token"`
	UserID             string `json:"user_id"`
	Role               string `json:"role"`
	MustChangePassword bool   `json:"must_change_password"`
}

// Login — foydalanuvchi tekshiriladi va muvaffaqiyatli bo'lsa sessiya tokeni chiqariladi.
func (h *Handlers) Login(c *fiber.Ctx) error {
	var req loginRequest
	if err := c.BodyParser(&req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "so'rov tanasi noto'g'ri")
	}

	// Kirish urinishlari soni IP bo'yicha cheklanadi (brute-force'dan himoya)
	rateKey := cache.LoginRateKey(c.IP())
	count, _ := h.deps.Cache.Incr(c.Context(), rateKey).Result()
	if count == 1 {
		h.deps.Cache.Expire(c.Context(), rateKey, 5*time.Minute)
	}
	if count > int64(h.deps.Config.Limits.RateLoginPer5Min) {
		return fiber.NewError(fiber.StatusTooManyRequests, "juda ko'p urinish")
	}

	// Foydalanuvchi ma'lumoti bazadan olinadi
	var (
		userID, hash, role string
		active             bool
		mustChange         bool
		lockedUntil        *time.Time
	)
	err := h.deps.DB.QueryRow(c.Context(), `
        SELECT id::text, password_hash, role, is_active, must_change_password, locked_until
          FROM users
         WHERE username = $1
    `, req.Username).Scan(&userID, &hash, &role, &active, &mustChange, &lockedUntil)

	if errors.Is(err, pgx.ErrNoRows) {
		return fiber.NewError(fiber.StatusUnauthorized, "login yoki parol noto'g'ri")
	}
	if err != nil {
		return err
	}
	if !active {
		return fiber.NewError(fiber.StatusForbidden, "hisob bloklangan")
	}
	if lockedUntil != nil && lockedUntil.After(time.Now()) {
		return fiber.NewError(fiber.StatusForbidden, "hisob vaqtincha bloklangan")
	}

	// Parol Argon2id orqali tekshiriladi
	ok, _ := auth.VerifyPassword(req.Password, hash)
	if !ok {
		// Muvaffaqiyatsiz urinish hisoblanadi va kerak bo'lsa hisob qulflanadi
		_, _ = h.deps.DB.Exec(c.Context(), `
            UPDATE users
               SET failed_login_attempts = failed_login_attempts + 1,
                   locked_until = CASE WHEN failed_login_attempts + 1 >= 5
                                       THEN NOW() + INTERVAL '15 minutes'
                                       ELSE locked_until END
             WHERE id = $1::uuid`, userID)
		_ = h.audit(c.Context(), userID, "login.fail", nil, c.IP())
		return fiber.NewError(fiber.StatusUnauthorized, "login yoki parol noto'g'ri")
	}

	// Muvaffaqiyatli kirishda hisoblagich tozalanadi va oxirgi faollik yangilanadi
	_, _ = h.deps.DB.Exec(c.Context(), `
        UPDATE users
           SET failed_login_attempts = 0,
               locked_until = NULL,
               last_seen_at = NOW()
         WHERE id = $1::uuid`, userID)

	// Token chiqariladi va sessiya Redis'ga yoziladi
	token, jti, err := h.deps.JWT.Issue(userID, role)
	if err != nil {
		return err
	}
	_ = h.deps.Cache.Set(c.Context(), cache.SessionKey(jti), userID, h.deps.JWT.TTL()).Err()

	// Audit jurnaliga muvaffaqiyatli kirish yoziladi
	_ = h.audit(c.Context(), userID, "login.success", nil, c.IP())

	return c.JSON(loginResponse{
		Token:              token,
		UserID:             userID,
		Role:               role,
		MustChangePassword: mustChange,
	})
}

type changePasswordRequest struct {
	CurrentPassword string `json:"current_password"`
	NewPassword     string `json:"new_password"`
}

// ChangePassword — foydalanuvchi o'z parolini almashtiradi (birinchi kirishda majburiy).
func (h *Handlers) ChangePassword(c *fiber.Ctx) error {
	userID, _ := c.Locals("user_id").(string)

	var req changePasswordRequest
	if err := c.BodyParser(&req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "so'rov tanasi noto'g'ri")
	}
	if len(req.NewPassword) < 10 {
		return fiber.NewError(fiber.StatusBadRequest, "yangi parol kamida 10 belgidan iborat bo'lishi kerak")
	}

	// Joriy parol tekshiriladi
	var hash string
	err := h.deps.DB.QueryRow(c.Context(),
		`SELECT password_hash FROM users WHERE id = $1::uuid`, userID).Scan(&hash)
	if err != nil {
		return err
	}
	ok, _ := auth.VerifyPassword(req.CurrentPassword, hash)
	if !ok {
		return fiber.NewError(fiber.StatusForbidden, "joriy parol noto'g'ri")
	}

	// Yangi parol xeshlanadi va saqlanadi; majburiy almashtirish bayrog'i o'chiriladi
	newHash, err := auth.HashPassword(req.NewPassword, h.deps.Config.Auth.Argon2)
	if err != nil {
		return err
	}
	_, err = h.deps.DB.Exec(c.Context(), `
        UPDATE users SET password_hash = $1, must_change_password = FALSE WHERE id = $2::uuid
    `, newHash, userID)
	if err != nil {
		return err
	}

	_ = h.audit(c.Context(), userID, "auth.password.change", nil, c.IP())
	return c.SendStatus(fiber.StatusNoContent)
}

// Logout — joriy sessiya Redis'dan o'chiriladi (token darhol bekor qilinadi).
func (h *Handlers) Logout(c *fiber.Ctx) error {
	jti, _ := c.Locals("jti").(string)
	if jti != "" {
		_ = h.deps.Cache.Del(c.Context(), cache.SessionKey(jti)).Err()
	}
	return c.SendStatus(fiber.StatusNoContent)
}

// Me — joriy foydalanuvchi haqidagi asosiy ma'lumotlar qaytariladi.
func (h *Handlers) Me(c *fiber.Ctx) error {
	uid, _ := c.Locals("user_id").(string)

	var username, displayName, role string
	var rank, unit *string
	var mustChange bool
	err := h.deps.DB.QueryRow(c.Context(), `
        SELECT username, display_name, role, rank_title, unit_code, must_change_password
          FROM users WHERE id = $1::uuid
    `, uid).Scan(&username, &displayName, &role, &rank, &unit, &mustChange)
	if err != nil {
		return err
	}
	return c.JSON(fiber.Map{
		"user_id":              uid,
		"username":             username,
		"display_name":         displayName,
		"role":                 role,
		"rank_title":           rank,
		"unit_code":            unit,
		"must_change_password": mustChange,
	})
}
