// Fayl: server/internal/api/router.go
// Maqsad: Barcha REST va WebSocket marshrutlari yagona joyda ro'yxatdan o'tkaziladi.
package api

import (
	"github.com/gofiber/contrib/websocket"
	"github.com/gofiber/fiber/v2"
	"github.com/military/lokal-messenger/server/internal/middleware"
	"github.com/military/lokal-messenger/server/internal/ws"
)

// RegisterRoutes — ilovaga barcha marshrutlar va middlewarelar biriktiriladi.
func RegisterRoutes(app *fiber.App, deps *Deps) {
	h := &Handlers{deps: deps}

	// Sog'liq tekshiruvi (autentifikatsiyasiz)
	app.Get("/healthz", func(c *fiber.Ctx) error { return c.SendString("ok") })

	// Ochiq marshrut — faqat login (ochiq ro'yxatdan o'tish yo'q)
	app.Post("/api/v1/auth/login", h.Login)

	// Autentifikatsiya talab qilinadigan marshrutlar guruhi
	authMW := middleware.Authenticate(deps.JWT, deps.Cache)
	v1 := app.Group("/api/v1", authMW)

	// Foydalanuvchining o'zi bilan bog'liq amallar
	v1.Post("/auth/change-password", h.ChangePassword)
	v1.Post("/auth/logout", h.Logout)
	v1.Get("/me", h.Me)

	// Signal Protocol kalit-bundle marshrutlari
	v1.Post("/keys/upload", h.UploadKeyBundle)
	v1.Get("/keys/:id/bundle", h.FetchKeyBundle)
	v1.Post("/keys/refill-otpks", h.RefillOneTimePreKeys)

	// Suhbatlar va shifrlangan xabarlar tarixi
	v1.Get("/chats", h.ListChats)
	v1.Post("/chats", h.CreateChat)
	v1.Get("/chats/:id/messages", h.ChatHistory)

	// Foydalanuvchilar katalogi
	v1.Get("/users", h.ListUsers)

	// Faqat admin uchun marshrutlar
	admin := v1.Group("/admin", middleware.RequireRole("admin"))
	admin.Post("/users", h.AdminCreateUser)
	admin.Patch("/users/:id/active", h.AdminSetActive)
	admin.Post("/users/:id/reset-password", h.AdminResetPassword)
	admin.Get("/audit-log", h.AdminAuditLog)

	// WebSocket marshruti — token so'rov parametri orqali tekshiriladi,
	// so'ngra aloqa WebSocket darajasiga ko'tariladi.
	app.Get("/ws",
		middleware.AuthenticateWS(deps.JWT, deps.Cache),
		websocket.New(ws.ServeWS(deps.Hub), websocket.Config{
			ReadBufferSize:  4096,
			WriteBufferSize: 4096,
		}),
	)
}
