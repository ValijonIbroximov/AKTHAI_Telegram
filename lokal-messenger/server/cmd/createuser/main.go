// server/cmd/createuser/main.go
// Yangi foydalanuvchi yaratish CLI utilitasi.
//
// Ishlatish:
//   go run ./cmd/createuser <username> <password> [display_name] [role]
//
// Misollar:
//   go run ./cmd/createuser askar01 MaxfiyParol!
//   go run ./cmd/createuser askar02 Parol123! "Askar Toshmatov" user
//   go run ./cmd/createuser admin01 AdminParol! "Bosh Admin" admin
//
// Config fayl yo'li --config bayrog'i orqali berilishi mumkin (standart: ./config.yaml).
//
// Chiqish kodlari:
//   0 — muvaffaqiyatli
//   1 — argumentlar xatosi
//   2 — konfiguratsiya xatosi
//   3 — DB ulanish xatosi
//   4 — foydalanuvchi allaqachon mavjud
//   5 — boshqa DB xatosi

package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/military/lokal-messenger/server/internal/auth"
	"github.com/military/lokal-messenger/server/internal/config"
)

const (
	minPassLen      = 1
	maxPassLen      = 128
	minUsernameLen  = 3
	maxUsernameLen  = 64
	maxDisplayLen   = 128
)

// validUsername — faqat harf, raqam, pastki chiziq, chiziqcha
var validUsername = regexp.MustCompile(`^[a-zA-Z0-9_\-]+$`)

