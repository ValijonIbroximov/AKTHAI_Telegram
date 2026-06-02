// Fayl: server/internal/api/spa.go
// Maqsad: React SPA ning statik fayllarini xizmatga qo'yadi.
// Barcha noma'lum marshrut uchun index.html qaytariladi (client-side routing).
package api

import (
	"net/http"
	"os"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/filesystem"
)

// ServeSPA — React dist papkasini statik fayl sifatida taqdim etuvchi handler.
// /api/* va /ws marshruti bundan mustasno — ular avvalroq ro'yxatdan o'tgan.
// Noma'lum fayl so'ralganda index.html qaytariladi (SPA klient marshrutlashi).
func ServeSPA(distDir string) fiber.Handler {
	// Papka mavjudligini tekshirish
	if _, err := os.Stat(distDir); os.IsNotExist(err) {
		return func(c *fiber.Ctx) error {
			return c.Status(fiber.StatusServiceUnavailable).
				JSON(fiber.Map{"error": "web-dist papkasi topilmadi: " + distDir})
		}
	}

	return filesystem.New(filesystem.Config{
		Root:         http.Dir(distDir),
		NotFoundFile: "index.html",  // SPA fallback
		Index:        "index.html",
		Browse:       false,
	})
}
