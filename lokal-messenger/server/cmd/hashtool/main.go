// Fayl: server/cmd/hashtool/main.go
// Maqsad: Argon2id xeshini terminalda chiqaradigan yordamchi vosita.
// Birinchi admin parolini bazaga qo'shishdan oldin xesh generatsiya qilish uchun ishlatiladi.
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
		fmt.Println("Misol:       hashtool 'AdminParol123!'")
		os.Exit(1)
	}

	// Standart Argon2id parametrlari — config.yaml dagi qiymatlar bilan bir xil
	params := config.Argon2Params{
		Memory:      65536,
		Iterations:  3,
		Parallelism: 2,
		SaltLength:  16,
		KeyLength:   32,
	}

	h, err := auth.HashPassword(os.Args[1], params)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Xesh yaratilmadi: %v\n", err)
		os.Exit(1)
	}
	fmt.Println(h)
}
