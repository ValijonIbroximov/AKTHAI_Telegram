// Guruh a'zolari, taklif havolalari va guruh kalit konvertlari.
package api

import (
	"crypto/rand"
	"encoding/hex"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
)

type keyEnvelopeInput struct {
	UserID     string `json:"user_id"`
	Ciphertext string `json:"ciphertext"`
}

func (h *Handlers) groupMemberRole(ctx *fiber.Ctx, chatID, userID string) (string, error) {
	var role string
	err := h.deps.DB.QueryRow(ctx.Context(), `
		SELECT role FROM chat_members
		 WHERE chat_id = $1::uuid AND user_id = $2::uuid
	`, chatID, userID).Scan(&role)
	return role, err
}

func (h *Handlers) requireGroupManager(ctx *fiber.Ctx, chatID, selfID string) error {
	var chatType string
	if err := h.deps.DB.QueryRow(ctx.Context(),
		`SELECT type FROM chats WHERE id = $1::uuid`, chatID,
	).Scan(&chatType); err != nil || chatType != "group" {
		return fiber.NewError(fiber.StatusNotFound, "guruh topilmadi")
	}
	role, err := h.groupMemberRole(ctx, chatID, selfID)
	if err != nil || (role != "owner" && role != "admin") {
		return fiber.NewError(fiber.StatusForbidden, "guruhni boshqarish huquqi yo'q")
	}
	return nil
}

func (h *Handlers) isGroupMember(ctx *fiber.Ctx, chatID, userID string) bool {
	var ok bool
	_ = h.deps.DB.QueryRow(ctx.Context(), `
		SELECT EXISTS(
			SELECT 1 FROM chat_members cm
			 JOIN chats ch ON ch.id = cm.chat_id AND ch.type = 'group'
			 WHERE cm.chat_id = $1::uuid AND cm.user_id = $2::uuid
		)
	`, chatID, userID).Scan(&ok)
	return ok
}

func (h *Handlers) memberHasGroupKey(ctx *fiber.Ctx, chatID, userID string) bool {
	var ok bool
	_ = h.deps.DB.QueryRow(ctx.Context(), `
		SELECT EXISTS(
		  SELECT 1 FROM group_key_envelopes
		   WHERE chat_id = $1::uuid AND user_id = $2::uuid
		) OR EXISTS(
		  SELECT 1 FROM group_key_vault
		   WHERE chat_id = $1::uuid AND updated_by = $2::uuid
		)
	`, chatID, userID).Scan(&ok)
	return ok
}

func (h *Handlers) requireGroupKeySharer(ctx *fiber.Ctx, chatID, selfID string) error {
	if !h.isGroupMember(ctx, chatID, selfID) {
		return fiber.NewError(fiber.StatusForbidden, "siz bu guruh a'zosi emassiz")
	}
	role, err := h.groupMemberRole(ctx, chatID, selfID)
	if err != nil {
		return fiber.NewError(fiber.StatusForbidden, "siz bu guruh a'zosi emassiz")
	}
	if role == "owner" || role == "admin" || h.memberHasGroupKey(ctx, chatID, selfID) {
		return nil
	}
	return fiber.NewError(fiber.StatusForbidden, "guruh kalitini ulashish uchun kalit kerak")
}

func (h *Handlers) persistGroupKeyRequest(ctx *fiber.Ctx, chatID, memberID string) {
	_, _ = h.deps.DB.Exec(ctx.Context(), `
		INSERT INTO group_key_requests (chat_id, user_id, requested_at)
		VALUES ($1::uuid, $2::uuid, NOW())
		ON CONFLICT (chat_id, user_id) DO UPDATE SET requested_at = NOW()
	`, chatID, memberID)
}

func (h *Handlers) clearGroupKeyRequest(ctx *fiber.Ctx, chatID, memberID string) {
	_, _ = h.deps.DB.Exec(ctx.Context(), `
		DELETE FROM group_key_requests WHERE chat_id = $1::uuid AND user_id = $2::uuid
	`, chatID, memberID)
}

