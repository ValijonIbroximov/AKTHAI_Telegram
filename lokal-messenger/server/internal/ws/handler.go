// Fayl: server/internal/ws/handler.go
// Maqsad: HTTP so'rovini WebSocket aloqasiga ko'tarish va paketlarni Hub'ga uzatish.
package ws

import (
	"encoding/json"
	"time"

	"github.com/gofiber/contrib/websocket"
)

// ServeWS — WebSocket'ga ulangan har bir mijoz uchun ishlovchi gorutin qaytaradi.
func ServeWS(hub *Hub) func(c *websocket.Conn) {
	return func(c *websocket.Conn) {
		// Foydalanuvchi identifikatori autentifikatsiya middleware'i tomonidan yozilgan
		userID, _ := c.Locals("user_id").(string)
		if userID == "" {
			_ = c.Close()
			return
		}

		client := &Client{
			UserID: userID,
			Send:   make(chan []byte, 64),
		}
		hub.Register() <- client
		defer func() { hub.Unregister() <- client }()

		// Yozish gorutini — Send kanalidagi paketlar mijozga uzatiladi
		go func() {
			ticker := time.NewTicker(30 * time.Second)
			defer ticker.Stop()
			for {
				select {
				case msg, ok := <-client.Send:
					if !ok {
						_ = c.WriteMessage(websocket.CloseMessage, []byte{})
						return
					}
					_ = c.SetWriteDeadline(time.Now().Add(10 * time.Second))
					if err := c.WriteMessage(websocket.TextMessage, msg); err != nil {
						return
					}
				case <-ticker.C:
					// Aloqani tirik saqlash uchun davriy ping yuboriladi
					_ = c.SetWriteDeadline(time.Now().Add(10 * time.Second))
					if err := c.WriteMessage(websocket.PingMessage, nil); err != nil {
						return
					}
				}
			}
		}()

		// O'qish halqasi — kiruvchi paketlar Hub'ga yuboriladi
		c.SetReadLimit(128 * 1024)
		_ = c.SetReadDeadline(time.Now().Add(60 * time.Second))
		c.SetPongHandler(func(string) error {
			_ = c.SetReadDeadline(time.Now().Add(60 * time.Second))
			return nil
		})

		for {
			_, raw, err := c.ReadMessage()
			if err != nil {
				return
			}
			var env inboundEnvelope
			if err := json.Unmarshal(raw, &env); err != nil {
				continue
			}
			// Yuboruvchi har doim autentifikatsiyalangan foydalanuvchi bo'ladi (soxtalashtirishdan himoya)
			env.From = userID
			hub.Inbound() <- env
		}
	}
}
