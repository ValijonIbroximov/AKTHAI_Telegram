// Fayl: server/internal/api/keys_routes.go
// Maqsad: Mijoz o'zining ochiq kalitlarini yuklaydi va boshqalarning bundle'ini so'raydi.
// Server faqat ochiq kalitlarni saqlaydi — shaxsiy kalitlar hech qachon serverga kelmaydi.
package api

import (
	"context"
	"encoding/base64"
	"log"

	"github.com/gofiber/fiber/v2"
)

type uploadIdentityRequest struct {
	RegistrationID int    `json:"registration_id"`
	IdentityKeyB64 string `json:"identity_key"`
	ForceOverwrite bool   `json:"force_overwrite"`
	SignedPreKey   struct {
		KeyID     int    `json:"key_id"`
		PublicKey string `json:"public_key"`
		Signature string `json:"signature"`
	} `json:"signed_prekey"`
	OneTimePreKeys []struct {
		KeyID     int    `json:"key_id"`
		PublicKey string `json:"public_key"`
	} `json:"one_time_prekeys"`
}

// UploadKeyBundle — foydalanuvchi birinchi marta tizimga kirgach o'z ochiq kalitlarini yuklaydi.
// Bu Signal Protocol X3DH uchun zarur bo'lgan identity, signed va one-time prekey'larni o'z ichiga oladi.
func (h *Handlers) UploadKeyBundle(c *fiber.Ctx) error {
	userID, _ := c.Locals("user_id").(string)
	if userID == "" {
		return fiber.NewError(fiber.StatusUnauthorized, "autentifikatsiya talab qilinadi")
	}

	var req uploadIdentityRequest
	if err := c.BodyParser(&req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "so'rov noto'g'ri")
	}
	log.Printf("[KEYS] ↑ upload: user=%s  otpk_count=%d  force_overwrite=%v",
		userID, len(req.OneTimePreKeys), req.ForceOverwrite)

	identityKey, err := base64.StdEncoding.DecodeString(req.IdentityKeyB64)
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "identity_key noaniq")
	}
	if len(identityKey) == 0 {
		return fiber.NewError(fiber.StatusBadRequest, "identity_key bo'sh")
	}

	spkPub, err := base64.StdEncoding.DecodeString(req.SignedPreKey.PublicKey)
	if err != nil || len(spkPub) == 0 {
		return fiber.NewError(fiber.StatusBadRequest, "signed_prekey.public_key noaniq")
	}
	spkSig, err := base64.StdEncoding.DecodeString(req.SignedPreKey.Signature)
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "signed_prekey.signature noaniq")
	}

	tx, err := h.deps.DB.Begin(c.Context())
	if err != nil {
		return internalError("[KEYS] begin tx", err)
	}
	committed := false
	defer func() {
		if !committed {
			if rbErr := tx.Rollback(context.Background()); rbErr != nil {
				log.Printf("[KEYS] WARNING rollback: %v", rbErr)
			}
		}
	}()

	// Identity kalit upsert qilinadi (qayta yuklash imkoniyati bor)
	_, err = tx.Exec(c.Context(), `
		INSERT INTO identity_keys (user_id, registration_id, identity_key)
		VALUES ($1::uuid, $2, $3)
		ON CONFLICT (user_id) DO UPDATE
		    SET registration_id = EXCLUDED.registration_id,
		        identity_key    = EXCLUDED.identity_key
	`, userID, req.RegistrationID, identityKey)
	if err != nil {
		return internalError("[KEYS] upsert identity_keys", err)
	}

	// Imzolangan oldindan-kalit yangilanadi
	_, err = tx.Exec(c.Context(), `
		INSERT INTO signed_prekeys (user_id, key_id, public_key, signature)
		VALUES ($1::uuid, $2, $3, $4)
		ON CONFLICT (user_id, key_id) DO UPDATE
		    SET public_key = EXCLUDED.public_key,
		        signature  = EXCLUDED.signature,
		        created_at = NOW()
	`, userID, req.SignedPreKey.KeyID, spkPub, spkSig)
	if err != nil {
		return internalError("[KEYS] upsert signed_prekeys", err)
	}

	// OTPK tozalash faqat force_overwrite da — oddiy sinxron OTPK'larni saqlaydi
	if req.ForceOverwrite {
		_, err = tx.Exec(c.Context(), `
			DELETE FROM one_time_prekeys WHERE user_id = $1::uuid
		`, userID)
		if err != nil {
			return internalError("[KEYS] delete one_time_prekeys", err)
		}
	}

	// force_overwrite: eski SPK yozuvlari ham tozalanadi (faqat yangi SPK qoladi)
	if req.ForceOverwrite {
		_, err = tx.Exec(c.Context(), `
			DELETE FROM signed_prekeys
			 WHERE user_id = $1::uuid AND key_id <> $2
		`, userID, req.SignedPreKey.KeyID)
		if err != nil {
			return internalError("[KEYS] delete stale signed_prekeys", err)
		}
	}

	// Bir martalik oldindan-kalitlar kiritiladi (force_overwrite → yangilash, aks holda qo'shish)
	for _, otpk := range req.OneTimePreKeys {
		pub, decErr := base64.StdEncoding.DecodeString(otpk.PublicKey)
		if decErr != nil || len(pub) == 0 {
			return fiber.NewError(fiber.StatusBadRequest, "one_time_prekeys.public_key noaniq")
		}
		if req.ForceOverwrite {
			_, err = tx.Exec(c.Context(), `
				INSERT INTO one_time_prekeys (user_id, key_id, public_key, used)
				VALUES ($1::uuid, $2, $3, FALSE)
				ON CONFLICT (user_id, key_id) DO UPDATE
				    SET public_key = EXCLUDED.public_key,
				        used       = FALSE,
				        created_at = NOW()
			`, userID, otpk.KeyID, pub)
		} else {
			_, err = tx.Exec(c.Context(), `
				INSERT INTO one_time_prekeys (user_id, key_id, public_key, used)
				VALUES ($1::uuid, $2, $3, FALSE)
				ON CONFLICT (user_id, key_id) DO NOTHING
			`, userID, otpk.KeyID, pub)
		}
		if err != nil {
			return internalError("[KEYS] insert one_time_prekeys", err)
		}
	}

	if err := tx.Commit(c.Context()); err != nil {
		return internalError("[KEYS] commit tx", err)
	}
	committed = true

	log.Printf("[KEYS] ✅ upload: user=%s  saqlandi", userID)
	return c.SendStatus(fiber.StatusNoContent)
}

