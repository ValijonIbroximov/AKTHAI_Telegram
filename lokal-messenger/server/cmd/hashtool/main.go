// Fayl: server/cmd/hashtool/main.go
// Maqsad: Argon2id xeshini terminalda chiqaradigan yordamchi vosita.
//
//	Birinchi admin hisobini qo'lda yaratishda parol xeshini olish uchun ishlatiladi.
package main

import (
	"fmt"
	"os"

	"github.com/military/lokal-messenger/server/internal/auth"
	"github.com/military/lokal-messenger/server/internal/config"
)

func main() {
	if len(os.Args) < 2 {
		fmt.Println("Foydalanish: hashtool <parol>")
		os.Exit(1)
	}

	// Argon2id parametrlari konfiguratsiyadagi standart qiymatlar bilan mos keladi
	h, err := auth.HashPassword(os.Args[1], config.Argon2Params{
		Memory:      65536,
		Iterations:  3,
		Parallelism: 2,
		SaltLength:  16,
		KeyLength:   32,
	})
	if err != nil {
		panic(err)
	}
	fmt.Println(h)
}
