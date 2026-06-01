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
  is_active:    boolean;
  last_seen_at: string | null;
}

export interface Chat {
  id:           string;
  type:         "private" | "group";
  title:        string;
  last_message: LastMessage | null;
  unread_count: number;
  updated_at:   string;
}

export interface LastMessage {
  sender_id:  string;
  preview:    string;   // Shifrlangan bo'lsa "[xabar]" ko'rsatiladi
  created_at: string;
}

export interface Message {
  id:           string;
  chat_id:      string;
  sender_id:    string;
  // Ciphertext Base64 formatida keladi; E2EE ochgandan keyin plaintext saqlanadi
  ciphertext:   string;
  plaintext:    string | null;
  msg_type:     "text" | "file" | "key_exchange";
  status:       "sending" | "sent" | "delivered" | "read";
  created_at:   string;
}

// WebSocket orqali keladigan hodisalar
export type WsEvent =
  | { type: "message";         payload: WsMessage      }
  | { type: "presence";        payload: WsPresence      }
  | { type: "read_receipt";    payload: WsReadReceipt   }
  | { type: "delivery_receipt";payload: WsDelivery      };

export interface WsMessage {
  id:           string;
  chat_id:      string;
  sender_id:    string;
  recipient_id: string;
  ciphertext:   string;   // Base64 encoded
  msg_type:     string;
  created_at:   string;
}

export interface WsPresence {
  user_id:  string;
  online:   boolean;
}

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
  access_token: string;
  user_id:      string;
  role:         string;
}

// Signal Protocol kalit-bundle (X3DH uchun)
export interface KeyBundle {
  registration_id:  number;
  identity_key:     string;  // Base64
  signed_prekey: {
    key_id:     number;
    public_key: string;      // Base64
    signature:  string;      // Base64
  };
  one_time_prekey?: {
    key_id:     number;
    public_key: string;      // Base64
  };
}