func storeKeyEnvelopes(ctx *fiber.Ctx, h *Handlers, chatID, fromUserID string, envelopes []keyEnvelopeInput) error {
	for _, env := range envelopes {
		if env.UserID == "" || strings.TrimSpace(env.Ciphertext) == "" {
			continue
		}
		_, err := h.deps.DB.Exec(ctx.Context(), `
			INSERT INTO group_key_envelopes (chat_id, user_id, from_user_id, ciphertext)
			VALUES ($1::uuid, $2::uuid, $3::uuid, $4)
			ON CONFLICT (chat_id, user_id) DO UPDATE
			  SET ciphertext = EXCLUDED.ciphertext, from_user_id = EXCLUDED.from_user_id
		`, chatID, env.UserID, fromUserID, env.Ciphertext)
		if err != nil {
			return err
		}
	}
	return nil
}

// ListGroupMembers — guruh a'zolari ro'yxati.
func (h *Handlers) ListGroupMembers(c *fiber.Ctx) error {
	selfID, _ := c.Locals("user_id").(string)
	chatID := c.Params("id")
	if !h.isGroupMember(c, chatID, selfID) {
		return fiber.NewError(fiber.StatusForbidden, "siz bu guruh a'zosi emassiz")
	}

	rows, err := h.deps.DB.Query(c.Context(), `
		SELECT u.id::text, u.display_name, u.username, cm.role, cm.joined_at,
		       (u.avatar_path IS NOT NULL AND u.avatar_path <> ''),
		       (gke.user_id IS NOT NULL)
		  FROM chat_members cm
		  JOIN users u ON u.id = cm.user_id
		  LEFT JOIN group_key_envelopes gke
		    ON gke.chat_id = cm.chat_id AND gke.user_id = cm.user_id
		 WHERE cm.chat_id = $1::uuid
		 ORDER BY
		   CASE cm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
		   u.display_name
	`, chatID)
	if err != nil {
		return err
	}
	defer rows.Close()

	out := make([]fiber.Map, 0)
	for rows.Next() {
		var id, name, username, role string
		var joined time.Time
		var hasAvatar, hasKey bool
		if err := rows.Scan(&id, &name, &username, &role, &joined, &hasAvatar, &hasKey); err != nil {
			continue
		}
		out = append(out, fiber.Map{
			"user_id":           id,
			"display_name":      name,
			"username":          username,
			"role":              role,
			"joined_at":         joined.UTC().Format(time.RFC3339Nano),
			"has_avatar":        hasAvatar,
			"has_key_envelope":  hasKey,
		})
	}
	return c.JSON(out)
}

// AddGroupMember — guruhga a'zo qo'shish (owner/admin).
func (h *Handlers) AddGroupMember(c *fiber.Ctx) error {
	selfID, _ := c.Locals("user_id").(string)
	chatID := c.Params("id")
	if err := h.requireGroupManager(c, chatID, selfID); err != nil {
		return err
	}

	var req struct {
		UserID       string             `json:"user_id"`
		KeyEnvelopes []keyEnvelopeInput `json:"key_envelopes"`
	}
	if err := c.BodyParser(&req); err != nil || req.UserID == "" {
		return fiber.NewError(fiber.StatusBadRequest, "user_id talab qilinadi")
	}
	if req.UserID == selfID {
		return fiber.NewError(fiber.StatusBadRequest, "o'zingizni qo'sha olmaysiz")
	}

	var active bool
	if err := h.deps.DB.QueryRow(c.Context(),
		`SELECT is_active FROM users WHERE id = $1::uuid`, req.UserID,
	).Scan(&active); err != nil || !active {
		return fiber.NewError(fiber.StatusBadRequest, "foydalanuvchi topilmadi yoki faol emas")
	}

	_, err := h.deps.DB.Exec(c.Context(), `
		INSERT INTO chat_members (chat_id, user_id, role)
		VALUES ($1::uuid, $2::uuid, 'member')
		ON CONFLICT DO NOTHING
	`, chatID, req.UserID)
	if err != nil {
		return err
	}

	if err := storeKeyEnvelopes(c, h, chatID, selfID, req.KeyEnvelopes); err != nil {
		return internalError("AddGroupMember envelopes", err)
	}

	if len(req.KeyEnvelopes) == 0 {
		h.persistGroupKeyRequest(c, chatID, req.UserID)
	}
	h.deps.Hub.NotifyGroupKeyNeeded(c.Context(), chatID, req.UserID)

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"ok": true})
}

