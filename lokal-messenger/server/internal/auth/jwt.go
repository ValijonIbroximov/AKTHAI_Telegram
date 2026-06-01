// Fayl: server/internal/auth/jwt.go
// Maqsad: Sessiya tokenlari (JWT) chiqariladi va tekshiriladi.
package auth

import (
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"

	"github.com/military/lokal-messenger/server/internal/config"
)

// JWTManager — token chiqarish va tekshirish uchun markaziy ob'ekt.
type JWTManager struct {
	secret    []byte
	accessTTL time.Duration
}

// Claims — JWT ichidagi foydalanuvchiga oid ma'lumotlar.
type Claims struct {
	UserID string `json:"sub"`
	Role   string `json:"role"`
	jwt.RegisteredClaims
}

// NewJWTManager — JWT kalit faylidan manager tayyorlanadi.
// Kalit kamida 32 bayt bo'lishi shart.
func NewJWTManager(cfg config.AuthConfig) (*JWTManager, error) {
	secret, err := os.ReadFile(cfg.JWTSecretFile)
	if err != nil {
		return nil, fmt.Errorf("JWT kalit o'qilmadi: %w", err)
	}
	if len(secret) < 32 {
		return nil, errors.New("JWT kalit kamida 32 bayt bo'lishi shart")
	}
	return &JWTManager{
		secret:    secret,
		accessTTL: time.Duration(cfg.AccessTTLMinutes) * time.Minute,
	}, nil
}

// Issue — userID va rol asosida yangi JWT token chiqariladi.
// Token matni va unikal JTI identifikatori qaytariladi.
func (m *JWTManager) Issue(userID, role string) (string, string, error) {
	jti := uuid.NewString()
	claims := Claims{
		UserID: userID,
		Role:   role,
		RegisteredClaims: jwt.RegisteredClaims{
			ID:        jti,
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(m.accessTTL)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			Issuer:    "lokal-messenger",
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString(m.secret)
	return signed, jti, err
}

// Verify — token tekshiriladi va Claims strukturasi qaytariladi.
// HMAC-SHA256 imzosi va muddati tekshiriladi.
func (m *JWTManager) Verify(tokenStr string) (*Claims, error) {
	parsed, err := jwt.ParseWithClaims(tokenStr, &Claims{},
		func(t *jwt.Token) (interface{}, error) {
			if t.Method.Alg() != jwt.SigningMethodHS256.Alg() {
				return nil, errors.New("kutilmagan imzolash usuli")
			}
			return m.secret, nil
		})
	if err != nil {
		return nil, err
	}
	claims, ok := parsed.Claims.(*Claims)
	if !ok || !parsed.Valid {
		return nil, errors.New("token noto'g'ri")
	}
	return claims, nil
}
