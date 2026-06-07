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

/**
 * Chat turi.
 * Hozircha faol: "direct" (va eski "private").
 * Kelajak: "group", "channel"
 */
export type ChatType = "direct" | "private" | "group" | "channel";

export interface Chat {
  id:             string;
  type:           ChatType;
  title:          string;
  peer_user_id:   string | null;
  last_message:   LastMessage | null;
  unread_count:   number;
  updated_at:     string;
  peer_online?:            boolean;
  peer_last_seen_at?:      string | null;
  peer_last_seen_hidden?:  boolean;
  /** Guruh/kanal uchun a'zolar soni (kelajak) */
  member_count?:  number | null;
  /** Guruh/kanal tavsifi (kelajak) */
  description?:   string | null;
}

export interface LastMessage {
  sender_id:  string;
  preview:    string;
  created_at: string;
}

/**
 * Xabar turi.
 * Hozircha faol: "text".
 * Kelajak: "image", "file", "audio", "video"
 * Ichki: "key_exchange" (Signal Protocol X3DH)
 */
export type MessageType =
  | "text"
  | "image"
  | "file"
  | "audio"
  | "video"
  | "key_exchange";

export interface Message {
  id:           string;
  chat_id:      string;
  sender_id:    string;
  ciphertext:   string;          // Base64 encoded
  plaintext:    string | null;
  msg_type:     MessageType;
  status:       "sending" | "sent" | "delivered" | "read";
  created_at:   string;
  /** Media xabarlar uchun fayl URL (kelajak) */
  media_url?:   string | null;
}

// ── WebSocket hodisalari ────────────────────────────────────────────────────
// Server hub.go dan keluvchi/ketuvchi hodisalar
//
// Signal Protocol standart (PreKeyMessage):
//   key_exchange va session.rekey_request WS eventlari YO'Q.
//   Birinchi xabar = PreKeySignalMessage (type=3) — barcha kalit almashinuvi ichida.

export type WsEvent =
  | { type: "msg.recv";  payload: WsMsgRecv }
  | { type: "msg.ack";   payload: WsMsgAck }
  | { type: "msg.read";  payload: WsMsgRead }
  | { type: "presence";  payload: WsPresence }
  | { type: "session.rekey_request"; payload: WsSessionRekeyRequest };

export interface WsSessionRekeyRequest {
  from_user_id: string;
  chat_id?:     string;
}

// Client → Server (wsClient.sendMsg orqali yuboriladi)
export interface WsSendPayload {
  chat_id:       string;
  recipient_id:  string;
  ciphertext:    string;
  /**
   * Xabar turi:
   *   1 = SignalMessage    (mavjud sessiya bilan shifrlangan)
   *   3 = PreKeySignalMessage (X3DH + shifrlash inline, sessiya yo'qda)
   */
  msg_type:      number;
  client_msg_id: string;
}

export interface WsMsgRecv {
  msg_id:     string;
  chat_id:    string;
  sender_id:  string;
  ciphertext: string;
  /** Server DB vaqti (RFC3339) — tartiblash uchun */
  created_at?: string;
  /**
   * 1 = SignalMessage
   * 3 = PreKeySignalMessage (decryptMessage ichida avtomatik X3DH)
   */
  msg_type?:  number;
}

export interface WsMsgAck {
  client_msg_id: string;
  server_msg_id: string;
}

export interface WsMsgRead {
  msg_id:  string;
  chat_id: string;
}

export interface WsPresence {
  user_id:           string;
  online:            boolean;
  last_seen_at?:     string | null;
  last_seen_hidden?: boolean;
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
  id:                 string;
  type:               ChatType;
  title:              string;
  peer_user_id:       string | null;
  last_time:          string | null;
  unread:             number;
  peer_online?:            boolean;
  peer_last_seen_at?:      string | null;
  peer_last_seen_hidden?:  boolean;
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