// RemoveGroupMember — a'zoni olib tashlash (owner/admin; owner o'zini olib tashlay olmaydi).
func (h *Handlers) RemoveGroupMember(c *fiber.Ctx) error {
	selfID, _ := c.Locals("user_id").(string)
	chatID := c.Params("id")
	targetID := c.Params("uid")
	if err := h.requireGroupManager(c, chatID, selfID); err != nil {
		return err
	}

	targetRole, err := h.groupMemberRole(c, chatID, targetID)
	if err != nil {
		return fiber.NewError(fiber.StatusNotFound, "a'zo topilmadi")
	}
	if targetRole == "owner" {
		return fiber.NewError(fiber.StatusForbidden, "guruh yaratuvchisini olib bo'lmaydi")
	}

	_, err = h.deps.DB.Exec(c.Context(), `
		DELETE FROM chat_members WHERE chat_id = $1::uuid AND user_id = $2::uuid
	`, chatID, targetID)
	if err != nil {
		return err
	}
	_, _ = h.deps.DB.Exec(c.Context(), `
		DELETE FROM group_key_envelopes WHERE chat_id = $1::uuid AND user_id = $2::uuid
	`, chatID, targetID)
	return c.SendStatus(fiber.StatusNoContent)
}

// UpdateGroupMemberRole — admin tayinlash / olib tashlash (faqat owner).
func (h *Handlers) UpdateGroupMemberRole(c *fiber.Ctx) error {
	selfID, _ := c.Locals("user_id").(string)
	chatID := c.Params("id")
	targetID := c.Params("uid")

	ownerRole, err := h.groupMemberRole(c, chatID, selfID)
	if err != nil || ownerRole != "owner" {
		return fiber.NewError(fiber.StatusForbidden, "faqat guruh yaratuvchisi admin tayinlay oladi")
	}
	if targetID == selfID {
		return fiber.NewError(fiber.StatusBadRequest, "o'z rolingizni o'zgartira olmaysiz")
	}

	var req struct {
		Role string `json:"role"`
	}
	if err := c.BodyParser(&req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "so'rov noto'g'ri")
	}
	if req.Role != "admin" && req.Role != "member" {
		return fiber.NewError(fiber.StatusBadRequest, "rol 'admin' yoki 'member' bo'lishi kerak")
	}

	res, err := h.deps.DB.Exec(c.Context(), `
		UPDATE chat_members SET role = $3
		 WHERE chat_id = $1::uuid AND user_id = $2::uuid AND role <> 'owner'
	`, chatID, targetID, req.Role)
	if err != nil {
		return err
	}
	if res.RowsAffected() == 0 {
		return fiber.NewError(fiber.StatusNotFound, "a'zo topilmadi")
	}
	return c.JSON(fiber.Map{"role": req.Role})
}

// GetGroupKeyEnvelope — joriy foydalanuvchi uchun shifrlangan guruh kaliti.
func (h *Handlers) GetGroupKeyEnvelope(c *fiber.Ctx) error {
	selfID, _ := c.Locals("user_id").(string)
	chatID := c.Params("id")
	if !h.isGroupMember(c, chatID, selfID) {
		return fiber.NewError(fiber.StatusForbidden, "siz bu guruh a'zosi emassiz")
	}

	var ct, fromID string
	err := h.deps.DB.QueryRow(c.Context(), `
		SELECT ciphertext, COALESCE(from_user_id::text, '')
		  FROM group_key_envelopes
		 WHERE chat_id = $1::uuid AND user_id = $2::uuid
	`, chatID, selfID).Scan(&ct, &fromID)
	if err != nil {
		return fiber.NewError(fiber.StatusNotFound, "guruh kaliti hali berilmagan")
	}
	return c.JSON(fiber.Map{"ciphertext": ct, "from_user_id": fromID})
}

// GetGroupKeyVault — guruh AES kaliti (a'zolar uchun, admin onlayn bo'lmasa ham).
func (h *Handlers) GetGroupKeyVault(c *fiber.Ctx) error {
	selfID, _ := c.Locals("user_id").(string)
	chatID := c.Params("id")
	if !h.isGroupMember(c, chatID, selfID) {
		return fiber.NewError(fiber.StatusForbidden, "siz bu guruh a'zosi emassiz")
	}

	var keyMaterial, updatedBy string
	err := h.deps.DB.QueryRow(c.Context(), `
		SELECT key_material, COALESCE(updated_by::text, '')
		  FROM group_key_vault
		 WHERE chat_id = $1::uuid
	`, chatID).Scan(&keyMaterial, &updatedBy)
	if err != nil || strings.TrimSpace(keyMaterial) == "" {
		return fiber.NewError(fiber.StatusNotFound, "guruh kaliti hali saqlanmagan")
	}
	return c.JSON(fiber.Map{"key_material": keyMaterial})
}

