// Fayl: server/internal/ws/handler.go
// Maqsad: HTTP so'rovini WebSocket aloqasiga ko'tarish va paketlarni Hub'ga uzatish.
package ws

import (
	"encoding/json"
	"time"

	fws "github.com/gofiber/contrib/websocket"
)

// ServeWS — WebSocket'ga ulangan har bir mijoz uchun ishlovchi gorutin.
// Har bir ulanish uchun alohida goroutin ishlatiladi — server xotirasi tejamkor saqlanadi.
func ServeWS(hub *Hub) func(c *fws.Conn) {
	return func(c *fws.Conn) {
		userID, _ := c.Locals("user_id").(string)

		client := &Client{
			UserID: userID,
			Send:   make(chan []byte, 64),
		}
		hub.Register() <- client
		defer func() { hub.Unregister() <- client }()

		// Yozish goroutini — Send kanalidagi paketlar mijozga uzatiladi
		go func() {
			ticker := time.NewTicker(30 * time.Second)
			defer ticker.Stop()
			for {
				select {
				case msg, ok := <-client.Send:
					if !ok {
						_ = c.WriteMessage(fws.CloseMessage, []byte{})
						return
					}
					_ = c.SetWriteDeadline(time.Now().Add(10 * time.Second))
					if err := c.WriteMessage(fws.TextMessage, msg); err != nil {
						return
					}
				case <-ticker.C:
					// Ulanish tirik ekanligini tekshirish uchun ping yuboriladi
					_ = c.SetWriteDeadline(time.Now().Add(10 * time.Second))
					if err := c.WriteMessage(fws.PingMessage, nil); err != nil {
						return
					}
				}
			}
		}()

		// O'qish halqasi — kiruvchi paketlar Hub'ga yuboriladi
		c.SetReadLimit(128 * 1024)
		c.SetReadDeadline(time.Now().Add(60 * time.Second))
		c.SetPongHandler(func(string) error {
			c.SetReadDeadline(time.Now().Add(60 * time.Second))
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
			env.From = userID
			hub.Inbound() <- env
		}
	}
}
