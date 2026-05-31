// Fayl: server/cmd/server/main.go
// Maqsad: Server jarayoni ishga tushiriladi, barcha qism-tizimlar ulanadi.
package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/military/lokal-messenger/server/internal/api"
	"github.com/military/lokal-messenger/server/internal/auth"
	"github.com/military/lokal-messenger/server/internal/cache"
	"github.com/military/lokal-messenger/server/internal/config"
	"github.com/military/lokal-messenger/server/internal/db"
	"github.com/military/lokal-messenger/server/internal/ws"
)

func main() {
	// Konfiguratsiya fayl yo'li argumentdan yoki standart qiymatdan olinadi
	configPath := "config.yaml"
	if len(os.Args) > 1 {
		configPath = os.Args[1]
	}

	// Konfiguratsiya fayldan o'qiladi
	cfg, err := config.Load(configPath)
	if err != nil {
		log.Fatalf("Konfiguratsiyani o'qib bo'lmadi: %v", err)
	}

	// Ma'lumotlar bazasi (PostgreSQL) ga ulanish hosil qilinadi
	pgPool, err := db.NewPool(context.Background(), cfg.Database)
	if err != nil {
		log.Fatalf("PostgreSQL ulanishi xato: %v", err)
	}
	defer pgPool.Close()

	// Redis kesh ulanishi tayyorlanadi
	redisClient, err := cache.NewClient(cfg.Redis)
	if err != nil {
		log.Fatalf("Redis ulanishi xato: %v", err)
	}
	defer redisClient.Close()

	// JWT manager — sessiya tokenlarini chiqarish va tekshirish uchun
	jwtMgr, err := auth.NewJWTManager(cfg.Auth)
	if err != nil {
		log.Fatalf("JWT kalit yuklanmadi: %v", err)
	}

	// WebSocket Hub — bog'langan mijozlar uchun markaziy yetkazuvchi
	hubCtx, hubCancel := context.WithCancel(context.Background())
	defer hubCancel()
	hub := ws.NewHub(pgPool, redisClient)
	go hub.Run(hubCtx)

	// Fiber HTTP/WS freymvorki sozlanadi (kam xotira sarfi rejimida)
	app := fiber.New(fiber.Config{
		AppName:               "LokalMessenger/1.0",
		DisableStartupMessage: true,
		ReadTimeout:           30 * time.Second,
		WriteTimeout:          30 * time.Second,
		BodyLimit:             int(cfg.Limits.MaxMessageSizeBytes) * 2,
		ErrorHandler:          api.ErrorHandler,
	})

	// Panic-recovery va so'rov jurnali middlewarelari ulanadi
	app.Use(recover.New())
	app.Use(logger.New(logger.Config{
		Format: "[${time}] ${status} ${method} ${path} (${ip}) ${latency}\n",
	}))

	// REST va WebSocket marshrutlari ro'yxatdan o'tkaziladi
	api.RegisterRoutes(app, &api.Deps{
		DB:     pgPool,
		Cache:  redisClient,
		JWT:    jwtMgr,
		Hub:    hub,
		Config: cfg,
	})

	// Server alohida gorutinda ishga tushiriladi (TLS yoqilgan bo'lsa shifrlangan kanalda)
	go func() {
		if cfg.Server.TLS.Enabled {
			log.Printf("Server TLS bilan tinglanmoqda: %s", cfg.Server.BindAddress)
			if err := app.ListenTLS(cfg.Server.BindAddress,
				cfg.Server.TLS.CertFile, cfg.Server.TLS.KeyFile); err != nil {
				log.Fatalf("TLS server xatosi: %v", err)
			}
		} else {
			log.Printf("Server tinglanmoqda: %s", cfg.Server.BindAddress)
			if err := app.Listen(cfg.Server.BindAddress); err != nil {
				log.Fatalf("Server xatosi: %v", err)
			}
		}
	}()

	// Tizim signali kutiladi (Ctrl+C, SIGTERM)
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	<-sigCh
	log.Println("Server to'xtatish jarayoni boshlandi...")

	// Bog'langan mijozlar nazokat bilan uziladi
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	_ = app.ShutdownWithContext(shutdownCtx)
	log.Println("Server to'xtatildi.")
}
