// Parolni o'rnatish / yangilash (mavjud foydalanuvchi uchun).
//
//   go run ./cmd/setpassword <username> <password>
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/military/lokal-messenger/server/internal/auth"
	"github.com/military/lokal-messenger/server/internal/config"
)

func main() {
	cfgPath := flag.String("config", "config.yaml", "config.yaml yo'li")
	flag.Parse()
	args := flag.Args()
	if len(args) < 2 {
		fmt.Fprintln(os.Stderr, "Ishlatish: go run ./cmd/setpassword <username> <password>")
		os.Exit(1)
	}
	username := args[0]
	password := args[1]

	cfg, err := config.Load(*cfgPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "❌ config: %v\n", err)
		os.Exit(2)
	}

	hash, err := auth.HashPassword(password, cfg.Auth.Argon2)
	if err != nil {
		fmt.Fprintf(os.Stderr, "❌ xesh: %v\n", err)
		os.Exit(3)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	pool, err := pgxpool.New(ctx, cfg.Database.DSN)
	if err != nil {
		fmt.Fprintf(os.Stderr, "❌ DB: %v\n", err)
		os.Exit(4)
	}
	defer pool.Close()

	tag, err := pool.Exec(ctx, `
		UPDATE users SET
		    password_hash = $1,
		    must_change_password = FALSE,
		    failed_login_attempts = 0,
		    locked_until = NULL,
		    is_active = TRUE
		WHERE username = $2`, hash, username)
	if err != nil {
		fmt.Fprintf(os.Stderr, "❌ yangilash: %v\n", err)
		os.Exit(5)
	}
	if tag.RowsAffected() == 0 {
		fmt.Fprintf(os.Stderr, "❌ Foydalanuvchi topilmadi: %q\n", username)
		os.Exit(6)
	}
	fmt.Printf("✅ Parol yangilandi: %s\n", username)
}
