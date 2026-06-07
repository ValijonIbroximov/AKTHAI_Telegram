// Profil ko'rish/tahrirlash, surat yuklash va admin ruxsatlari.
package api

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
)

const maxAvatarBytes = 2 << 20 // 2 MB

func avatarsDir() (string, error) {
	dir, err := uploadsDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "avatars"), nil
}

func avatarFilePath(userID, ext string) (string, error) {
	dir, err := avatarsDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, userID+ext), nil
}

func userHasAvatarPath(avatarPath *string) bool {
	return avatarPath != nil && *avatarPath != ""
}

// GetMyProfile — joriy foydalanuvchi profili va qaysi maydonlar tahrirlanishi mumkinligi.
func (h *Handlers) GetMyProfile(c *fiber.Ctx) error {
	uid, _ := c.Locals("user_id").(string)
	policy, err := getProfileEditPolicy(c.Context(), h.deps.DB)
	if err != nil {
		return err
	}

	var (
		username, displayName, role string
		rank, unit, okrugName, okrugCode, unitName, divName, divCode, displayShort *string
		avatarPath *string
		hideLastSeen bool
	)
	err = h.deps.DB.QueryRow(c.Context(), `
		SELECT username, display_name, role,
		       rank_title, unit_code, okrug_name, okrug_code,
		       unit_name, division_name, division_code, display_short,
		       avatar_path, COALESCE(hide_last_seen, FALSE)
		  FROM users WHERE id = $1::uuid AND is_active = TRUE
	`, uid).Scan(
		&username, &displayName, &role,
		&rank, &unit, &okrugName, &okrugCode, &unitName, &divName, &divCode, &displayShort,
		&avatarPath, &hideLastSeen,
	)
	if err != nil {
		return fiber.NewError(fiber.StatusNotFound, "foydalanuvchi topilmadi")
	}

	hasAvatar := userHasAvatarPath(avatarPath)
	return c.JSON(fiber.Map{
		"id":            uid,
		"username":      username,
		"display_name":  displayName,
		"role":          role,
		"rank_title":    rank,
		"unit_code":     unit,
		"okrug_name":    okrugName,
		"okrug_code":    okrugCode,
		"unit_name":     unitName,
		"division_name": divName,
		"division_code": divCode,
		"display_short": displayShort,
		"has_avatar":    hasAvatar,
		"hide_last_seen": hideLastSeen,
		"editable":      policy,
	})
}

// UpdateMyProfile — faqat admin ruxsat bergan maydonlar yangilanadi.
func (h *Handlers) UpdateMyProfile(c *fiber.Ctx) error {
	uid, _ := c.Locals("user_id").(string)
	policy, err := getProfileEditPolicy(c.Context(), h.deps.DB)
	if err != nil {
		return err
	}

	var req map[string]string
	if err := c.BodyParser(&req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "so'rov noto'g'ri")
	}

	setParts := []string{}
	args := []any{uid}
	argN := 2

	addField := func(key, col string) {
		if !policy[key] {
			return
		}
		if v, ok := req[key]; ok {
			setParts = append(setParts, fmt.Sprintf("%s = NULLIF($%d, '')", col, argN))
			args = append(args, strings.TrimSpace(v))
			argN++
		}
	}

	addField("display_name", "display_name")
	addField("display_short", "display_short")
	addField("rank_title", "rank_title")
	addField("unit_code", "unit_code")
	addField("unit_name", "unit_name")
	addField("okrug_name", "okrug_name")
	addField("okrug_code", "okrug_code")
	addField("division_name", "division_name")
	addField("division_code", "division_code")

	if len(setParts) == 0 {
		return fiber.NewError(fiber.StatusBadRequest, "tahrirlashga ruxsat berilgan maydon yo'q")
	}

	query := "UPDATE users SET " + strings.Join(setParts, ", ") + " WHERE id = $1::uuid AND is_active = TRUE"
	tag, err := h.deps.DB.Exec(c.Context(), query, args...)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fiber.NewError(fiber.StatusNotFound, "yangilanmadi")
	}
	return c.SendStatus(fiber.StatusNoContent)
}

// UploadMyAvatar — profil surati (JPEG/PNG/WebP, max 2MB).
func (h *Handlers) UploadMyAvatar(c *fiber.Ctx) error {
	uid, _ := c.Locals("user_id").(string)
	policy, err := getProfileEditPolicy(c.Context(), h.deps.DB)
	if err != nil {
		return err
	}
	if !policy["avatar"] {
		return fiber.NewError(fiber.StatusForbidden, "surat yuklashga ruxsat yo'q")
	}

	file, err := c.FormFile("avatar")
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "avatar fayli talab qilinadi")
	}
	if file.Size > maxAvatarBytes {
		return fiber.NewError(fiber.StatusBadRequest, "fayl 2MB dan katta")
	}

	f, err := file.Open()
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "fayl ochilmadi")
	}
	defer f.Close()

	data, err := io.ReadAll(io.LimitReader(f, maxAvatarBytes+1))
	if err != nil {
		return err
	}

	ext, _, ok := detectAvatarFormat(data, file.Header.Get("Content-Type"))
	if !ok {
		return fiber.NewError(fiber.StatusBadRequest, "faqat JPEG, PNG yoki WebP")
	}

	dir, err := avatarsDir()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return internalError("avatar mkdir", err)
	}

	// Eski formatdagi fayllarni tozalash
	for _, oldExt := range []string{".jpg", ".jpeg", ".png", ".webp"} {
		_ = os.Remove(filepath.Join(dir, uid+oldExt))
	}

	dest, err := avatarFilePath(uid, ext)
	if err != nil {
		return err
	}
	if err := os.WriteFile(dest, data, 0o640); err != nil {
		return internalError("avatar write", err)
	}

	relPath := filepath.ToSlash(filepath.Join("avatars", uid+ext))
	if _, err := h.deps.DB.Exec(c.Context(),
		`UPDATE users SET avatar_path = $1 WHERE id = $2::uuid`, relPath, uid,
	); err != nil {
		return err
	}

	return c.JSON(fiber.Map{"has_avatar": true})
}

