// Fayl: server/internal/ws/hub.go
// Maqsad: Bog'langan mijozlar ro'yxati saqlanadi va shifrlangan xabarlar
//         tegishli adresatga uzatiladi. Server ciphertext'ni hech qachon ochmaydi.
package ws

import (
	"context"
	"encoding/json"
	"log"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

// Client — bitta WebSocket ulanishini ifodalaydi.
type Client struct {
	UserID string
	Send   chan []byte
	closed bool
}

// Hub — barcha bog'langan mijozlarni boshqaruvchi markaziy ob'ekt.
type Hub struct {
	db       *pgxpool.Pool
	rdb      *redis.Client
	mu       sync.RWMutex
	clients  map[string]*Client
	register chan *Client
	unreg    chan *Client
	inbound  chan inboundEnvelope
}

// inboundEnvelope — mijozdan kelayotgan JSON paket strukturasi.
type inboundEnvelope struct {
	From    string          `json:"-"`
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

// NewHub — yangi Hub yaratiladi.
func NewHub(db *pgxpool.Pool, rdb *redis.Client) *Hub {
	return &Hub{
		db:       db,
		rdb:      rdb,
		clients:  make(map[string]*Client),
		register: make(chan *Client, 64),
		unreg:    make(chan *Client, 64),
		inbound:  make(chan inboundEnvelope, 1024),
	}
}

// Run — Hub asosiy tsikli; ctx bekor qilinguncha ishlaydi.
func (h *Hub) Run(ctx context.Context) {
	presenceTick := time.NewTicker(30 * time.Second)
	defer presenceTick.Stop()

	for {
		select {
		case <-ctx.Done():
			return

		case c := <-h.register:
			h.mu.Lock()
			h.clients[c.UserID] = c
			h.mu.Unlock()
			_ = h.rdb.SAdd(ctx, "presence:online_set", c.UserID).Err()
			_ = h.rdb.Set(ctx, "presence:"+c.UserID, time.Now().Unix(), 90*time.Second).Err()
			log.Printf("Mijoz ulandi: %s", c.UserID)
			// Offline bo'lgan vaqtda yig'ilgan xabarlar uzatiladi
			go h.flushPending(ctx, c)

		case c := <-h.unreg:
			h.mu.Lock()
			if cur, ok := h.clients[c.UserID]; ok && cur == c {
				delete(h.clients, c.UserID)
				close(c.Send)
				c.closed = true
			}
			h.mu.Unlock()
			_ = h.rdb.SRem(ctx, "presence:online_set", c.UserID).Err()
			_ = h.rdb.Del(ctx, "presence:"+c.UserID).Err()
			log.Printf("Mijoz uzildi: %s", c.UserID)

		case env := <-h.inbound:
			h.handleInbound(ctx, env)

		case <-presenceTick.C:
			// Barcha onlayn foydalanuvchilarning presence TTL'i yangilanadi
			h.mu.RLock()
			for uid := range h.clients {
				_ = h.rdb.Set(ctx, "presence:"+uid, time.Now().Unix(), 90*time.Second).Err()
			}
			h.mu.RUnlock()
		}
	}
}

// handleInbound — kiruvchi paket turi bo'yicha tegishli funksiyaga yo'naltiriladi.
func (h *Hub) handleInbound(ctx context.Context, env inboundEnvelope) {
	switch env.Type {
	case "msg.send":
		h.routeMessage(ctx, env)
	case "msg.delivered":
		h.markDelivered(ctx, env)
	case "msg.read":
		h.markRead(ctx, env)
	}
}

// sendPayload — "msg.send" tipidagi paket tarkibi.
type sendPayload struct {
	ChatID        string `json:"chat_id"`
	RecipientID   string `json:"recipient_id"`
	CiphertextB64 string `json:"ciphertext"`
	MsgType       int    `json:"msg_type"`
	ClientMsgID   string `json:"client_msg_id"`
}

// routeMessage — shifrlangan xabar bazaga yoziladi va adresatga uzatiladi.
// Server ciphertext'ni hech qachon ochmaydi — faqat bayt sifatida marshrutlaydi.
func (h *Hub) routeMessage(ctx context.Context, env inboundEnvelope) {
	var p sendPayload
	if err := json.Unmarshal(env.Payload, &p); err != nil {
		return
	}

	var msgID string
	err := h.db.QueryRow(ctx, `
		INSERT INTO messages (chat_id, sender_id, recipient_id, ciphertext, msg_type)
		VALUES ($1::uuid, $2::uuid, $3::uuid, decode($4, 'base64'), $5)
		RETURNING id::text
	`, p.ChatID, env.From, p.RecipientID, p.CiphertextB64, p.MsgType).Scan(&msgID)
	if err != nil {
		log.Printf("xabar saqlanmadi: %v", err)
		return
	}

	// Yuboruvchiga yetkazib berish tasdiqnomasi qaytariladi
	h.sendTo(env.From, "msg.ack", map[string]any{
		"client_msg_id": p.ClientMsgID,
		"server_msg_id": msgID,
	})

	// Adresat onlayn bo'lsa shifrlangan xabar darhol uzatiladi
	delivered := h.sendTo(p.RecipientID, "msg.recv", map[string]any{
		"msg_id":     msgID,
		"chat_id":    p.ChatID,
		"sender_id":  env.From,
		"ciphertext": p.CiphertextB64,
		"msg_type":   p.MsgType,
	})
	if delivered {
		_, _ = h.db.Exec(ctx,
			`UPDATE messages SET delivered_at = NOW() WHERE id = $1::uuid`, msgID)
	}
}

// flushPending — mijoz ulanganida unga yetkazilmagan xabarlar topiladi va yuboriladi.
func (h *Hub) flushPending(ctx context.Context, c *Client) {
	rows, err := h.db.Query(ctx, `
		SELECT id::text, chat_id::text, sender_id::text,
		       encode(ciphertext, 'base64'), msg_type
		  FROM messages
		 WHERE recipient_id = $1::uuid AND delivered_at IS NULL
		 ORDER BY created_at ASC
		 LIMIT 500
	`, c.UserID)
	if err != nil {
		return
	}
	defer rows.Close()

	for rows.Next() {
		var msgID, chatID, senderID, ct string
		var mtype int
		if err := rows.Scan(&msgID, &chatID, &senderID, &ct, &mtype); err != nil {
			continue
		}
		if h.sendTo(c.UserID, "msg.recv", map[string]any{
			"msg_id":     msgID,
			"chat_id":    chatID,
			"sender_id":  senderID,
			"ciphertext": ct,
			"msg_type":   mtype,
		}) {
			_, _ = h.db.Exec(ctx,
				`UPDATE messages SET delivered_at = NOW() WHERE id = $1::uuid`, msgID)
		}
	}
}

// sendTo — berilgan foydalanuvchiga JSON paket yuborishga uriniladi.
// Foydalanuvchi onlayn bo'lmasa false qaytariladi.
func (h *Hub) sendTo(userID, eventType string, payload any) bool {
	h.mu.RLock()
	c, ok := h.clients[userID]
	h.mu.RUnlock()
	if !ok || c.closed {
		return false
	}
	raw, _ := json.Marshal(map[string]any{"type": eventType, "payload": payload})
	select {
	case c.Send <- raw:
		return true
	default:
		// Yuborish bufer to'lgan bo'lsa — mijoz uzilgan deb belgilanadi
		h.unreg <- c
		return false
	}
}

// markDelivered — "msg.delivered" hodisasida xabar bazada belgilanadi.
func (h *Hub) markDelivered(ctx context.Context, env inboundEnvelope) {
	var p struct {
		MsgID string `json:"msg_id"`
	}
	if err := json.Unmarshal(env.Payload, &p); err != nil {
		return
	}
	_, _ = h.db.Exec(ctx,
		`UPDATE messages SET delivered_at = COALESCE(delivered_at, NOW())
		    WHERE id = $1::uuid AND recipient_id = $2::uuid`, p.MsgID, env.From)
}

// markRead — "msg.read" hodisasida xabar o'qilgan deb belgilanadi.
func (h *Hub) markRead(ctx context.Context, env inboundEnvelope) {
	var p struct {
		MsgID string `json:"msg_id"`
	}
	if err := json.Unmarshal(env.Payload, &p); err != nil {
		return
	}
	_, _ = h.db.Exec(ctx,
		`UPDATE messages SET read_at = NOW()
		    WHERE id = $1::uuid AND recipient_id = $2::uuid`, p.MsgID, env.From)
}

// Inbound — kiruvchi xabarlar kanaliga tashqi kirish imkoni.
func (h *Hub) Inbound() chan<- inboundEnvelope { return h.inbound }

// Register — yangi mijoz ro'yxatga olish kanaliga tashqi kirish imkoni.
func (h *Hub) Register() chan<- *Client { return h.register }

// Unregister — mijozni ro'yxatdan o'chirish kanaliga tashqi kirish imkoni.
func (h *Hub) Unregister() chan<- *Client { return h.unreg }
