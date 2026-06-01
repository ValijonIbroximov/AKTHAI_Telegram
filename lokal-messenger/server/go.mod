// Fayl: server/go.mod
// Maqsad: Go modulining nomi va tashqi qaramliklari e'lon qilinadi.
module github.com/military/lokal-messenger/server

go 1.22

require (
	github.com/gofiber/contrib/websocket v1.3.2 // WebSocket qatlami
	github.com/gofiber/fiber/v2 v2.52.5 // Yengil HTTP freymvork (kam xotira sarfi)
	github.com/golang-jwt/jwt/v5 v5.2.1 // Sessiya tokenlari (JWT)
	github.com/google/uuid v1.6.0 // UUID generatsiyasi
	github.com/jackc/pgx/v5 v5.6.0 // PostgreSQL drayveri va hovuzi
	github.com/redis/go-redis/v9 v9.5.3 // Redis mijozi
	golang.org/x/crypto v0.24.0 // Argon2id parol xeshlash
	gopkg.in/yaml.v3 v3.0.1 // Konfiguratsiya o'qish
)