// PutGroupKeyVault — guruh AES kalitini serverda saqlash (a'zolar offline qo'shilishi uchun).
func (h *Handlers) PutGroupKeyVault(c *fiber.Ctx) error {
	selfID, _ := c.Locals("user_id").(string)
	chatID := c.Params("id")
	var vaultExists bool
	_ = h.deps.DB.QueryRow(c.Context(), `
		SELECT EXISTS(SELECT 1 FROM group_key_vault WHERE chat_id = $1::uuid)
	`, chatID).Scan(&vaultExists)
	if vaultExists {
		if err := h.requireGroupKeySharer(c, chatID, selfID); err != nil {
			return err
		}
	} else if err := h.requireGroupManager(c, chatID, selfID); err != nil {
		return err
	}

	var req struct {
		KeyMaterial string `json:"key_material"`
	}
	if err := c.BodyParser(&req); err != nil || strings.TrimSpace(req.KeyMaterial) == "" {
		return fiber.NewError(fiber.StatusBadRequest, "key_material talab qilinadi")
	}

	_, err := h.deps.DB.Exec(c.Context(), `
		INSERT INTO group_key_vault (chat_id, key_material, updated_by, updated_at)
		VALUES ($1::uuid, $2, $3::uuid, NOW())
		ON CONFLICT (chat_id) DO UPDATE
		  SET key_material = EXCLUDED.key_material,
		      updated_by   = EXCLUDED.updated_by,
		      updated_at   = NOW()
	`, chatID, req.KeyMaterial, selfID)
	if err != nil {
		return internalError("PutGroupKeyVault", err)
	}

	rows, err := h.deps.DB.Query(c.Context(), `
		SELECT user_id::text FROM group_key_requests
		 WHERE chat_id = $1::uuid
	`, chatID)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var memberID string
			if err := rows.Scan(&memberID); err != nil {
				continue
			}
			h.deps.Hub.NotifyGroupKeyReady(memberID, chatID)
			h.clearGroupKeyRequest(c, chatID, memberID)
		}
	}

	return c.SendStatus(fiber.StatusNoContent)
}

// RequestGroupKey — kaliti yo'q a'zo kalit so'rovini saqlaydi va kalit egalariga bildiradi.
func (h *Handlers) RequestGroupKey(c *fiber.Ctx) error {
	selfID, _ := c.Locals("user_id").(string)
	chatID := c.Params("id")
	if !h.isGroupMember(c, chatID, selfID) {
		return fiber.NewError(fiber.StatusForbidden, "siz bu guruh a'zosi emassiz")
	}

	var hasVault, hasEnv bool
	err := h.deps.DB.QueryRow(c.Context(), `
		SELECT
		  EXISTS(SELECT 1 FROM group_key_vault WHERE chat_id = $1::uuid),
		  EXISTS(SELECT 1 FROM group_key_envelopes WHERE chat_id = $1::uuid AND user_id = $2::uuid)
	`, chatID, selfID).Scan(&hasVault, &hasEnv)
	if err != nil {
		return internalError("RequestGroupKey", err)
	}
	if hasEnv {
		return c.SendStatus(fiber.StatusNoContent)
	}
	if hasVault {
		h.deps.Hub.NotifyGroupKeyReady(selfID, chatID)
		return c.SendStatus(fiber.StatusNoContent)
	}

	h.persistGroupKeyRequest(c, chatID, selfID)
	h.deps.Hub.NotifyGroupKeyNeeded(c.Context(), chatID, selfID)
	return c.SendStatus(fiber.StatusAccepted)
}

