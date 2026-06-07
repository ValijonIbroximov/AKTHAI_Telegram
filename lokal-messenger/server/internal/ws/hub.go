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
			log.Printf("[WS] 🟢 Ulanish: userID=%s | jami=%d", c.UserID, h.clientCount())
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
			log.Printf("[WS] 🔴 Uzilish: userID=%s | jami=%d", c.UserID, h.clientCount())

		case env := <-h.inbound:
			h.handleInbound(ctx, env)

		case <-presenceTick.C:
			h.mu.RLock()
			for uid := range h.clients {
				_ = h.rdb.Set(ctx, "presence:"+uid, time.Now().Unix(), 90*time.Second).Err()
			}
			h.mu.RUnlock()
		}
	}
}

func (h *Hub) clientCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}

// handleInbound — kiruvchi paket turi bo'yicha tegishli funksiyaga yo'naltiriladi.
//
// Signal Protocol standart yondashuv:
//   key_exchange va session.rekey_request eventlari YO'Q.
//   Birinchi xabar = PreKeySignalMessage (msg_type=3) — barcha kalit almashinuvi ichida.
//   Server oddiy "msg.send" kabi DB ga saqlaydi → offline yetkazish ishlaydi.
func (h *Hub) handleInbound(ctx context.Context, env inboundEnvelope) {
	log.Printf("[WS] ← kiruvchi: from=%s type=%s", env.From, env.Type)
	switch env.Type {
	case "msg.send":
		h.routeMessage(ctx, env)
	case "msg.delivered":
		h.markDelivered(ctx, env)
	case "msg.read":
		h.markRead(ctx, env)
	case "session.rekey_request":
		h.routeSessionRekey(env)
	case "ping":
		// Ping — e'tiborsiz
	default:
		log.Printf("[WS] ⚠ Noma'lum paket turi: %s (from=%s)", env.Type, env.From)
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
func (h *Hub) routeMessage(ctx context.Context, env inboundEnvelope) {
	var p sendPayload
	if err := json.Unmarshal(env.Payload, &p); err != nil {
		log.Printf("[WS] ✗ msg.send JSON parse xatoligi (from=%s): %v", env.From, err)
		return
	}

	log.Printf("[WS] 📨 msg.send: from=%s → to=%s | chat=%s | ct_len=%d",
		env.From, p.RecipientID, p.ChatID, len(p.CiphertextB64))

	// Ciphertext JSON string sifatida keladi (Rust va browser ikkalasi ham JSON qaytaradi).
	// decode('json','base64') ishlamaydi — to'g'ridan-to'g'ri bytea sifatida saqlaymiz.
	var msgID string
	var createdAt time.Time
	err := h.db.QueryRow(ctx, `
		INSERT INTO messages (chat_id, sender_id, recipient_id, ciphertext, msg_type)
		VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5)
		RETURNING id::text, created_at
	`, p.ChatID, env.From, p.RecipientID, []byte(p.CiphertextB64), p.MsgType).Scan(&msgID, &createdAt)
	if err != nil {
		log.Printf("[WS] ✗ Xabar bazaga saqlanmadi: %v", err)
		return
	}
	log.Printf("[WS] ✓ Xabar bazaga saqlandi: msgID=%s", msgID)

	// Yuboruvchiga ACK
	h.sendTo(env.From, "msg.ack", map[string]any{
		"client_msg_id": p.ClientMsgID,
		"server_msg_id": msgID,
	})

	// Adresatga yetkazish
	delivered := h.sendTo(p.RecipientID, "msg.recv", map[string]any{
		"msg_id":     msgID,
		"chat_id":    p.ChatID,
		"sender_id":  env.From,
		"ciphertext": p.CiphertextB64,
		"msg_type":   p.MsgType,
		"created_at": createdAt.UTC().Format(time.RFC3339Nano),
	})

	if delivered {
		log.Printf("[WS] ✓ msg.recv yetkazildi: to=%s", p.RecipientID)
		_, _ = h.db.Exec(ctx,
			`UPDATE messages SET delivered_at = NOW() WHERE id = $1::uuid`, msgID)
	} else {
		log.Printf("[WS] ⏳ Adresat offline, xabar DB da kutmoqda: to=%s", p.RecipientID)
	}
}

// flushPending — mijoz ulanganida yetkazilmagan xabarlar yuboriladi.
func (h *Hub) flushPending(ctx context.Context, c *Client) {
	rows, err := h.db.Query(ctx, `
		SELECT id::text, chat_id::text, sender_id::text,
		       ciphertext, msg_type, created_at
		  FROM messages
		 WHERE recipient_id = $1::uuid AND delivered_at IS NULL
		 ORDER BY created_at ASC
		 LIMIT 500
	`, c.UserID)
	if err != nil {
		return
	}
	defer rows.Close()

	count := 0
	for rows.Next() {
		var msgID, chatID, senderID string
		var ctBytes []byte
		var mtype int
		var createdAt time.Time
		if err := rows.Scan(&msgID, &chatID, &senderID, &ctBytes, &mtype, &createdAt); err != nil {
			continue
		}
		if h.sendTo(c.UserID, "msg.recv", map[string]any{
			"msg_id":     msgID,
			"chat_id":    chatID,
			"sender_id":  senderID,
			"ciphertext": string(ctBytes),
			"msg_type":   mtype,
			"created_at": createdAt.UTC().Format(time.RFC3339Nano),
		}) {
			_, _ = h.db.Exec(ctx,
				`UPDATE messages SET delivered_at = NOW() WHERE id = $1::uuid`, msgID)
			count++
		}
	}
	if count > 0 {
		log.Printf("[WS] 📬 flushPending: %d ta xabar yetkazildi: to=%s", count, c.UserID)
	}
}

// sendTo — berilgan foydalanuvchiga JSON paket yuborishga uriniladi.
func (h *Hub) sendTo(userID, eventType string, payload any) bool {
	h.mu.RLock()
	c, ok := h.clients[userID]
	h.mu.RUnlock()
	if !ok || c.closed {
		log.Printf("[WS] sendTo: userID=%s offline yoki yo'q", userID)
		return false
	}
	raw, _ := json.Marshal(map[string]any{"type": eventType, "payload": payload})
	select {
	case c.Send <- raw:
		return true
	default:
		log.Printf("[WS] sendTo: bufer to'lgan, mijoz uzilmoqda: userID=%s", userID)
		h.unreg <- c
		return false
	}
}

// markDelivered — xabar bazada yetkazilgan deb belgilanadi.
func (h *Hub) markDelivered(ctx context.Context, env inboundEnvelope) {
	var p struct{ MsgID string `json:"msg_id"` }
	if err := json.Unmarshal(env.Payload, &p); err != nil {
		return
	}
	_, _ = h.db.Exec(ctx,
		`UPDATE messages SET delivered_at = COALESCE(delivered_at, NOW())
		    WHERE id = $1::uuid AND recipient_id = $2::uuid`, p.MsgID, env.From)
}

// markRead — xabar o'qilgan deb belgilanadi.
func (h *Hub) markRead(ctx context.Context, env inboundEnvelope) {
	var p struct{ MsgID string `json:"msg_id"` }
	if err := json.Unmarshal(env.Payload, &p); err != nil {
		return
	}
	_, _ = h.db.Exec(ctx,
		`UPDATE messages SET read_at = NOW()
		    WHERE id = $1::uuid AND recipient_id = $2::uuid`, p.MsgID, env.From)
}

// routeSessionRekey — qabul qiluvchi sessiya yo'qligini bildiradi; yuboruvchi keyingi xabarda PreKey ishlatadi.
func (h *Hub) routeSessionRekey(env inboundEnvelope) {
	var p struct {
		PeerID string `json:"peer_id"`
		ChatID string `json:"chat_id"`
	}
	if err := json.Unmarshal(env.Payload, &p); err != nil || p.PeerID == "" {
		log.Printf("[WS] ✗ session.rekey_request parse xatoligi (from=%s)", env.From)
		return
	}
	// peer_id = qayta kalit so'rayotgan foydalanuvchi; xabar shu ID ga yetkaziladi
	if h.sendTo(p.PeerID, "session.rekey_request", map[string]any{
		"from_user_id": env.From,
		"chat_id":      p.ChatID,
	}) {
		log.Printf("[WS] 🔑 session.rekey_request: %s → %s (chat=%s)", env.From, p.PeerID, p.ChatID)
	}
}

func (h *Hub) Inbound() chan<- inboundEnvelope  { return h.inbound }
func (h *Hub) Register() chan<- *Client          { return h.register }
func (h *Hub) Unregister() chan<- *Client        { return h.unreg }
