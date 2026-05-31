// Fayl: server/internal/ws/hub.go
// Maqsad: Bog'langan mijozlar ro'yxati saqlanadi va shifrlangan xabarlar
//
//	tegishli adresatga uzatiladi. Server ciphertext'ni hech qachon ochmaydi.
package ws

import (
	"context"
	"encoding/json"
	"log"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/military/lokal-messenger/server/internal/cache"
	"github.com/redis/go-redis/v9"
)

// presenceTTL — onlayn statusining Redis'dagi amal qilish muddati.
const presenceTTL = 90 * time.Second

// Client — bitta mijoz aloqasini ifodalaydi.
type Client struct {
	UserID string
	Send   chan []byte // Yuboriladigan paketlar navbati
	closed bool
}

// Hub — markaziy yetkazib beruvchi: mijozlarni ro'yxatga oladi va paketlarni marshrutlaydi.
type Hub struct {
	db       *pgxpool.Pool
	rdb      *redis.Client
	mu       sync.RWMutex
	clients  map[string]*Client // userID -> Client
	register chan *Client
	unreg    chan *Client
	inbound  chan inboundEnvelope
}

// inboundEnvelope — mijozdan kelayotgan paket konverti.
type inboundEnvelope struct {
	From    string          `json:"-"`
	Type    string          `json:"type"` // "msg.send", "msg.delivered", "msg.read", "ping"
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

// Run — Hub'ning asosiy halqasi. Kontekst bekor qilinguncha ishlaydi.
func (h *Hub) Run(ctx context.Context) {
	presenceTick := time.NewTicker(30 * time.Second)
	defer presenceTick.Stop()

	for {
		select {
		case <-ctx.Done():
			return

		case c := <-h.register:
			// Yangi mijoz ro'yxatga olinadi va onlayn deb belgilanadi
			h.mu.Lock()
			h.clients[c.UserID] = c
			h.mu.Unlock()
			_ = h.rdb.SAdd(ctx, cache.PresenceOnlineSet, c.UserID).Err()
			_ = h.rdb.Set(ctx, cache.PresenceKey(c.UserID), time.Now().Unix(), presenceTTL).Err()
			log.Printf("Mijoz ulandi: %s", c.UserID)
			// Ushbu foydalanuvchining yetkazilmagan xabarlari uzatiladi
			go h.flushPending(ctx, c)

		case c := <-h.unreg:
			// Mijoz ro'yxatdan chiqariladi (faqat shu aniq ulanish bo'lsa)
			h.mu.Lock()
			if cur, ok := h.clients[c.UserID]; ok && cur == c {
				delete(h.clients, c.UserID)
				if !c.closed {
					close(c.Send)
					c.closed = true
				}
			}
			h.mu.Unlock()
			_ = h.rdb.SRem(ctx, cache.PresenceOnlineSet, c.UserID).Err()
			_ = h.rdb.Del(ctx, cache.PresenceKey(c.UserID)).Err()
			log.Printf("Mijoz uzildi: %s", c.UserID)

		case env := <-h.inbound:
			// Kiruvchi paket turi bo'yicha qayta ishlanadi
			h.handleInbound(ctx, env)

		case <-presenceTick.C:
			// Onlayn vaqtlama davriy yangilanadi
			h.mu.RLock()
			for uid := range h.clients {
				_ = h.rdb.Set(ctx, cache.PresenceKey(uid), time.Now().Unix(), presenceTTL).Err()
			}
			h.mu.RUnlock()
		}
	}
}

// handleInbound — kiruvchi paket turi bo'yicha tegishli ishlovchiga yo'naltiriladi.
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

// sendPayload — "msg.send" paketining tarkibi.
type sendPayload struct {
	ChatID        string `json:"chat_id"`
	RecipientID   string `json:"recipient_id"`
	CiphertextB64 string `json:"ciphertext"`
	MsgType       int    `json:"msg_type"`      // 1 yoki 2
	ClientMsgID   string `json:"client_msg_id"` // mijoz tomonida yaratilgan id
}

// routeMessage — shifrlangan xabar bazaga yoziladi va adresat onlayn bo'lsa darrov uzatiladi.
func (h *Hub) routeMessage(ctx context.Context, env inboundEnvelope) {
	var p sendPayload
	if err := json.Unmarshal(env.Payload, &p); err != nil {
		return
	}

	// Server ciphertext'ni hech qachon ochmaydi — faqat bayt sifatida saqlaydi
	var msgID string
	err := h.db.QueryRow(ctx, `
        INSERT INTO messages (chat_id, sender_id, recipient_id, ciphertext, msg_type, client_msg_id)
        VALUES ($1::uuid, $2::uuid, $3::uuid, decode($4, 'base64'), $5, NULLIF($6, ''))
        RETURNING id::text
    `, p.ChatID, env.From, p.RecipientID, p.CiphertextB64, p.MsgType, p.ClientMsgID).Scan(&msgID)
	if err != nil {
		log.Printf("xabar saqlanmadi: %v", err)
		return
	}

	// Yuboruvchiga tasdiq (ack) qaytariladi
	h.sendTo(env.From, "msg.ack", map[string]any{
		"client_msg_id": p.ClientMsgID,
		"server_msg_id": msgID,
	})

	// Adresat onlayn bo'lsa, xabar darrov uzatiladi
	delivered := h.sendTo(p.RecipientID, "msg.recv", map[string]any{
		"msg_id":     msgID,
		"chat_id":    p.ChatID,
		"sender_id":  env.From,
		"ciphertext": p.CiphertextB64,
		"msg_type":   p.MsgType,
	})
	if delivered {
		_, _ = h.db.Exec(ctx, `UPDATE messages SET delivered_at = NOW() WHERE id = $1::uuid`, msgID)
	}
}

// flushPending — mijoz ulanmagan vaqtda to'plangan xabarlar unga uzatiladi.
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

	type pending struct {
		msgID, chatID, senderID, ct string
		mtype                       int
	}
	var batch []pending
	for rows.Next() {
		var pn pending
		if err := rows.Scan(&pn.msgID, &pn.chatID, &pn.senderID, &pn.ct, &pn.mtype); err != nil {
			continue
		}
		batch = append(batch, pn)
	}
	rows.Close()

	// Yetkazib berish navbat hosil bo'lgach amalga oshiriladi (kursor band qilinmaydi)
	for _, pn := range batch {
		if h.sendTo(c.UserID, "msg.recv", map[string]any{
			"msg_id":     pn.msgID,
			"chat_id":    pn.chatID,
			"sender_id":  pn.senderID,
			"ciphertext": pn.ct,
			"msg_type":   pn.mtype,
		}) {
			_, _ = h.db.Exec(ctx,
				`UPDATE messages SET delivered_at = NOW() WHERE id = $1::uuid`, pn.msgID)
		}
	}
}

