// Fayl: server/internal/cache/keys.go
// Maqsad: Redis kalit-makonining (key namespace) yagona kelishuvi shu yerda
//
//	markazlashtiriladi. Bu Redis "sxemasi" vazifasini bajaradi.
package cache

import "fmt"

// Quyidagi konstantalar va yordamchi funksiyalar Redis kalitlarining
// tuzilishini belgilaydi. Maqsadlar:
//   - sessiya tokenlari (TTL: kirish vaqti + access_ttl)
//   - onlayn statuslar (TTL: ~90 sekund, har zarbada yangilanadi)
//   - onlayn foydalanuvchilar to'plami
//   - kirish urinishlarini cheklash (rate limit)
//   - bir martalik kalitlar zaxirasi past darajada ogohlantirishi

// SessionKey — JWT identifikatori (jti) bo'yicha sessiya kaliti qaytariladi.
// session:{jti} -> user_id
func SessionKey(jti string) string {
	return "session:" + jti
}

// PresenceKey — foydalanuvchining oxirgi "tirik" belgisi kaliti qaytariladi.
// presence:{user_id} -> last_heartbeat_unix
func PresenceKey(userID string) string {
	return "presence:" + userID
}

// PresenceOnlineSet — barcha onlayn foydalanuvchilar to'plamining kaliti.
const PresenceOnlineSet = "presence:online_set"

// LoginRateKey — IP bo'yicha kirish urinishlarini cheklash kaliti qaytariladi.
// ratelimit:login:{ip} -> counter (TTL: 5 daqiqa)
func LoginRateKey(ip string) string {
	return fmt.Sprintf("ratelimit:login:%s", ip)
}

// OTPKLowKey — bir martalik kalitlar zaxirasi pasayganda qo'yiladigan
// ogohlantirish kaliti qaytariladi.
// otpk_low:{user_id} -> 1 (TTL: 1 soat)
func OTPKLowKey(userID string) string {
	return "otpk_low:" + userID
}
