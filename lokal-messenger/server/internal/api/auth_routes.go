// Fayl: server/internal/api/auth_routes.go
// Maqsad: Login va parol o'zgartirish marshrutlari xizmatga qo'yiladi.
package api

import (
	"errors"
	"fmt"
	"log"
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
	if req.Username == "" || req.Password == "" {
		return fiber.NewError(fiber.StatusBadRequest, "login va parol ko'rsatilishi shart")
	}

	// Kirish urinishlari soni cheklanadi (brute-force'dan himoya)
	rateKey := fmt.Sprintf("ratelimit:login:%s", c.IP())
	count, err := h.deps.Cache.Incr(c.Context(), rateKey).Result()
	if err != nil {
		// Redis vaqtincha ishlamasa login bloklanmasin (fail-open)
		log.Printf("[AUTH] WARNING Redis rate-limit o'tkazib yuborildi: %v", err)
	} else {
		if count == 1 {
			if expErr := h.deps.Cache.Expire(c.Context(), rateKey, 5*time.Minute).Err(); expErr != nil {
				log.Printf("[AUTH] WARNING Redis Expire: %v", expErr)
			}
		}
		limit := h.deps.Config.Limits.RateLoginPer5Min
		if limit <= 0 {
			limit = 500
		}
		if count > int64(limit) {
			return fiber.NewError(fiber.StatusTooManyRequests, "juda ko'p urinish")
		}
	}

	// Foydalanuvchi ma'lumoti DB'dan olinadi
	var (
		userID, hash, role string
		active             bool
		mustChange         bool
		lockedUntil        *time.Time
	)
	err = h.deps.DB.QueryRow(c.Context(), `
		SELECT id::text, password_hash, role, is_active, must_change_password, locked_until
		  FROM users
		 WHERE username = $1
	`, req.Username).Scan(&userID, &hash, &role, &active, &mustChange, &lockedUntil)

	if errors.Is(err, pgx.ErrNoRows) {
		return fiber.NewError(fiber.StatusUnauthorized, "login yoki parol noto'g'ri")
	}
	if err != nil {
		return internalError("[AUTH] login users query", err)
	}
	if !active {
		return fiber.NewError(fiber.StatusForbidden, "hisob bloklangan")
	}
	if lockedUntil != nil && lockedUntil.After(time.Now()) {
		return fiber.NewError(fiber.StatusForbidden, "hisob vaqtincha bloklangan")
	}

	// Parol Argon2id orqali tekshiriladi
	ok, verifyErr := auth.VerifyPassword(req.Password, hash)
	if verifyErr != nil {
		log.Printf("[AUTH] ERROR password hash format (user=%s): %v", req.Username, verifyErr)
		return fiber.NewError(fiber.StatusUnauthorized, "login yoki parol noto'g'ri")
	}
	if !ok {
		// Muvaffaqiyatsiz urinish hisoblanadi va zarur bo'lsa hisob qulflanadi
		if _, execErr := h.deps.DB.Exec(c.Context(), `
			UPDATE users
			   SET failed_login_attempts = failed_login_attempts + 1,
			       locked_until = CASE WHEN failed_login_attempts + 1 >= 5
			                           THEN NOW() + INTERVAL '15 minutes'
			                           ELSE locked_until END
			 WHERE id = $1::uuid`, userID); execErr != nil {
			log.Printf("[AUTH] WARNING failed_login_attempts update: %v", execErr)
		}
		return fiber.NewError(fiber.StatusUnauthorized, "login yoki parol noto'g'ri")
	}

	// Muvaffaqiyatli kirishda hisoblagich va qulf tozalanadi
	if _, execErr := h.deps.DB.Exec(c.Context(), `
		UPDATE users
		   SET failed_login_attempts = 0,
		       locked_until = NULL,
		       last_seen_at = NOW()
		 WHERE id = $1::uuid`, userID); execErr != nil {
		log.Printf("[AUTH] WARNING login success update: %v", execErr)
	}

	// Token chiqariladi va sessiya Redis'ga yoziladi
	token, jti, err := h.deps.JWT.Issue(userID, role)
	if err != nil {
		return internalError("[AUTH] JWT issue", err)
	}
	ttl := time.Duration(h.deps.Config.Auth.AccessTTLMinutes) * time.Minute
	if ttl <= 0 {
		ttl = 12 * time.Hour
	}
	if err := h.deps.Cache.Set(c.Context(), "session:"+jti, userID, ttl).Err(); err != nil {
		return internalError("[AUTH] Redis session set", err)
	}

	// Audit jurnaliga muvaffaqiyatli kirish yoziladi
	if auditErr := h.audit(c.Context(), userID, "login.success", nil, c.IP()); auditErr != nil {
		log.Printf("[AUTH] WARNING audit login.success: %v", auditErr)
	}

	return c.JSON(loginResponse{
		Token:              token,
		UserID:             userID,
		Role:               role,
		MustChangePassword: mustChange,
	})
}