// FetchKeyBundle — sherikning kalit-bundle'i olinadi.
// Bir martalik kalitlardan eng kichik raqamlisi atomik tarzda olinib, used=TRUE qo'yiladi.
// Bu X3DH sessiya o'rnatish uchun zarur.
func (h *Handlers) FetchKeyBundle(c *fiber.Ctx) error {
	targetID := c.Params("id")
	requesterID, _ := c.Locals("user_id").(string)
	log.Printf("[KEYS] ↓ bundle so'raldi: requester=%s  target=%s", requesterID, targetID)

	type signedPreKeyInfo struct {
		KeyID     int    `json:"key_id"`
		PublicKey string `json:"public_key"`
		Signature string `json:"signature"`
	}
	type oneTimePreKeyInfo struct {
		KeyID     int    `json:"key_id"`
		PublicKey string `json:"public_key"`
	}
	type bundle struct {
		UserID            string             `json:"user_id"`
		RegistrationID    int                `json:"registration_id"`
		IdentityKey       string             `json:"identity_key"`
		IdentityKeyX25519 string             `json:"identity_key_x25519"`
		SignedPreKey      signedPreKeyInfo   `json:"signed_prekey"`
		OneTimePreKey     *oneTimePreKeyInfo `json:"one_time_prekey,omitempty"`
	}

	var b bundle
	b.UserID = targetID

	var ikRaw, spkRaw, sigRaw []byte
	var spkID int
	err := h.deps.DB.QueryRow(c.Context(), `
		SELECT ik.registration_id, ik.identity_key,
		       spk.key_id, spk.public_key, spk.signature
		  FROM identity_keys ik
		  JOIN LATERAL (
		      SELECT key_id, public_key, signature
		        FROM signed_prekeys
		       WHERE user_id = ik.user_id
		       ORDER BY created_at DESC
		       LIMIT 1
		  ) spk ON TRUE
		 WHERE ik.user_id = $1::uuid
	`, targetID).Scan(&b.RegistrationID, &ikRaw, &spkID, &spkRaw, &sigRaw)
	if err != nil {
		log.Printf("[KEYS] ❌ bundle topilmadi: target=%s  err=%v", targetID, err)
		return fiber.NewError(fiber.StatusNotFound, "foydalanuvchi kalitlari topilmadi")
	}
	log.Printf("[KEYS] ✅ bundle topildi: target=%s  spk_id=%d", targetID, spkID)
	b.IdentityKey = base64.StdEncoding.EncodeToString(ikRaw)
	b.IdentityKeyX25519 = b.IdentityKey
	b.SignedPreKey = signedPreKeyInfo{
		KeyID:     spkID,
		PublicKey: base64.StdEncoding.EncodeToString(spkRaw),
		Signature: base64.StdEncoding.EncodeToString(sigRaw),
	}

	// Bir martalik kalit atomik tarzda olinadi va used=TRUE qo'yiladi
	var otpkID int
	var otpkPub []byte
	err = h.deps.DB.QueryRow(c.Context(), `
		UPDATE one_time_prekeys
		   SET used = TRUE
		 WHERE id = (
		    SELECT id FROM one_time_prekeys
		     WHERE user_id = $1::uuid AND used = FALSE
		     ORDER BY id ASC
		     LIMIT 1
		     FOR UPDATE SKIP LOCKED
		 )
		RETURNING key_id, public_key
	`, targetID).Scan(&otpkID, &otpkPub)
	if err == nil {
		b.OneTimePreKey = &oneTimePreKeyInfo{
			KeyID:     otpkID,
			PublicKey: base64.StdEncoding.EncodeToString(otpkPub),
		}
		log.Printf("[KEYS] OTPK berildi: target=%s  otpk_id=%d", targetID, otpkID)
	} else {
		log.Printf("[KEYS] OTPK yo'q (hammasi ishlatilgan): target=%s", targetID)
	}

	return c.JSON(b)
}
