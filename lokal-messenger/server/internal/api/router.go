// Fayl: server/internal/api/router.go
// Maqsad: Barcha REST va WebSocket marshrutlari yagona joyda ro'yxatdan o'tkaziladi.
package api

import (
	"github.com/gofiber/fiber/v2"
	fws "github.com/gofiber/contrib/websocket"

	"github.com/military/lokal-messenger/server/internal/middleware"
	"github.com/military/lokal-messenger/server/internal/ws"
)

// RegisterRoutes — barcha marshrutlar Fiber ilovasiga biriktiriladi.
func RegisterRoutes(app *fiber.App, deps *Deps) {
	h := &Handlers{deps: deps}

	// Sogʻliq tekshiruvi — load balancer uchun
	app.Get("/healthz", func(c *fiber.Ctx) error {
		return c.SendString("ok")
	})

	// Ochiq marshrut — autentifikatsiyasiz
	app.Post("/api/v1/auth/login", h.Login)

	// Autentifikatsiya talab qilinadigan REST marshrutlari
	authMW := middleware.Authenticate(deps.JWT, deps.Cache)
	v1 := app.Group("/api/v1", authMW)

	// Joriy foydalanuvchi amallari
	v1.Put("/auth/password", h.ChangePassword)
	v1.Post("/auth/change-password", h.ChangePassword)
	v1.Post("/auth/logout", h.Logout)
	v1.Get("/me", h.Me)
	v1.Patch("/me/privacy", h.UpdatePrivacy)

	// Signal Protocol kalit-bundle marshrutlari
	v1.Post("/keys/upload", h.UploadKeyBundle)
	v1.Get("/keys/:id/bundle", h.FetchKeyBundle)
	v1.Post("/keys/refill-otpks", h.RefillOneTimePreKeys)

	// Suhbatlar va xabarlar tarixi (shifrlangan)
	v1.Get("/chats", h.ListChats)
	v1.Post("/chats", h.CreateChat)
	v1.Get("/chats/:id/messages", h.ChatHistory)

	// Foydalanuvchilar katalogi
	v1.Get("/users", h.ListUsers)
	v1.Get("/users/directory", h.ListUsersDirectory)

	// Shifrlangan media fayllar (AES-256-GCM blob)
	// Server faylning mazmunini bilmaydi — faqat shifrlangan baytlar saqlanadi.
	v1.Post("/upload", h.UploadFile)
	v1.Get("/files/:id", h.GetFile)

	// Faqat admin uchun marshrutlar (RBAC: "admin" roli talab qilinadi)
	admin := v1.Group("/admin", middleware.RequireRole("admin"))
	admin.Get("/users", h.AdminListUsers)
	admin.Post("/users", h.AdminCreateUser)
	admin.Patch("/users/:id/active", h.AdminSetActive)
	admin.Get("/audit-log", h.AdminAuditLog)

	// WebSocket marshruti — upgrade tekshiruvi middleware sifatida
	app.Use("/ws", authMW, func(c *fiber.Ctx) error {
		if fws.IsWebSocketUpgrade(c) {
			c.Locals("allowed", true)
			return c.Next()
		}
		return fiber.ErrUpgradeRequired
	})
	app.Get("/ws", fws.New(ws.ServeWS(deps.Hub), fws.Config{
		ReadBufferSize:  4096,
		WriteBufferSize: 4096,
	}))

	// Brauzer orqali kirish: React SPA statik fayllarini xizmatga qo'yish.
	// -web-dist bayrog'i berilgandagina yoqiladi.
	// /api va /ws marshrutlari yuqorida ro'yxatga olingan — ular ustunlik qiladi.
	if deps.WebDistDir != "" {
		app.Use("/", ServeSPA(deps.WebDistDir))
	}
}
