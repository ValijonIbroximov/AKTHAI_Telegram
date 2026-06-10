// Fayl: server/internal/api/chat_routes.go
// Maqsad: Suhbatlar ro'yxati, yangi suhbat yaratish, shifrlangan xabarlar tarixi,
//
//	foydalanuvchilar katalogi va shifrlangan media fayllari marshrutlari.
package api

import (
	"crypto/sha256"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
)

// ListUsers — kim bilan yozish mumkinligi (faol foydalanuvchilar katalogi) qaytariladi.
// ?q= parametri berilsa, username yoki display_name bo'yicha qidiradi.
func (h *Handlers) ListUsers(c *fiber.Ctx) error {
	selfID, _ := c.Locals("user_id").(string)
	q := "%" + c.Query("q") + "%"

	rows, err := h.deps.DB.Query(c.Context(), `
        SELECT id::text, username, display_name, role, rank_title, unit_code,
               okrug_name, okrug_code, unit_name, division_name, division_code, display_short,
               (avatar_path IS NOT NULL AND avatar_path <> '')
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
		var rank, unit, okrugName, okrugCode, unitName, divName, divCode, displayShort *string
		var hasAvatar bool
		if err := rows.Scan(&id, &u, &dn, &role, &rank, &unit,
			&okrugName, &okrugCode, &unitName, &divName, &divCode, &displayShort, &hasAvatar); err != nil {
			continue
		}
		out = append(out, fiber.Map{
			"id": id, "username": u, "display_name": dn,
			"role": role, "rank_title": rank, "unit_code": unit,
			"okrug_name": okrugName, "okrug_code": okrugCode,
			"unit_name": unitName, "division_name": divName, "division_code": divCode,
			"display_short": displayShort,
			"has_avatar": hasAvatar,
		})
	}
	return c.JSON(out)
}

// ListUsersDirectory — barcha faol foydalanuvchilar ierarxik ro'yxat uchun qaytariladi.
func (h *Handlers) ListUsersDirectory(c *fiber.Ctx) error {
	selfID, _ := c.Locals("user_id").(string)

	rows, err := h.deps.DB.Query(c.Context(), `
        SELECT id::text, username, display_name, role, rank_title, unit_code,
               okrug_name, okrug_code, unit_name, division_name, division_code, display_short,
               (avatar_path IS NOT NULL AND avatar_path <> '')
          FROM users
         WHERE is_active = TRUE AND id <> $1::uuid
         ORDER BY
           COALESCE(okrug_code, 'zzz'),
           COALESCE(unit_code, 'zzz'),
           COALESCE(division_code, 'zzz'),
           COALESCE(rank_title, ''),
           display_name`, selfID)
	if err != nil {
		return err
	}
	defer rows.Close()

	out := make([]fiber.Map, 0)
	for rows.Next() {
		var id, u, dn, role string
		var rank, unit, okrugName, okrugCode, unitName, divName, divCode, displayShort *string
		var hasAvatar bool
		if err := rows.Scan(&id, &u, &dn, &role, &rank, &unit,
			&okrugName, &okrugCode, &unitName, &divName, &divCode, &displayShort, &hasAvatar); err != nil {
			continue
		}
		out = append(out, fiber.Map{
			"id": id, "username": u, "display_name": dn,
			"role": role, "rank_title": rank, "unit_code": unit,
			"okrug_name": okrugName, "okrug_code": okrugCode,
			"unit_name": unitName, "division_name": divName, "division_code": divCode,
			"display_short": displayShort,
			"has_avatar": hasAvatar,
		})
	}
	if out == nil {
		out = []fiber.Map{}
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
	viewerRole, _ := c.Locals("role").(string)

	rows, err := h.deps.DB.Query(c.Context(), `
        SELECT
            ch.id::text,
            ch.type,
            ch.title,
            ch.description,
            peer.id::text          AS peer_id,
            peer.display_name      AS peer_name,
            peer.last_seen_at      AS peer_last_seen,
            peer.hide_last_seen    AS peer_hide_last_seen,
            (SELECT MAX(created_at) FROM messages m WHERE m.chat_id = ch.id) AS last_time,
            (SELECT COUNT(*) FROM messages m
              WHERE m.chat_id = ch.id AND m.recipient_id = $1::uuid AND m.read_at IS NULL) AS unread
          FROM chats ch
          JOIN chat_members cm ON cm.chat_id = ch.id AND cm.user_id = $1::uuid
          LEFT JOIN LATERAL (
              SELECT u.id, u.display_name, u.last_seen_at, u.hide_last_seen
                FROM chat_members cm2
                JOIN users u ON u.id = cm2.user_id
               WHERE cm2.chat_id = ch.id AND cm2.user_id <> $1::uuid
               LIMIT 1
          ) peer ON ch.type = 'private'
         WHERE EXISTS (SELECT 1 FROM messages msg WHERE msg.chat_id = ch.id)
            OR ch.type IN ('group', 'channel')
         ORDER BY last_time DESC NULLS LAST`, selfID)
	if err != nil {
		return err
	}
	defer rows.Close()

	out := make([]fiber.Map, 0)
	for rows.Next() {
		var id, ctype string
		var title, description, peerID, peerName *string
		var peerLastSeen *time.Time
		var peerHideLastSeen *bool
		var lastTime any
		var unread int
		if err := rows.Scan(&id, &ctype, &title, &description, &peerID, &peerName, &peerLastSeen, &peerHideLastSeen, &lastTime, &unread); err != nil {
			log.Printf("[CHAT] ListChats scan xatoligi: %v", err)
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

		item := fiber.Map{
			"id":           id,
			"type":         ctype,
			"title":        displayTitle,
			"peer_user_id": peerID,
			"last_time":    lastTime,
			"unread":       unread,
		}
		if description != nil && *description != "" {
			item["description"] = *description
		}
		if peerID != nil && *peerID != "" {
			item["peer_online"] = h.deps.Hub.IsOnline(*peerID)
			if peerHideLastSeen != nil && *peerHideLastSeen {
				item["peer_last_seen_hidden"] = true
				if viewerRole == "admin" && peerLastSeen != nil {
					item["peer_last_seen_at"] = peerLastSeen.UTC().Format(time.RFC3339Nano)
				}
			} else if peerLastSeen != nil {
				item["peer_last_seen_at"] = peerLastSeen.UTC().Format(time.RFC3339Nano)
			}
		}
		out = append(out, item)
	}
	return c.JSON(out)
}

type createChatRequest struct {
	Type        string `json:"type"`         // 'private', 'group' yoki 'channel'
	PeerUserID  string `json:"peer_user_id"` // shaxsiy suhbat uchun
	Title       string `json:"title"`        // guruh/kanal uchun
	Description string `json:"description"`  // kanal tavsifi (ixtiyoriy)
}

// CreateChat — yangi suhbat yaratiladi. Shaxsiy suhbat allaqachon mavjud bo'lsa,
// mavjudi qaytariladi (takror suhbat yaratilmaydi).
func (h *Handlers) CreateChat(c *fiber.Ctx) error {
	selfID, _ := c.Locals("user_id").(string)

	var req createChatRequest
	if err := c.BodyParser(&req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "so'rov noto'g'ri")
	}
	if req.Type != "private" && req.Type != "group" && req.Type != "channel" {
		return fiber.NewError(fiber.StatusBadRequest, "suhbat turi noto'g'ri")
	}

	if req.Type == "channel" {
		if strings.TrimSpace(req.Title) == "" {
			return fiber.NewError(fiber.StatusBadRequest, "kanal nomi talab qilinadi")
		}
		var canCreate bool
		if err := h.deps.DB.QueryRow(c.Context(),
			`SELECT COALESCE(can_create_channel, TRUE) FROM users WHERE id = $1::uuid`, selfID,
		).Scan(&canCreate); err != nil {
			return internalError("CreateChat can_create_channel", err)
		}
		if !canCreate {
			return fiber.NewError(fiber.StatusForbidden, "kanal yaratish huquqingiz cheklangan")
		}
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
        INSERT INTO chats (type, title, description, created_by)
        VALUES ($1, NULLIF($2, ''), NULLIF($3, ''), $4::uuid)
        RETURNING id::text
    `, req.Type, req.Title, req.Description, selfID).Scan(&chatID)
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

// uploadsDir — server binary yonida (yoki ish katalogida) joylashgan faollar papkasi.
// filepath.Abs har safar OS ning joriy katalogiga nisbatan to'liq yo'lni qaytaradi.
func uploadsDir() (string, error) {
	return filepath.Abs("uploads")
}

// UploadFile — mijozdan shifrlangan fayl blob'ini qabul qilib diskda saqlaydi.
//
// Server faylning nimaligini bilmaydi: u AES-256-GCM bilan shifrlangan.
// AES kaliti Signal Protocol orqali xabar tanasida jo'natiladi.
//
// Muhim: multipart/form-data, fayl maydoni nomi — "data".
// Qaytariladi: { id: string, url: string }
func (h *Handlers) UploadFile(c *fiber.Ctx) error {
	uploaderID, _ := c.Locals("user_id").(string)

	file, err := c.FormFile("data")
	if err != nil {
		log.Printf("[Upload] Upload Error: %v", err)
		return fiber.NewError(fiber.StatusBadRequest, "fayl topilmadi (maydon nomi: 'data')")
	}

	maxSize := h.deps.Config.Limits.MaxUploadBytes()
	if file.Size > maxSize {
		log.Printf("[Upload] Upload Error: fayl juda katta (%d bayt, limit=%d)", file.Size, maxSize)
		return fiber.NewError(fiber.StatusRequestEntityTooLarge, "fayl 50 MB dan oshmasligi kerak")
	}

	// ── 1. Papkani eng avval yaratish — keyingi qadamlardan oldin ────────────
	dir, err := uploadsDir()
	if err != nil {
		log.Printf("[Upload] Upload Error: %v", err)
		return internalError("UploadFile abs", err)
	}
	if err := os.MkdirAll(dir, os.ModePerm); err != nil {
		log.Printf("[Upload] Upload Error: MkdirAll dir=%s err=%v", dir, err)
		return internalError("UploadFile mkdir", err)
	}

	// ── 2. Fayl baytlarini o'qish ─────────────────────────────────────────
	f, err := file.Open()
	if err != nil {
		log.Printf("[Upload] Upload Error: open temp file: %v", err)
		return internalError("UploadFile open", err)
	}
	defer f.Close()

	data, err := io.ReadAll(f)
	if err != nil {
		log.Printf("[Upload] Upload Error: read body: %v", err)
		return internalError("UploadFile read", err)
	}

	hash := sha256.Sum256(data)

	// ── 3. DB ga yozish (to'liq storage_key bilan) ────────────────────────
	// Avval placeholder UUID olamiz — fayl yozilgandan keyin update qilamiz
	var fileID string
	if err := h.deps.DB.QueryRow(c.Context(),
		`INSERT INTO files (uploader_id, storage_key, size_bytes, sha256)
		 VALUES ($1::uuid, 'pending', $2, $3) RETURNING id::text`,
		uploaderID, file.Size, hash[:],
	).Scan(&fileID); err != nil {
		log.Printf("[Upload] Upload Error: DB insert: %v", err)
		return internalError("UploadFile insert", err)
	}

	// ── 4. Faylni to'liq (absolute) yo'l bilan diskka yozish ─────────────
	storagePath := filepath.Join(dir, fileID)
	if err := os.WriteFile(storagePath, data, 0o644); err != nil {
		log.Printf("[Upload] Upload Error: WriteFile path=%s err=%v", storagePath, err)
		// Orphan DB yozuvini o'chirish (best-effort)
		_, _ = h.deps.DB.Exec(c.Context(),
			`DELETE FROM files WHERE id = $1::uuid`, fileID)
		return internalError("UploadFile write", err)
	}

	// ── 5. DB da storage_key ni to'liq absolut yo'l bilan yangilash ──────
	if _, err := h.deps.DB.Exec(c.Context(),
		`UPDATE files SET storage_key = $1 WHERE id = $2::uuid`,
		storagePath, fileID,
	); err != nil {
		log.Printf("[Upload] Upload Error: DB update_key: %v", err)
		return internalError("UploadFile update_key", err)
	}

	log.Printf("[Upload] ✓ saqlandi: id=%s size=%dB path=%s uploader=%s",
		fileID, len(data), storagePath, uploaderID)

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"id":  fileID,
		"url": fmt.Sprintf("/api/v1/files/%s", fileID),
	})
}

