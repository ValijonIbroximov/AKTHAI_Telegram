// Bazaga yangi ustunlarni qo'shadi (server ishlamasdan ham).
package main

import (
	"context"
	"fmt"
	"log"
	"os"

	"github.com/military/lokal-messenger/server/internal/config"
	"github.com/military/lokal-messenger/server/internal/db"
)

func main() {
	configPath := "config.yaml"
	if len(os.Args) > 1 {
		configPath = os.Args[1]
	}

	cfg, err := config.Load(configPath)
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	pool, err := db.NewPool(context.Background(), cfg.Database)
	if err != nil {
		log.Fatalf("db: %v", err)
	}
	defer pool.Close()

	fmt.Println("Schema yangilandi (hide_last_seen ustuni tayyor).")
}
