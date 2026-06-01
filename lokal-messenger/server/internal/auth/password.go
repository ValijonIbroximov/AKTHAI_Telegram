// Fayl: server/internal/auth/password.go
// Maqsad: Foydalanuvchi parollari Argon2id algoritmi bilan xeshlanadi.
// config.Argon2Params ishlatiladi — ikki paketda dublikat ta'rif yo'q.
package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"

	"golang.org/x/crypto/argon2"

	"github.com/military/lokal-messenger/server/internal/config"
)

// HashPassword — parol Argon2id algoritmi bilan xeshlanadi.
// Natija "argon2id$v=19$m=...,t=...,p=...$salt$hash" formatda qaytariladi.
func HashPassword(password string, p config.Argon2Params) (string, error) {
	salt := make([]byte, p.SaltLength)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("tuz yaratilmadi: %w", err)
	}

	// Argon2id xeshi hisoblanadi
	hash := argon2.IDKey([]byte(password), salt,
		p.Iterations, p.Memory, p.Parallelism, p.KeyLength)

	// PHC-ga yaqin formatda kodlanadi (5 qism, $ bilan ajratilgan)
	encoded := fmt.Sprintf("argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version, p.Memory, p.Iterations, p.Parallelism,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(hash))
	return encoded, nil
}

// VerifyPassword — foydalanuvchi kiritgan parol xesh bilan solishtiriladi.
// Vaqt-konstantali taqqoslash (timing attack'dan himoya) ishlatiladi.
func VerifyPassword(password, encoded string) (bool, error) {
	parts := strings.Split(encoded, "$")
	// Format: argon2id $ v=19 $ m=...,t=...,p=... $ salt $ hash  (5 qism)
	if len(parts) != 5 || parts[0] != "argon2id" {
		return false, errors.New("xesh formati noto'g'ri")
	}

	var version int
	fmt.Sscanf(parts[1], "v=%d", &version)

	var memory, iterations uint32
	var parallelism uint8
	fmt.Sscanf(parts[2], "m=%d,t=%d,p=%d", &memory, &iterations, &parallelism)

	salt, err := base64.RawStdEncoding.DecodeString(parts[3])
	if err != nil {
		return false, err
	}
	expected, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return false, err
	}

	// Foydalanuvchi kiritgan parolning xeshi qayta hisoblanadi
	actual := argon2.IDKey([]byte(password), salt,
		iterations, memory, parallelism, uint32(len(expected)))

	// Vaqt-konstantali solishtirish bajariladi
	return subtle.ConstantTimeCompare(actual, expected) == 1, nil
}
