// Mahalliy ochiq matn tarixi (E2EE — faqat qurilmada).

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::AppState;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredMessage {
    pub id:         String,
    pub chat_id:    String,
    pub sender_id:  String,
    pub plaintext:  String,
    pub ciphertext: String,
    pub msg_type:   String,
    pub status:     String,
    pub created_at: String,
}

#[tauri::command]
pub async fn save_local_message(msg: StoredMessage, state: State<'_, AppState>) -> Result<(), String> {
    let db = state.db.clone();
    let c  = db.lock().unwrap();
    c.execute(
        "INSERT INTO local_messages (id, chat_id, sender_id, plaintext, ciphertext, msg_type, status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(id) DO UPDATE SET
           plaintext = excluded.plaintext,
           ciphertext = excluded.ciphertext,
           status = excluded.status",
        rusqlite::params![
            msg.id,
            msg.chat_id,
            msg.sender_id,
            msg.plaintext,
            msg.ciphertext,
            msg.msg_type,
            msg.status,
            msg.created_at,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn load_local_messages(
    chat_id: String,
    state:   State<'_, AppState>,
) -> Result<Vec<StoredMessage>, String> {
    let db = state.db.clone();
    let c  = db.lock().unwrap();
    let mut st = c
        .prepare(
            "SELECT id, chat_id, sender_id, plaintext, ciphertext, msg_type, status, created_at
             FROM local_messages WHERE chat_id = ?1 ORDER BY created_at ASC",
        )
        .map_err(|e| e.to_string())?;

    let rows = st
        .query_map([&chat_id], |r| {
            Ok(StoredMessage {
                id:         r.get(0)?,
                chat_id:    r.get(1)?,
                sender_id:  r.get(2)?,
                plaintext:  r.get(3)?,
                ciphertext: r.get(4)?,
                msg_type:   r.get(5)?,
                status:     r.get(6)?,
                created_at: r.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}