// PutGroupKeyEnvelopes — bir yoki bir nechta a'zo uchun kalit konvertlarini yuklash.
func (h *Handlers) PutGroupKeyEnvelopes(c *fiber.Ctx) error {
	selfID, _ := c.Locals("user_id").(string)
	chatID := c.Params("id")
	if err := h.requireGroupKeySharer(c, chatID, selfID); err != nil {
		return err
	}

	var req struct {
		Envelopes []keyEnvelopeInput `json:"envelopes"`
	}
	if err := c.BodyParser(&req); err != nil || len(req.Envelopes) == 0 {
		return fiber.NewError(fiber.StatusBadRequest, "envelopes talab qilinadi")
	}
	if err := storeKeyEnvelopes(c, h, chatID, selfID, req.Envelopes); err != nil {
		return internalError("PutGroupKeyEnvelopes", err)
	}
	for _, env := range req.Envelopes {
		if env.UserID != "" {
			h.deps.Hub.NotifyGroupKeyReady(env.UserID, chatID)
			h.clearGroupKeyRequest(c, chatID, env.UserID)
		}
	}
	return c.SendStatus(fiber.StatusNoContent)
}

// CreateGroupInvite — taklif havolasi yaratish.
func (h *Handlers) CreateGroupInvite(c *fiber.Ctx) error {
	selfID, _ := c.Locals("user_id").(string)
	chatID := c.Params("id")
	if err := h.requireGroupManager(c, chatID, selfID); err != nil {
		return err
	}

	var req struct {
		ExpiresHours *int `json:"expires_hours"`
		MaxUses      *int `json:"max_uses"`
	}
	_ = c.BodyParser(&req)

	tokenBytes := make([]byte, 16)
	_, _ = rand.Read(tokenBytes)
	token := hex.EncodeToString(tokenBytes)

	var expiresAt *time.Time
	if req.ExpiresHours != nil && *req.ExpiresHours > 0 {
		t := time.Now().Add(time.Duration(*req.ExpiresHours) * time.Hour)
		expiresAt = &t
	}

	_, err := h.deps.DB.Exec(c.Context(), `
		INSERT INTO group_invite_links (token, chat_id, created_by, expires_at, max_uses)
		VALUES ($1, $2::uuid, $3::uuid, $4, $5)
	`, token, chatID, selfID, expiresAt, req.MaxUses)
	if err != nil {
		return err
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"token":   token,
		"chat_id": chatID,
	})
}

// PreviewGroupInvite — havola haqida ma'lumot (kirish talab qilinadi).
func (h *Handlers) PreviewGroupInvite(c *fiber.Ctx) error {
	selfID, _ := c.Locals("user_id").(string)
	token := c.Params("token")

	var chatID, title string
	var memberCount int
	var expiresAt *time.Time
	var maxUses, useCount *int
	err := h.deps.DB.QueryRow(c.Context(), `
		SELECT il.chat_id::text, ch.title,
		       (SELECT COUNT(*)::int FROM chat_members WHERE chat_id = il.chat_id),
		       il.expires_at, il.max_uses, il.use_count
		  FROM group_invite_links il
		  JOIN chats ch ON ch.id = il.chat_id
		 WHERE il.token = $1 AND ch.type = 'group'
	`, token).Scan(&chatID, &title, &memberCount, &expiresAt, &maxUses, &useCount)
	if err != nil {
		return fiber.NewError(fiber.StatusNotFound, "havola topilmadi")
	}
	if expiresAt != nil && time.Now().After(*expiresAt) {
		return fiber.NewError(fiber.StatusGone, "havola muddati tugagan")
	}
	if maxUses != nil && useCount != nil && *useCount >= *maxUses {
		return fiber.NewError(fiber.StatusGone, "havola limiti tugagan")
	}

	var already bool
	_ = h.deps.DB.QueryRow(c.Context(), `
		SELECT EXISTS(SELECT 1 FROM chat_members WHERE chat_id = $1::uuid AND user_id = $2::uuid)
	`, chatID, selfID).Scan(&already)

	return c.JSON(fiber.Map{
		"chat_id":       chatID,
		"title":         title,
		"member_count":  memberCount,
		"already_member": already,
	})
}

