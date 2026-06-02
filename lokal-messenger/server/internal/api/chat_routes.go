// Fayl: server/internal/api/chat_routes.go
// Maqsad: Suhbatlar ro'yxati, yangi suhbat yaratish, shifrlangan xabarlar tarixi
//
//	va foydalanuvchilar katalogi marshrutlari xizmatga qo'yiladi.
package api

import (
	"github.com/gofiber/fiber/v2"
)

// ListUsers — kim bilan yozish mumkinligi (faol foydalanuvchilar katalogi) qaytariladi.
// ?q= parametri berilsa, username yoki display_name bo'yicha qidiradi.
func (h *Handlers) ListUsers(c *fiber.Ctx) error {
	selfID, _ := c.Locals("user_id").(string)
	q := "%" + c.Query("q") + "%"

	rows, err := h.deps.DB.Query(c.Context(), `
        SELECT id::text, username, display_name, role, rank_title, unit_code
          FROM users
         WHERE is_active = TRUE AND id <> $1::uuid
           AND (username ILIKE $2 OR display_name ILIKE $2)
         ORDER BY display_name
         LIMIT 50`, selfID, q)
	if err != nil {
		return err
	}
	defer rows.Close()

	out := make([]fiber.Map, 0)
	for rows.Next() {
		var id, u, dn, role string
		var rank, unit *string
		if err := rows.Scan(&id, &u, &dn, &role, &rank, &unit); err != nil {
			continue
		}
		out = append(out, fiber.Map{
			"id": id, "username": u, "display_name": dn,
			"role": role, "rank_title": rank, "unit_code": unit,
		})
	}
	return c.JSON(out)
}

// ListChats — joriy foydalanuvchi a'zo bo'lgan suhbatlar ro'yxati qaytariladi.
// Shaxsiy suhbatlar uchun sherikning ismi va o'qilmagan xabarlar soni hisoblanadi.
// Eslatma: xabar matnini server ocha olmaydi, shu sababli oldindan ko'rinish (preview)
//
//	serverda shakllanmaydi — u mijozda mahalliy ravishda ochiladi.
func (h *Handlers) ListChats(c *fiber.Ctx) error {
	selfID, _ := c.Locals("user_id").(string)

	rows, err := h.deps.DB.Query(c.Context(), `
        SELECT
            ch.id::text,
            ch.type,
            ch.title,
            peer.id::text          AS peer_id,
            peer.display_name      AS peer_name,
            (SELECT MAX(created_at) FROM messages m WHERE m.chat_id = ch.id) AS last_time,
            (SELECT COUNT(*) FROM messages m
              WHERE m.chat_id = ch.id AND m.recipient_id = $1::uuid AND m.read_at IS NULL) AS unread
          FROM chats ch
          JOIN chat_members cm ON cm.chat_id = ch.id AND cm.user_id = $1::uuid
          LEFT JOIN LATERAL (
              SELECT u.id, u.display_name
                FROM chat_members cm2
                JOIN users u ON u.id = cm2.user_id
               WHERE cm2.chat_id = ch.id AND cm2.user_id <> $1::uuid
               LIMIT 1
          ) peer ON ch.type = 'private'
         ORDER BY last_time DESC NULLS LAST`, selfID)
	if err != nil {
		return err
	}
	defer rows.Close()

	out := make([]fiber.Map, 0)
	for rows.Next() {
		var id, ctype string
		var title, peerID, peerName *string
		var lastTime any
		var unread int
		if err := rows.Scan(&id, &ctype, &title, &peerID, &peerName, &lastTime, &unread); err != nil {
			continue
		}
		// Shaxsiy suhbatda sarlavha sifatida sherikning ismi ishlatiladi
		displayTitle := ""
		if title != nil {
			displayTitle = *title
		}
		if ctype == "private" && peerName != nil {
			displayTitle = *peerName
		}
		out = append(out, fiber.Map{
			"id":           id,
			"type":         ctype,
			"title":        displayTitle,
			"peer_user_id": peerID,
			"last_time":    lastTime,
			"unread":       unread,
		})
	}
	return c.JSON(out)
}

type createChatRequest struct {
	Type       string `json:"type"`         // 'private' yoki 'group'
	PeerUserID string `json:"peer_user_id"` // shaxsiy suhbat uchun
	Title      string `json:"title"`        // guruh uchun
}