type changePasswordRequest struct {
	OldPassword string `json:"old_password"`
	NewPassword string `json:"new_password"`
}

// ChangePassword — eski parol tekshiriladi, yangi parol Argon2id bilan saqlanadi.
func (h *Handlers) ChangePassword(c *fiber.Ctx) error {
	userID, _ := c.Locals("user_id").(string)
	if userID == "" {
		return fiber.NewError(fiber.StatusUnauthorized, "autentifikatsiya talab qilinadi")
	}

	var req changePasswordRequest
	if err := c.BodyParser(&req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "so'rov tanasi noto'g'ri")
	}
	if len(req.OldPassword) < 1 {
		return fiber.NewError(fiber.StatusBadRequest, "eski parol ko'rsatilmagan")
	}
	if len(req.NewPassword) < 8 {
		return fiber.NewError(fiber.StatusBadRequest, "yangi parol kamida 8 belgidan iborat bo'lishi kerak")
	}
	if req.OldPassword == req.NewPassword {
		return fiber.NewError(fiber.StatusBadRequest, "yangi parol eskisidan farq qilishi kerak")
	}

	var hash string
	err := h.deps.DB.QueryRow(c.Context(), `
		SELECT password_hash FROM users WHERE id = $1::uuid AND is_active = TRUE
	`, userID).Scan(&hash)
	if errors.Is(err, pgx.ErrNoRows) {
		return fiber.NewError(fiber.StatusNotFound, "foydalanuvchi topilmadi")
	}
	if err != nil {
		return internalError("[AUTH] change-password query", err)
	}

	ok, verifyErr := auth.VerifyPassword(req.OldPassword, hash)
	if verifyErr != nil {
		log.Printf("[AUTH] ERROR change-password hash format (user=%s): %v", userID, verifyErr)
		return fiber.NewError(fiber.StatusUnauthorized, "eski parol noto'g'ri")
	}
	if !ok {
		return fiber.NewError(fiber.StatusUnauthorized, "eski parol noto'g'ri")
	}

	newHash, err := auth.HashPassword(req.NewPassword, h.deps.Config.Auth.Argon2)
	if err != nil {
		return internalError("[AUTH] hash new password", err)
	}

	_, err = h.deps.DB.Exec(c.Context(), `
		UPDATE users
		   SET password_hash = $2,
		       must_change_password = FALSE,
		       failed_login_attempts = 0,
		       locked_until = NULL
		 WHERE id = $1::uuid
	`, userID, newHash)
	if err != nil {
		return internalError("[AUTH] change-password update", err)
	}

	if auditErr := h.audit(c.Context(), userID, "password.change", nil, c.IP()); auditErr != nil {
		log.Printf("[AUTH] WARNING audit password.change: %v", auditErr)
	}
	return c.SendStatus(fiber.StatusNoContent)
}