// JoinGroupInvite — havola orqali guruhga qo'shilish.
func (h *Handlers) JoinGroupInvite(c *fiber.Ctx) error {
	selfID, _ := c.Locals("user_id").(string)
	token := c.Params("token")

	var chatID string
	var expiresAt *time.Time
	var maxUses, useCount *int
	err := h.deps.DB.QueryRow(c.Context(), `
		SELECT il.chat_id::text, il.expires_at, il.max_uses, il.use_count
		  FROM group_invite_links il
		  JOIN chats ch ON ch.id = il.chat_id AND ch.type = 'group'
		 WHERE il.token = $1
	`, token).Scan(&chatID, &expiresAt, &maxUses, &useCount)
	if err != nil {
		return fiber.NewError(fiber.StatusNotFound, "havola topilmadi")
	}
	if expiresAt != nil && time.Now().After(*expiresAt) {
		return fiber.NewError(fiber.StatusGone, "havola muddati tugagan")
	}
	if maxUses != nil && useCount != nil && *useCount >= *maxUses {
		return fiber.NewError(fiber.StatusGone, "havola limiti tugagan")
	}

	var already bool
	_ = h.deps.DB.QueryRow(c.Context(), `
		SELECT EXISTS(SELECT 1 FROM chat_members WHERE chat_id = $1::uuid AND user_id = $2::uuid)
	`, chatID, selfID).Scan(&already)
	if already {
		return c.JSON(fiber.Map{"chat_id": chatID, "joined": false, "existing": true})
	}

	tx, err := h.deps.DB.Begin(c.Context())
	if err != nil {
		return err
	}
	defer tx.Rollback(c.Context())

	_, err = tx.Exec(c.Context(), `
		INSERT INTO chat_members (chat_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'member')
	`, chatID, selfID)
	if err != nil {
		return err
	}
	_, err = tx.Exec(c.Context(), `
		UPDATE group_invite_links SET use_count = use_count + 1 WHERE token = $1
	`, token)
	if err != nil {
		return err
	}
	if err := tx.Commit(c.Context()); err != nil {
		return err
	}

	var hasVault bool
	_ = h.deps.DB.QueryRow(c.Context(), `
		SELECT EXISTS(SELECT 1 FROM group_key_vault WHERE chat_id = $1::uuid)
	`, chatID).Scan(&hasVault)
	if hasVault {
		h.deps.Hub.NotifyGroupKeyReady(selfID, chatID)
		return c.JSON(fiber.Map{"chat_id": chatID, "joined": true, "existing": false})
	}

	h.persistGroupKeyRequest(c, chatID, selfID)
	h.deps.Hub.NotifyGroupKeyNeeded(c.Context(), chatID, selfID)

	return c.JSON(fiber.Map{"chat_id": chatID, "joined": true, "existing": false})
}

// ListGroupInvites — faol taklif havolalari (owner/admin).
func (h *Handlers) ListGroupInvites(c *fiber.Ctx) error {
	selfID, _ := c.Locals("user_id").(string)
	chatID := c.Params("id")
	if err := h.requireGroupManager(c, chatID, selfID); err != nil {
		return err
	}

	rows, err := h.deps.DB.Query(c.Context(), `
		SELECT token, expires_at, max_uses, use_count, created_at
		  FROM group_invite_links
		 WHERE chat_id = $1::uuid
		 ORDER BY created_at DESC
		 LIMIT 20
	`, chatID)
	if err != nil {
		return err
	}
	defer rows.Close()

	out := make([]fiber.Map, 0)
	for rows.Next() {
		var token string
		var expiresAt *time.Time
		var maxUses, useCount *int
		var created time.Time
		if err := rows.Scan(&token, &expiresAt, &maxUses, &useCount, &created); err != nil {
			continue
		}
		item := fiber.Map{
			"token":      token,
			"use_count":  useCount,
			"created_at": created.UTC().Format(time.RFC3339Nano),
		}
		if expiresAt != nil {
			item["expires_at"] = expiresAt.UTC().Format(time.RFC3339Nano)
		}
		if maxUses != nil {
			item["max_uses"] = maxUses
		}
		out = append(out, item)
	}
	return c.JSON(out)
}

// RevokeGroupInvite — taklif havolasini bekor qilish.
func (h *Handlers) RevokeGroupInvite(c *fiber.Ctx) error {
	selfID, _ := c.Locals("user_id").(string)
	chatID := c.Params("id")
	token := c.Params("token")
	if err := h.requireGroupManager(c, chatID, selfID); err != nil {
		return err
	}

	res, err := h.deps.DB.Exec(c.Context(), `
		DELETE FROM group_invite_links WHERE chat_id = $1::uuid AND token = $2
	`, chatID, token)
	if err != nil {
		return err
	}
	if res.RowsAffected() == 0 {
		return fiber.NewError(fiber.StatusNotFound, "havola topilmadi")
	}
	return c.SendStatus(fiber.StatusNoContent)
}
