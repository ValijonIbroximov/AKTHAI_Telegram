// Parol tekshiruvi — faqat bo'sh emasligi talab qilinadi.
package auth

import (
	"errors"
	"strings"
)

var ErrEmptyPassword = errors.New("parol bo'sh bo'lmasligi kerak")

func ValidatePassword(password string) error {
	if strings.TrimSpace(password) == "" {
		return ErrEmptyPassword
	}
	return nil
}
