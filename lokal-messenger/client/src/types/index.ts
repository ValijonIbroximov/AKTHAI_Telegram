// ====================================================
// Ilovada ishlatiladigan asosiy TypeScript interfeyslari
// ====================================================

export interface User {
  id:           string;
  username:     string;
  display_name: string;
  role:         "admin" | "user";
  rank_title:   string | null;
  unit_code:    string | null;
  is_active?:   boolean;
  last_seen_at?: string | null;
}

export interface Chat {
  id:           string;
  type:         "private" | "group";
  title:        string;
  peer_user_id: string | null;   // shaxsiy suhbatda sherik ID
  last_message: LastMessage | null;
  unread_count: number;
  updated_at:   string;
}

export interface LastMessage {
  sender_id:  string;
  preview:    string;
  created_at: string;
}

export interface Message {
  id:           string;
  chat_id:      string;
  sender_id:    string;
  ciphertext:   string;          // Base64 encoded
  plaintext:    string | null;
  msg_type:     "text" | "file" | "key_exchange";
  status:       "sending" | "sent" | "delivered" | "read";
  created_at:   string;
}

// ── WebSocket hodisalari ────────────────────────────────────────────────────
// Server hub.go dan keluvchi/ketuvchi hodisalar

// Server → Client
export interface WsSessionRekeyRequest {
  chat_id:      string;
  requester_id: string;
}

export type WsEvent =
  | { type: "msg.recv";              payload: WsMsgRecv }
  | { type: "msg.ack";               payload: WsMsgAck }
  | { type: "key_exchange";         payload: WsKeyExchange }
  | { type: "session.rekey_request"; payload: WsSessionRekeyRequest }
  | { type: "presence";             payload: WsPresence };

// Client → Server (wsClient.sendMsg orqali yuboriladi)
export interface WsSendPayload {
  chat_id:       string;
  recipient_id:  string;
  ciphertext:    string;   // Base64
  msg_type:      number;   // 1 = text
  client_msg_id: string;
}

export interface WsMsgRecv {
  msg_id:     string;
  chat_id:    string;
  sender_id:  string;
  ciphertext: string;      // Base64
  msg_type:   number;
}

export interface WsMsgAck {
  client_msg_id: string;
  server_msg_id: string;
}

export interface WsKeyExchange {
  chat_id:          string;
  sender_id:        string;
  ek_pk:            string;   // Base64 X25519
  sender_ik_x25519: string;   // Base64 X25519
  spk_key_id:       number;
  otpk_key_id:      number;
}

export interface WsPresence {
  user_id: string;
  online:  boolean;
}

// Legacy (eski kod bilan muvofiqliq uchun saqlanadi)
export interface WsMessage extends WsMsgRecv {}
export interface WsReadReceipt {
  chat_id:    string;
  message_id: string;
  reader_id:  string;
}
export interface WsDelivery {
  message_id: string;
}

// Login javob turi
export interface LoginResponse {
  token:                string;
  user_id:              string;
  role:                 string;
  must_change_password: boolean;
}

// Signal Protocol kalit-bundle (X3DH uchun)
export interface KeyBundle {
  user_id?:         string;
  registration_id:  number;
  identity_key:          string;    // Base64 (Ed25519 yoki X25519)
  identity_key_x25519?:  string;    // Base64 — Tauri mijozlari uchun ixtiyoriy
  signed_prekey: {
    key_id:     number;
    public_key: string;        // Base64
    signature:  string;        // Base64
  };
  one_time_prekey?: {
    key_id:     number;
    public_key: string;        // Base64
  };
}

// Server ListChats xom javob turi (transformatsiya uchun)
export interface RawChat {
  id:           string;
  type:         "private" | "group";
  title:        string;
  peer_user_id: string | null;
  last_time:    string | null;
  unread:       number;
}

// Server ChatHistory xom javob turi
export interface RawMessage {
  msg_id:     string;
  sender_id:  string;
  ciphertext: string;
  msg_type:   number;
  created_at: string;
  delivered:  boolean;
  read:       boolean;
}