// sendTo — ma'lum foydalanuvchiga paket yuborish urinib ko'riladi. Yetkazilsa true qaytadi.
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
		// Bufer to'lgan bo'lsa, mijoz uziladi (sekin iste'molchidan himoya)
		h.unreg <- c
		return false
	}
}

// markDelivered — xabar yetkazib berildi belgisi qo'yiladi.
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

// markRead — xabar o'qildi belgisi qo'yiladi va yuboruvchiga xabar beriladi.
func (h *Hub) markRead(ctx context.Context, env inboundEnvelope) {
	var p struct {
		MsgID    string `json:"msg_id"`
		SenderID string `json:"sender_id"`
	}
	if err := json.Unmarshal(env.Payload, &p); err != nil {
		return
	}
	_, _ = h.db.Exec(ctx,
		`UPDATE messages SET read_at = NOW()
            WHERE id = $1::uuid AND recipient_id = $2::uuid`, p.MsgID, env.From)
	// Yuboruvchi onlayn bo'lsa, o'qilgani haqida xabar beriladi
	if p.SenderID != "" {
		h.sendTo(p.SenderID, "msg.read", map[string]any{"msg_id": p.MsgID})
	}
}

// Inbound — tashqi koddan kiruvchi paket yuborish kanali qaytariladi.
func (h *Hub) Inbound() chan<- inboundEnvelope { return h.inbound }

// Register — mijozni ro'yxatga olish kanali qaytariladi.
func (h *Hub) Register() chan<- *Client { return h.register }

// Unregister — mijozni ro'yxatdan chiqarish kanali qaytariladi.
func (h *Hub) Unregister() chan<- *Client { return h.unreg }
