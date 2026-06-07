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
	Username     string `json:"username"`
	DisplayName  string `json:"display_name"`
	Role         string `json:"role"`
	RankTitle    string `json:"rank_title"`
	UnitCode     string `json:"unit_code"`
	OkrugName    string `json:"okrug_name"`
	OkrugCode    string `json:"okrug_code"`
	UnitName     string `json:"unit_name"`
	DivisionName string `json:"division_name"`
	DivisionCode string `json:"division_code"`
	DisplayShort string `json:"display_short"`
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
		    (username, password_hash, display_name, role, rank_title, unit_code,
		     okrug_name, okrug_code, unit_name, division_name, division_code, display_short,
		     must_change_password)
		VALUES ($1, $2, $3, $4, NULLIF($5,''), NULLIF($6,''),
		        NULLIF($7,''), NULLIF($8,''), NULLIF($9,''), NULLIF($10,''), NULLIF($11,''), NULLIF($12,''),
		        TRUE)
		RETURNING id::text
	`, req.Username, hash, req.DisplayName, req.Role, req.RankTitle, req.UnitCode,
		req.OkrugName, req.OkrugCode, req.UnitName, req.DivisionName, req.DivisionCode, req.DisplayShort).Scan(&newID)
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
		       COALESCE(okrug_name, ''), COALESCE(okrug_code, ''),
		       COALESCE(unit_name, ''), COALESCE(division_name, ''), COALESCE(division_code, ''),
		       COALESCE(display_short, ''),
		       is_active
		FROM users
		ORDER BY created_at ASC
	`)
	if err != nil {
		return err
	}
	defer rows.Close()

	type userRow struct {
		ID           string `json:"id"`
		Username     string `json:"username"`
		DisplayName  string `json:"display_name"`
		Role         string `json:"role"`
		RankTitle    string `json:"rank_title"`
		UnitCode     string `json:"unit_code"`
		OkrugName    string `json:"okrug_name"`
		OkrugCode    string `json:"okrug_code"`
		UnitName     string `json:"unit_name"`
		DivisionName string `json:"division_name"`
		DivisionCode string `json:"division_code"`
		DisplayShort string `json:"display_short"`
		IsActive     bool   `json:"is_active"`
	}

	var result []userRow
	for rows.Next() {
		var u userRow
		if err := rows.Scan(
			&u.ID, &u.Username, &u.DisplayName, &u.Role,
			&u.RankTitle, &u.UnitCode,
			&u.OkrugName, &u.OkrugCode, &u.UnitName, &u.DivisionName, &u.DivisionCode, &u.DisplayShort,
			&u.IsActive,
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

// AdminUpdateUser — admin foydalanuvchi ma'lumotlarini yangilaydi.
func (h *Handlers) AdminUpdateUser(c *fiber.Ctx) error {
	targetID := c.Params("id")
	var req struct {
		DisplayName  string `json:"display_name"`
		Role         string `json:"role"`
		RankTitle    string `json:"rank_title"`
		UnitCode     string `json:"unit_code"`
		OkrugName    string `json:"okrug_name"`
		OkrugCode    string `json:"okrug_code"`
		UnitName     string `json:"unit_name"`
		DivisionName string `json:"division_name"`
		DivisionCode string `json:"division_code"`
		DisplayShort string `json:"display_short"`
	}
	if err := c.BodyParser(&req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "so'rov noto'g'ri")
	}
	if req.Role != "" && req.Role != "user" && req.Role != "admin" {
		return fiber.NewError(fiber.StatusBadRequest, "rol noto'g'ri")
	}
	_, err := h.deps.DB.Exec(c.Context(), `
		UPDATE users SET
			display_name  = COALESCE(NULLIF($2,''), display_name),
			role          = CASE WHEN $3 != '' THEN $3 ELSE role END,
			rank_title    = NULLIF($4, ''),
			unit_code     = NULLIF($5, ''),
			okrug_name    = NULLIF($6, ''),
			okrug_code    = NULLIF($7, ''),
			unit_name     = NULLIF($8, ''),
			division_name = NULLIF($9, ''),
			division_code = NULLIF($10,''),
			display_short = NULLIF($11,'')
		WHERE id = $1::uuid`,
		targetID, req.DisplayName, req.Role,
		req.RankTitle, req.UnitCode,
		req.OkrugName, req.OkrugCode, req.UnitName,
		req.DivisionName, req.DivisionCode, req.DisplayShort,
	)
	if err != nil {
		return internalError("AdminUpdateUser", err)
	}
	actorID, _ := c.Locals("user_id").(string)
	_ = h.audit(c.Context(), actorID, "admin.user.update", &targetID, c.IP())
	return c.SendStatus(fiber.StatusNoContent)
}

// AdminResetPassword — admin foydalanuvchi parolini qayta o'rnatadi.
func (h *Handlers) AdminResetPassword(c *fiber.Ctx) error {
	targetID := c.Params("id")

	raw := make([]byte, 16)
	_, _ = rand.Read(raw)
	tempPass := base64.RawURLEncoding.EncodeToString(raw)

	hash, err := auth.HashPassword(tempPass, h.deps.Config.Auth.Argon2)
	if err != nil {
		return err
	}
	_, err = h.deps.DB.Exec(c.Context(), `
		UPDATE users SET password_hash = $1, must_change_password = TRUE,
		                 failed_login_attempts = 0, locked_until = NULL
		WHERE id = $2::uuid`, hash, targetID)
	if err != nil {
		return internalError("AdminResetPassword", err)
	}
	actorID, _ := c.Locals("user_id").(string)
	_ = h.audit(c.Context(), actorID, "admin.user.reset_password", &targetID, c.IP())
	return c.JSON(fiber.Map{"temporary_password": tempPass})
}

// AdminStats — tizim statistikasi qaytariladi.
func (h *Handlers) AdminStats(c *fiber.Ctx) error {
	var totalUsers, activeUsers, lockedUsers, adminCount int
	var totalChats, privateChats, groupChats int
	var totalMessages int
	var onlineNow int

	_ = h.deps.DB.QueryRow(c.Context(),
		`SELECT COUNT(*) FROM users`).Scan(&totalUsers)
	_ = h.deps.DB.QueryRow(c.Context(),
		`SELECT COUNT(*) FROM users WHERE is_active = TRUE`).Scan(&activeUsers)
	_ = h.deps.DB.QueryRow(c.Context(),
		`SELECT COUNT(*) FROM users WHERE is_active = TRUE AND locked_until > NOW()`).Scan(&lockedUsers)
	_ = h.deps.DB.QueryRow(c.Context(),
		`SELECT COUNT(*) FROM users WHERE role = 'admin'`).Scan(&adminCount)
	_ = h.deps.DB.QueryRow(c.Context(),
		`SELECT COUNT(*) FROM chats`).Scan(&totalChats)
	_ = h.deps.DB.QueryRow(c.Context(),
		`SELECT COUNT(*) FROM chats WHERE type = 'private'`).Scan(&privateChats)
	_ = h.deps.DB.QueryRow(c.Context(),
		`SELECT COUNT(*) FROM chats WHERE type = 'group'`).Scan(&groupChats)
	_ = h.deps.DB.QueryRow(c.Context(),
		`SELECT COUNT(*) FROM messages`).Scan(&totalMessages)

	onlineNow = h.deps.Hub.OnlineCount()

	return c.JSON(fiber.Map{
		"total_users":    totalUsers,
		"active_users":   activeUsers,
		"locked_users":   lockedUsers,
		"admin_count":    adminCount,
		"online_now":     onlineNow,
		"total_chats":    totalChats,
		"private_chats":  privateChats,
		"group_chats":    groupChats,
		"total_messages": totalMessages,
	})
}

// AdminListChats — barcha suhbatlar ro'yxati (admin uchun).
func (h *Handlers) AdminListChats(c *fiber.Ctx) error {
	rows, err := h.deps.DB.Query(c.Context(), `
		SELECT ch.id::text, ch.type, COALESCE(ch.title,''), ch.created_at,
		       COUNT(DISTINCT cm.user_id) AS member_count,
		       COUNT(DISTINCT m.id)       AS message_count,
		       MAX(m.created_at)          AS last_activity
		FROM chats ch
		LEFT JOIN chat_members cm ON cm.chat_id = ch.id
		LEFT JOIN messages m ON m.chat_id = ch.id
		GROUP BY ch.id
		ORDER BY last_activity DESC NULLS LAST
		LIMIT 200`)
	if err != nil {
		return err
	}
	defer rows.Close()

	type chatRow struct {
		ID           string `json:"id"`
		Type         string `json:"type"`
		Title        string `json:"title"`
		CreatedAt    any    `json:"created_at"`
		MemberCount  int    `json:"member_count"`
		MessageCount int    `json:"message_count"`
		LastActivity any    `json:"last_activity"`
	}

	var result []chatRow
	for rows.Next() {
		var r chatRow
		if err := rows.Scan(&r.ID, &r.Type, &r.Title, &r.CreatedAt,
			&r.MemberCount, &r.MessageCount, &r.LastActivity); err != nil {
			continue
		}
		result = append(result, r)
	}
	if result == nil {
		result = []chatRow{}
	}
	return c.JSON(result)
}

// AdminAuditLogFiltered — filtrlanadigan audit jurnali.
func (h *Handlers) AdminAuditLogFiltered(c *fiber.Ctx) error {
	limit := c.QueryInt("limit", 50)
	offset := c.QueryInt("offset", 0)
	action := c.Query("action", "")
	if limit > 200 {
		limit = 200
	}

	var rows interface{ Close() }
	var err error

	if action != "" {
		rows, err = h.deps.DB.Query(c.Context(), `
			SELECT al.id, COALESCE(al.actor_id::text,''), al.action,
			       COALESCE(al.target_id::text,''), COALESCE(al.ip_address::text,''),
			       al.created_at, COALESCE(u.username,'')
			FROM audit_log al
			LEFT JOIN users u ON u.id = al.actor_id
			WHERE al.action ILIKE $3
			ORDER BY al.created_at DESC LIMIT $1 OFFSET $2`,
			limit, offset, "%"+action+"%")
	} else {
		rows, err = h.deps.DB.Query(c.Context(), `
			SELECT al.id, COALESCE(al.actor_id::text,''), al.action,
			       COALESCE(al.target_id::text,''), COALESCE(al.ip_address::text,''),
			       al.created_at, COALESCE(u.username,'')
			FROM audit_log al
			LEFT JOIN users u ON u.id = al.actor_id
			ORDER BY al.created_at DESC LIMIT $1 OFFSET $2`,
			limit, offset)
	}
	if err != nil {
		return err
	}

	type pgRows interface {
		Next() bool
		Scan(...any) error
		Close()
	}

	pgr, ok := rows.(pgRows)
	if !ok {
		return fiber.NewError(fiber.StatusInternalServerError, "rows type error")
	}
	defer pgr.Close()

	type logRow struct {
		ID        int64  `json:"id"`
		ActorID   string `json:"actor_id"`
		Action    string `json:"action"`
		TargetID  string `json:"target_id"`
		IP        string `json:"ip"`
		CreatedAt any    `json:"created_at"`
		Username  string `json:"username"`
	}

	var result []logRow
	for pgr.Next() {
		var r logRow
		if err := pgr.Scan(&r.ID, &r.ActorID, &r.Action, &r.TargetID,
			&r.IP, &r.CreatedAt, &r.Username); err != nil {
			continue
		}
		result = append(result, r)
	}
	if result == nil {
		result = []logRow{}
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
