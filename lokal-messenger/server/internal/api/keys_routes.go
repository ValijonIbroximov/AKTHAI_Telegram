// Fayl: server/internal/api/keys_routes.go
// Maqsad: Mijoz o'zining ochiq kalitlarini yuklaydi va boshqalarning bundle'ini so'raydi.
//
//	Server faqat ochiq kalitlarni biladi; shaxsiy kalitlar mijozda qoladi.
package api

import (
	"encoding/base64"

	"github.com/gofiber/fiber/v2"
	"github.com/military/lokal-messenger/server/internal/cache"
)

type uploadIdentityRequest struct {
	RegistrationID int    `json:"registration_id"`
	IdentityKeyB64 string `json:"identity_key"`
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

// UploadKeyBundle — foydalanuvchi (admin yaratgach) o'z ochiq kalitlarini yuklaydi.
func (h *Handlers) UploadKeyBundle(c *fiber.Ctx) error {
	userID, _ := c.Locals("user_id").(string)

	var req uploadIdentityRequest
	if err := c.BodyParser(&req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "so'rov noto'g'ri")
	}

	identityKey, err := base64.StdEncoding.DecodeString(req.IdentityKeyB64)
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "identity_key noaniq")
	}

	tx, err := h.deps.DB.Begin(c.Context())
	if err != nil {
		return err
	}
	defer tx.Rollback(c.Context())

	// Identity kalit upsert qilinadi
	_, err = tx.Exec(c.Context(), `
        INSERT INTO identity_keys (user_id, registration_id, identity_key)
        VALUES ($1::uuid, $2, $3)
        ON CONFLICT (user_id) DO UPDATE
            SET registration_id = EXCLUDED.registration_id,
                identity_key   = EXCLUDED.identity_key
    `, userID, req.RegistrationID, identityKey)
	if err != nil {
		return err
	}

	// Imzolangan oldindan-kalit yangilanadi
	spkPub, _ := base64.StdEncoding.DecodeString(req.SignedPreKey.PublicKey)
	spkSig, _ := base64.StdEncoding.DecodeString(req.SignedPreKey.Signature)
	_, err = tx.Exec(c.Context(), `
        INSERT INTO signed_prekeys (user_id, key_id, public_key, signature)
        VALUES ($1::uuid, $2, $3, $4)
        ON CONFLICT (user_id, key_id) DO UPDATE
            SET public_key = EXCLUDED.public_key,
                signature  = EXCLUDED.signature,
                created_at = NOW()
    `, userID, req.SignedPreKey.KeyID, spkPub, spkSig)
	if err != nil {
		return err
	}

	// Bir martalik oldindan-kalitlar partiya bilan kiritiladi
	for _, otpk := range req.OneTimePreKeys {
		pub, _ := base64.StdEncoding.DecodeString(otpk.PublicKey)
		_, err = tx.Exec(c.Context(), `
            INSERT INTO one_time_prekeys (user_id, key_id, public_key)
            VALUES ($1::uuid, $2, $3)
            ON CONFLICT (user_id, key_id) DO NOTHING
        `, userID, otpk.KeyID, pub)
		if err != nil {
			return err
		}
	}

	if err := tx.Commit(c.Context()); err != nil {
		return err
	}

	// Yangi kalit yuklangach, ehtimoliy "zaxira past" ogohlantirishi tozalanadi
	_ = h.deps.Cache.Del(c.Context(), cache.OTPKLowKey(userID)).Err()
	return c.SendStatus(fiber.StatusNoContent)
}

// FetchKeyBundle — sherikning kalit-bundle'i olinadi.
// Bir martalik kalitlardan eng kichik raqamlisi atom tarzda tanlab, used=TRUE qo'yiladi.
func (h *Handlers) FetchKeyBundle(c *fiber.Ctx) error {
	targetID := c.Params("id")

	type bundle struct {
		UserID         string `json:"user_id"`
		RegistrationID int    `json:"registration_id"`
		IdentityKey    string `json:"identity_key"`
		SignedPreKey   struct {
			KeyID     int    `json:"key_id"`
			PublicKey string `json:"public_key"`
			Signature string `json:"signature"`
		} `json:"signed_prekey"`
		OneTimePreKey *struct {
			KeyID     int    `json:"key_id"`
			PublicKey string `json:"public_key"`
		} `json:"one_time_prekey,omitempty"`
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
		return fiber.NewError(fiber.StatusNotFound, "foydalanuvchi kalitlari topilmadi")
	}
	b.IdentityKey = base64.StdEncoding.EncodeToString(ikRaw)
	b.SignedPreKey.KeyID = spkID
	b.SignedPreKey.PublicKey = base64.StdEncoding.EncodeToString(spkRaw)
	b.SignedPreKey.Signature = base64.StdEncoding.EncodeToString(sigRaw)

	// Bir martalik kalit atom tarzda olinadi va used=TRUE qo'yiladi (poyga holatidan himoya)
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
		b.OneTimePreKey = &struct {
			KeyID     int    `json:"key_id"`
			PublicKey string `json:"public_key"`
		}{KeyID: otpkID, PublicKey: base64.StdEncoding.EncodeToString(otpkPub)}
	}

	// Zaxira pasayganini aniqlash uchun qolgan kalitlar soni hisoblanadi
	var remaining int
	_ = h.deps.DB.QueryRow(c.Context(),
		`SELECT COUNT(*) FROM one_time_prekeys WHERE user_id = $1::uuid AND used = FALSE`,
		targetID).Scan(&remaining)
	if remaining < 10 {
		// Mijoz keyingi ulanishda zaxirani to'ldirishi uchun belgi qo'yiladi
		_ = h.deps.Cache.Set(c.Context(), cache.OTPKLowKey(targetID), 1, 0).Err()
	}

	return c.JSON(b)
}

type refillRequest struct {
	OneTimePreKeys []struct {
		KeyID     int    `json:"key_id"`
		PublicKey string `json:"public_key"`
	} `json:"one_time_prekeys"`
}

// RefillOneTimePreKeys — mijoz tugab borayotgan bir martalik kalitlar zaxirasini to'ldiradi.
func (h *Handlers) RefillOneTimePreKeys(c *fiber.Ctx) error {
	userID, _ := c.Locals("user_id").(string)

	var req refillRequest
	if err := c.BodyParser(&req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "so'rov noto'g'ri")
	}
	if len(req.OneTimePreKeys) == 0 {
		return fiber.NewError(fiber.StatusBadRequest, "kalitlar ro'yxati bo'sh")
	}

	tx, err := h.deps.DB.Begin(c.Context())
	if err != nil {
		return err
	}
	defer tx.Rollback(c.Context())

	for _, otpk := range req.OneTimePreKeys {
		pub, decErr := base64.StdEncoding.DecodeString(otpk.PublicKey)
		if decErr != nil {
			return fiber.NewError(fiber.StatusBadRequest, "kalit kodlovi noto'g'ri")
		}
		_, err = tx.Exec(c.Context(), `
            INSERT INTO one_time_prekeys (user_id, key_id, public_key)
            VALUES ($1::uuid, $2, $3)
            ON CONFLICT (user_id, key_id) DO NOTHING
        `, userID, otpk.KeyID, pub)
		if err != nil {
			return err
		}
	}

	if err := tx.Commit(c.Context()); err != nil {
		return err
	}
	_ = h.deps.Cache.Del(c.Context(), cache.OTPKLowKey(userID)).Err()
	return c.SendStatus(fiber.StatusNoContent)
}