func main() {
	cfgPath := flag.String("config", "config.yaml", "config.yaml fayli yo'li")
	flag.Usage = func() {
		fmt.Fprintf(os.Stderr, `
Yangi foydalanuvchi yaratish CLI utilitasi
Ishlatish:
  go run ./cmd/createuser [xossalar] <username> <password> [display_name] [role]

Bayroqlar:
  -config  config.yaml yo'li (standart: ./config.yaml)

Argumentlar:
  username      Majburiy. Faqat [a-zA-Z0-9_-], 3–64 belgi.
  password      Majburiy. Bo'sh bo'lmasligi kerak.
  display_name  Ixtiyoriy. Ko'rsatma ism (standart: username bilan bir xil).
  role          Ixtiyoriy: "user" yoki "admin" (standart: "user").

Misollar:
  go run ./cmd/createuser askar01 MaxfiyParol!
  go run ./cmd/createuser askar02 Parol123! "Askar Toshmatov"
  go run ./cmd/createuser admin01 AdminParol! "Bosh Admin" admin
`)
	}
	flag.Parse()

	args := flag.Args()
	if len(args) < 2 {
		fmt.Fprintln(os.Stderr, "❌ Xatolik: username va password majburiy argumentlar.")
		flag.Usage()
		os.Exit(1)
	}

	username    := strings.TrimSpace(args[0])
	password    := args[1]
	displayName := username
	role        := "user"

	if len(args) >= 3 && strings.TrimSpace(args[2]) != "" {
		displayName = strings.TrimSpace(args[2])
	}
	if len(args) >= 4 {
		r := strings.ToLower(strings.TrimSpace(args[3]))
		if r != "admin" && r != "user" {
			fmt.Fprintf(os.Stderr, "❌ Xatolik: role faqat 'user' yoki 'admin' bo'lishi mumkin, berildi: %q\n", args[3])
			os.Exit(1)
		}
		role = r
	}

	// ── Kiritilgan qiymatlarni tekshirish ──────────────────────────────────

	if err := validateUsername(username); err != nil {
		fmt.Fprintf(os.Stderr, "❌ username xatosi: %s\n", err)
		os.Exit(1)
	}
	if err := validatePassword(password); err != nil {
		fmt.Fprintf(os.Stderr, "❌ password xatosi: %s\n", err)
		os.Exit(1)
	}
	if utf8.RuneCountInString(displayName) > maxDisplayLen {
		fmt.Fprintf(os.Stderr, "❌ display_name juda uzun (maks %d belgi)\n", maxDisplayLen)
		os.Exit(1)
	}

	// ── Konfiguratsiya yuklash ────────────────────────────────────────────

	cfg, err := config.Load(*cfgPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "❌ Konfiguratsiya o'qilmadi (%s): %v\n", *cfgPath, err)
		os.Exit(2)
	}

	// ── Parolni Argon2id bilan xeshlash ───────────────────────────────────

	fmt.Print("⏳ Parol xeshlanmoqda… ")
	hash, err := auth.HashPassword(password, cfg.Auth.Argon2)
	if err != nil {
		fmt.Fprintf(os.Stderr, "\n❌ Parolni xeshlashda xatolik: %v\n", err)
		os.Exit(5)
	}
	fmt.Println("✓")

	// ── PostgreSQL ga ulanish ─────────────────────────────────────────────

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	pool, err := pgxpool.New(ctx, cfg.Database.DSN)
	if err != nil {
		fmt.Fprintf(os.Stderr, "❌ DB ulanish xatosi: %v\n", err)
		os.Exit(3)
	}
	defer pool.Close()

	if err = pool.Ping(ctx); err != nil {
		fmt.Fprintf(os.Stderr, "❌ DB ping muvaffaqiyatsiz: %v\n", err)
		os.Exit(3)
	}

	// ── Foydalanuvchini bazaga qo'shish ───────────────────────────────────

	var newID string
	err = pool.QueryRow(ctx, `
		INSERT INTO users (username, password_hash, display_name, role, must_change_password, is_active)
		VALUES ($1, $2, $3, $4, TRUE, TRUE)
		RETURNING id::text
	`, username, hash, displayName, role).Scan(&newID)

	if err != nil {
		if isPgUniqueViolation(err) {
			fmt.Fprintf(os.Stderr, "❌ Foydalanuvchi allaqachon mavjud: username=%q\n", username)
			os.Exit(4)
		}
		fmt.Fprintf(os.Stderr, "❌ Bazaga yozishda xatolik: %v\n", err)
		os.Exit(5)
	}

	// ── Muvaffaqiyat ──────────────────────────────────────────────────────

	fmt.Printf(`
✅ Foydalanuvchi muvaffaqiyatli yaratildi!
   ID           : %s
   username     : %s
   display_name : %s
   role         : %s
   Parol o'zgartirish majburiy: HA (keyingi kirishda so'raladi)
`, newID, username, displayName, role)
}

// ── Yordamchi funksiyalar ─────────────────────────────────────────────────────

func validateUsername(u string) error {
	n := utf8.RuneCountInString(u)
	if n < minUsernameLen {
		return fmt.Errorf("kamida %d belgi bo'lishi kerak (hozir: %d)", minUsernameLen, n)
	}
	if n > maxUsernameLen {
		return fmt.Errorf("ko'pi bilan %d belgi bo'lishi mumkin (hozir: %d)", maxUsernameLen, n)
	}
	if !validUsername.MatchString(u) {
		return errors.New("faqat lotin harflari, raqamlar, '_' va '-' ruxsat etiladi")
	}
	return nil
}

func validatePassword(p string) error {
	n := utf8.RuneCountInString(p)
	if n < minPassLen {
		return fmt.Errorf("kamida %d belgi bo'lishi kerak (hozir: %d)", minPassLen, n)
	}
	if n > maxPassLen {
		return fmt.Errorf("ko'pi bilan %d belgi (hozir: %d)", maxPassLen, n)
	}
	return nil
}

// isPgUniqueViolation — PostgreSQL UNIQUE constraint buzilishi (23505) ni aniqlaydi.
func isPgUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code == "23505"
	}
	return strings.Contains(err.Error(), "23505") ||
		strings.Contains(strings.ToLower(err.Error()), "unique")
}
