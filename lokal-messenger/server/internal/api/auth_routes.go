// Fayl: server/internal/api/auth_routes.go
// Maqsad: Login va parol o'zgartirish marshrutlari xizmatga qo'yiladi.
package api

import (
	"errors"
	"fmt"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"

	"github.com/military/lokal-messenger/server/internal/auth"
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

// Login — foydalanuvchi ma'lumotlari tekshiriladi va JWT token chiqariladi.
// Brute-force'dan himoya: 5 daqiqada 5 ta urinishdan ortiq bo'lsa 429 qaytariladi.
func (h *Handlers) Login(c *fiber.Ctx) error {
	var req loginRequest
	if err := c.BodyParser(&req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "so'rov tanasi noto'g'ri")
	}

	// Kirish urinishlari soni cheklanadi (brute-force'dan himoya)
	rateKey := fmt.Sprintf("ratelimit:login:%s", c.IP())
	count, _ := h.deps.Cache.Incr(c.Context(), rateKey).Result()
	if count == 1 {
		h.deps.Cache.Expire(c.Context(), rateKey, 5*time.Minute)
	}
	if count > int64(h.deps.Config.Limits.RateLoginPer5Min) {
		return fiber.NewError(fiber.StatusTooManyRequests, "juda ko'p urinish")
	}

	// Foydalanuvchi ma'lumoti DB'dan olinadi
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
		// Muvaffaqiyatsiz urinish hisoblanadi va zarur bo'lsa hisob qulflanadi
		_, _ = h.deps.DB.Exec(c.Context(), `
			UPDATE users
			   SET failed_login_attempts = failed_login_attempts + 1,
			       locked_until = CASE WHEN failed_login_attempts + 1 >= 5
			                           THEN NOW() + INTERVAL '15 minutes'
			                           ELSE locked_until END
			 WHERE id = $1::uuid`, userID)
		return fiber.NewError(fiber.StatusUnauthorized, "login yoki parol noto'g'ri")
	}

	// Muvaffaqiyatli kirishda hisoblagich va qulf tozalanadi
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
	_ = h.deps.Cache.Set(c.Context(), "session:"+jti, userID,
		time.Duration(h.deps.Config.Auth.AccessTTLMinutes)*time.Minute).Err()

	// Audit jurnaliga muvaffaqiyatli kirish yoziladi
	_ = h.audit(c.Context(), userID, "login.success", nil, c.IP())

	return c.JSON(loginResponse{
		Token:              token,
		UserID:             userID,
		Role:               role,
		MustChangePassword: mustChange,
	})
}
