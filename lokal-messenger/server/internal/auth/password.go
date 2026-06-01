// Fayl: server/internal/auth/password.go
// Maqsad: Foydalanuvchi parollari Argon2id algoritmi bilan xeshlanadi va
//
//	vaqt-konstantali tarzda solishtiriladi.
package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"

	"github.com/military/lokal-messenger/server/internal/config"
	"golang.org/x/crypto/argon2"
)

// ErrInvalidHash — saqlangan xesh formati noto'g'ri bo'lganda qaytariladi.
var ErrInvalidHash = errors.New("xesh formati noto'g'ri")

// HashPassword — yangi parol xeshlanadi va natija "argon2id$..." formatda qaytariladi.
func HashPassword(password string, p config.Argon2Params) (string, error) {
	// Tasodifiy tuz (salt) yaratiladi
	salt := make([]byte, p.SaltLength)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("tuz yaratilmadi: %w", err)
	}

	// Argon2id xeshi hisoblanadi
	hash := argon2.IDKey([]byte(password), salt,
		p.Iterations, p.Memory, p.Parallelism, p.KeyLength)

	// Natija standart, o'z-o'zini tavsiflovchi formatda kodlanadi
	encoded := fmt.Sprintf("argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version, p.Memory, p.Iterations, p.Parallelism,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(hash))
	return encoded, nil
}

// VerifyPassword — kiritilgan parol saqlangan xesh bilan solishtiriladi.
// Solishtirish vaqt-konstantali tarzda bajariladi (timing attack'dan himoya).
func VerifyPassword(password, encoded string) (bool, error) {
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[0] != "argon2id" {
		return false, ErrInvalidHash
	}

	var version int
	if _, err := fmt.Sscanf(parts[1], "v=%d", &version); err != nil {
		return false, ErrInvalidHash
	}

	var memory, iterations uint32
	var parallelism uint8
	if _, err := fmt.Sscanf(parts[2], "m=%d,t=%d,p=%d", &memory, &iterations, &parallelism); err != nil {
		return false, ErrInvalidHash
	}

	salt, err := base64.RawStdEncoding.DecodeString(parts[3])
	if err != nil {
		return false, err
	}
	expected, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return false, err
	}

	// Foydalanuvchi kiritgan parolning xeshi xuddi shu parametrlar bilan qayta hisoblanadi
	actual := argon2.IDKey([]byte(password), salt,
		iterations, memory, parallelism, uint32(len(expected)))

	// Ikki xesh vaqt-konstantali tarzda solishtiriladi
	return subtle.ConstantTimeCompare(actual, expected) == 1, nil
}
