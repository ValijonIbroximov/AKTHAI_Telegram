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
	v1.Post("/auth/dismiss-password-change", h.DismissPasswordChange)
	v1.Post("/auth/logout", h.Logout)
	v1.Get("/me", h.Me)
	v1.Get("/me/profile", h.GetMyProfile)
	v1.Patch("/me/profile", h.UpdateMyProfile)
	v1.Post("/me/avatar", h.UploadMyAvatar)
	v1.Delete("/me/avatar", h.DeleteMyAvatar)
	v1.Get("/avatars/:id", h.GetUserAvatar)
	v1.Patch("/me/privacy", h.UpdatePrivacy)

	// Signal Protocol kalit-bundle marshrutlari
	v1.Post("/keys/upload", h.UploadKeyBundle)
	v1.Get("/keys/:id/bundle", h.FetchKeyBundle)
	v1.Post("/keys/refill-otpks", h.RefillOneTimePreKeys)

	// Suhbatlar va xabarlar tarixi (shifrlangan)
	v1.Get("/chats", h.ListChats)
	v1.Post("/chats", h.CreateChat)
	v1.Get("/chats/:id/messages", h.ChatHistory)
	v1.Get("/chats/:id/members", h.ListGroupMembers)
	v1.Post("/chats/:id/members", h.AddGroupMember)
	v1.Delete("/chats/:id/members/:uid", h.RemoveGroupMember)
	v1.Patch("/chats/:id/members/:uid", h.UpdateGroupMemberRole)
	v1.Get("/chats/:id/group-key", h.GetGroupKeyEnvelope)
	v1.Get("/chats/:id/group-key/vault", h.GetGroupKeyVault)
	v1.Put("/chats/:id/group-key/vault", h.PutGroupKeyVault)
	v1.Post("/chats/:id/group-key/request", h.RequestGroupKey)
	v1.Put("/chats/:id/group-key", h.PutGroupKeyEnvelopes)
	v1.Post("/chats/:id/invite", h.CreateGroupInvite)
	v1.Get("/chats/:id/invite", h.ListGroupInvites)
	v1.Delete("/chats/:id/invite/:token", h.RevokeGroupInvite)
	v1.Get("/invite/:token", h.PreviewGroupInvite)
	v1.Post("/invite/:token/join", h.JoinGroupInvite)

	// Foydalanuvchilar katalogi
	v1.Get("/users", h.ListUsers)
	v1.Get("/users/directory", h.ListUsersDirectory)

	// Shifrlangan media fayllar (AES-256-GCM blob)
	// Server faylning mazmunini bilmaydi — faqat shifrlangan baytlar saqlanadi.
	v1.Post("/upload", h.UploadFile)
	v1.Get("/files/:id", h.GetFile)

	// Faqat admin uchun marshrutlar (RBAC: "admin" roli talab qilinadi)
	admin := v1.Group("/admin", middleware.RequireRole("admin"))
	admin.Get("/stats", h.AdminStats)
	admin.Get("/users", h.AdminListUsers)
	admin.Post("/users", h.AdminCreateUser)
	admin.Put("/users/:id", h.AdminUpdateUser)
	admin.Patch("/users/:id/active", h.AdminSetActive)
	admin.Delete("/users/:id", h.AdminDeleteUser)
	admin.Post("/users/:id/reset-password", h.AdminResetPassword)
	admin.Get("/users/:id/presence", h.AdminGetUserPresence)
	admin.Get("/chats", h.AdminListChats)
	admin.Get("/chats/:id/messages", h.AdminChatMessages)
	admin.Get("/audit-log", h.AdminAuditLogFiltered)
	admin.Get("/profile-policy", h.AdminGetProfilePolicy)
	admin.Put("/profile-policy", h.AdminSetProfilePolicy)

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