func detectAvatarFormat(data []byte, headerCT string) (ext, contentType string, ok bool) {
	if len(data) >= 3 && data[0] == 0xFF && data[1] == 0xD8 && data[2] == 0xFF {
		return ".jpg", "image/jpeg", true
	}
	if len(data) >= 8 && string(data[0:8]) == "\x89PNG\r\n\x1a\n" {
		return ".png", "image/png", true
	}
	if len(data) >= 12 && string(data[0:4]) == "RIFF" && string(data[8:12]) == "WEBP" {
		return ".webp", "image/webp", true
	}
	ct := strings.ToLower(strings.Split(headerCT, ";")[0])
	switch ct {
	case "image/jpeg":
		return ".jpg", "image/jpeg", true
	case "image/png":
		return ".png", "image/png", true
	case "image/webp":
		return ".webp", "image/webp", true
	}
	return "", "", false
}

// GetUserAvatar — profil surati (autentifikatsiya talab qilinadi).
func (h *Handlers) GetUserAvatar(c *fiber.Ctx) error {
	targetID := c.Params("id")
	var avatarPath *string
	err := h.deps.DB.QueryRow(c.Context(),
		`SELECT avatar_path FROM users WHERE id = $1::uuid AND is_active = TRUE`, targetID,
	).Scan(&avatarPath)
	if err != nil || avatarPath == nil || *avatarPath == "" {
		return fiber.NewError(fiber.StatusNotFound, "surat yo'q")
	}

	base, err := uploadsDir()
	if err != nil {
		return err
	}
	full := filepath.Join(base, filepath.FromSlash(*avatarPath))
	data, err := os.ReadFile(full)
	if err != nil {
		return fiber.NewError(fiber.StatusNotFound, "surat topilmadi")
	}

	ct := "image/jpeg"
	switch strings.ToLower(filepath.Ext(full)) {
	case ".png":
		ct = "image/png"
	case ".webp":
		ct = "image/webp"
	}
	c.Set("Cache-Control", "private, max-age=300")
	return c.Type(ct).Send(data)
}

// DeleteMyAvatar — profil suratini o'chirish.
func (h *Handlers) DeleteMyAvatar(c *fiber.Ctx) error {
	uid, _ := c.Locals("user_id").(string)
	policy, err := getProfileEditPolicy(c.Context(), h.deps.DB)
	if err != nil {
		return err
	}
	if !policy["avatar"] {
		return fiber.NewError(fiber.StatusForbidden, "surat o'chirishga ruxsat yo'q")
	}

	var avatarPath *string
	_ = h.deps.DB.QueryRow(c.Context(),
		`SELECT avatar_path FROM users WHERE id = $1::uuid`, uid,
	).Scan(&avatarPath)

	if avatarPath != nil && *avatarPath != "" {
		base, _ := uploadsDir()
		_ = os.Remove(filepath.Join(base, filepath.FromSlash(*avatarPath)))
	}
	_, _ = h.deps.DB.Exec(c.Context(),
		`UPDATE users SET avatar_path = NULL WHERE id = $1::uuid`, uid,
	)
	return c.SendStatus(fiber.StatusNoContent)
}

// AdminGetProfilePolicy — profil tahrirlash ruxsatlari.
func (h *Handlers) AdminGetProfilePolicy(c *fiber.Ctx) error {
	policy, err := getProfileEditPolicy(c.Context(), h.deps.DB)
	if err != nil {
		return err
	}
	return c.JSON(fiber.Map{"policy": policy, "fields": profileFieldKeys})
}

// AdminSetProfilePolicy — admin qaysi maydonlar tahrirlanishini belgilaydi.
func (h *Handlers) AdminSetProfilePolicy(c *fiber.Ctx) error {
	var body struct {
		Policy map[string]bool `json:"policy"`
	}
	if err := c.BodyParser(&body); err != nil || body.Policy == nil {
		return fiber.NewError(fiber.StatusBadRequest, "policy talab qilinadi")
	}
	if err := setProfileEditPolicy(c.Context(), h.deps.DB, body.Policy); err != nil {
		return err
	}
	actorID, _ := c.Locals("user_id").(string)
	_ = h.audit(c.Context(), actorID, "admin.profile_policy.update", nil, c.IP())
	return c.SendStatus(fiber.StatusNoContent)
}