// CreateChat — yangi suhbat yaratiladi. Shaxsiy suhbat allaqachon mavjud bo'lsa,
// mavjudi qaytariladi (takror suhbat yaratilmaydi).
func (h *Handlers) CreateChat(c *fiber.Ctx) error {
	selfID, _ := c.Locals("user_id").(string)

	var req createChatRequest
	if err := c.BodyParser(&req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "so'rov noto'g'ri")
	}
	if req.Type != "private" && req.Type != "group" {
		return fiber.NewError(fiber.StatusBadRequest, "suhbat turi noto'g'ri")
	}

	if req.Type == "private" {
		if req.PeerUserID == "" || req.PeerUserID == selfID {
			return fiber.NewError(fiber.StatusBadRequest, "sherik foydalanuvchi noto'g'ri")
		}

		// Ikki foydalanuvchi o'rtasida shaxsiy suhbat allaqachon bor-yo'qligi tekshiriladi
		var existingID string
		err := h.deps.DB.QueryRow(c.Context(), `
            SELECT ch.id::text
              FROM chats ch
              JOIN chat_members a ON a.chat_id = ch.id AND a.user_id = $1::uuid
              JOIN chat_members b ON b.chat_id = ch.id AND b.user_id = $2::uuid
             WHERE ch.type = 'private'
             LIMIT 1
        `, selfID, req.PeerUserID).Scan(&existingID)
		if err == nil {
			return c.JSON(fiber.Map{"id": existingID, "existing": true})
		}
	}

	tx, err := h.deps.DB.Begin(c.Context())
	if err != nil {
		return err
	}
	defer tx.Rollback(c.Context())

	var chatID string
	err = tx.QueryRow(c.Context(), `
        INSERT INTO chats (type, title, created_by)
        VALUES ($1, NULLIF($2, ''), $3::uuid)
        RETURNING id::text
    `, req.Type, req.Title, selfID).Scan(&chatID)
	if err != nil {
		return err
	}

	// Yaratuvchi suhbat egasi sifatida qo'shiladi
	_, err = tx.Exec(c.Context(), `
        INSERT INTO chat_members (chat_id, user_id, role)
        VALUES ($1::uuid, $2::uuid, 'owner')
    `, chatID, selfID)
	if err != nil {
		return err
	}

	// Shaxsiy suhbatda sherik a'zo sifatida qo'shiladi
	if req.Type == "private" {
		_, err = tx.Exec(c.Context(), `
            INSERT INTO chat_members (chat_id, user_id, role)
            VALUES ($1::uuid, $2::uuid, 'member')
        `, chatID, req.PeerUserID)
		if err != nil {
			return err
		}
	}

	if err := tx.Commit(c.Context()); err != nil {
		return err
	}
	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"id": chatID, "existing": false})
}

// ChatHistory — suhbatdagi xabarlar tarixi qaytariladi.
// Faqat joriy foydalanuvchi ochishi mumkin bo'lgan ciphertext yozuvlari yuboriladi
// (recipient_id = joriy foydalanuvchi). Ochish mijozda amalga oshiriladi.
func (h *Handlers) ChatHistory(c *fiber.Ctx) error {
	selfID, _ := c.Locals("user_id").(string)
	chatID := c.Params("id")
	limit := c.QueryInt("limit", 100)
	if limit <= 0 || limit > 500 {
		limit = 100
	}

	// Foydalanuvchi ushbu suhbat a'zosi ekanligi tekshiriladi
	var member bool
	_ = h.deps.DB.QueryRow(c.Context(), `
        SELECT EXISTS(SELECT 1 FROM chat_members WHERE chat_id = $1::uuid AND user_id = $2::uuid)
    `, chatID, selfID).Scan(&member)
	if !member {
		return fiber.NewError(fiber.StatusForbidden, "siz bu suhbat a'zosi emassiz")
	}

	rows, err := h.deps.DB.Query(c.Context(), `
        SELECT id::text, sender_id::text, encode(ciphertext, 'base64'), msg_type,
               created_at, delivered_at IS NOT NULL, read_at IS NOT NULL
          FROM messages
         WHERE chat_id = $1::uuid AND recipient_id = $2::uuid
         ORDER BY created_at DESC
         LIMIT $3`, chatID, selfID, limit)
	if err != nil {
		return err
	}
	defer rows.Close()

	out := make([]fiber.Map, 0, limit)
	for rows.Next() {
		var id, sender, ct string
		var mtype int
		var created any
		var delivered, read bool
		if err := rows.Scan(&id, &sender, &ct, &mtype, &created, &delivered, &read); err != nil {
			continue
		}
		out = append(out, fiber.Map{
			"msg_id":     id,
			"sender_id":  sender,
			"ciphertext": ct,
			"msg_type":   mtype,
			"created_at": created,
			"delivered":  delivered,
			"read":       read,
		})
	}
	return c.JSON(out)
}