// GetFile — autentifikatsiyalangan foydalanuvchiga shifrlangan fayl blob'ini uzatadi.
//
// Fayl mijozda deshifrlashni talab qiladi (server mazmunni bilmaydi).
// c.SendFile o'rniga os.ReadFile + c.Send ishlatiladi — Windows da yo'l muammosi yo'q.
func (h *Handlers) GetFile(c *fiber.Ctx) error {
	fileID := c.Params("id")
	if fileID == "" {
		return fiber.NewError(fiber.StatusBadRequest, "fayl ID bo'sh")
	}

	// DB dan to'liq absolut yo'lni olamiz
	var storagePath string
	if err := h.deps.DB.QueryRow(c.Context(),
		`SELECT storage_key FROM files WHERE id = $1::uuid AND storage_key <> 'pending'`,
		fileID,
	).Scan(&storagePath); err != nil {
		log.Printf("[GetFile] DB so'rov xatoligi: id=%s err=%v", fileID, err)
		return fiber.NewError(fiber.StatusNotFound, "fayl topilmadi")
	}

	// Diskda borligini tekshirish
	if _, err := os.Stat(storagePath); err != nil {
		log.Printf("[GetFile] diskda yo'q: path=%s err=%v", storagePath, err)
		return fiber.NewError(fiber.StatusNotFound, "fayl diskda topilmadi")
	}

	// Faylni o'qib mijozga yuborish (c.SendFile emas — Windows path bug oldini olish)
	fileData, err := os.ReadFile(storagePath)
	if err != nil {
		return internalError("GetFile read", err)
	}

	c.Set("Content-Type", "application/octet-stream")
	c.Set("Content-Length", fmt.Sprintf("%d", len(fileData)))
	c.Set("Cache-Control", "private, max-age=31536000, immutable")
	c.Set("X-Content-Type-Options", "nosniff")
	return c.Send(fileData)
}

// ChatHistory — suhbatdagi xabarlar tarixi qaytariladi.
// Foydalanuvchi yuborgan va qabul qilgan barcha xabarlar (vaqt bo'yicha ASC).
// Ochish mijozda amalga oshiriladi.
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
        SELECT id, sender_id, ciphertext, msg_type, created_at, delivered, read
          FROM (
            SELECT m.id::text, m.sender_id::text,
                   convert_from(m.ciphertext, 'UTF8') AS ciphertext,
                   m.msg_type, m.created_at,
                   m.delivered_at IS NOT NULL AS delivered,
                   m.read_at IS NOT NULL AS read
              FROM messages m
             WHERE m.chat_id = $1::uuid
               AND (
                 EXISTS (SELECT 1 FROM chats c WHERE c.id = m.chat_id AND c.type = 'channel')
                 OR m.sender_id = $2::uuid OR m.recipient_id = $2::uuid
               )
             ORDER BY m.created_at DESC
             LIMIT $3
          ) recent
         ORDER BY created_at ASC`, chatID, selfID, limit)
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
