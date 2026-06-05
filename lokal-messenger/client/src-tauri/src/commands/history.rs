// Mahalliy ochiq matn tarixi (E2EE — faqat qurilmada saqlangan).
//
// QOIDA: Bu jadvalda FAQAT deshifrlangan (ochiq) matn saqlanadi.
// save_local_message va load_local_messages user_id orqali qat'iy izolyatsiya qiladi:
//   - user_id AppState.active_user_id bilan mos kelmasa → xatolik.

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::AppState;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredMessage {
    pub id:         String,
    pub chat_id:    String,
    pub sender_id:  String,
    pub plaintext:  String,   // faqat ochiq matn
    pub ciphertext: String,   // ID fallback matching uchun
    pub msg_type:   String,
    pub status:     String,
    pub created_at: String,
}

/// Joriy faol foydalanuvchi bilan mos kelishini tekshiradi.
/// user_id bo'sh bo'lsa — bootstrap davomida; faqat ogohlantirish, bloklamaymiz.
/// Mos kelmasa — jiddiy xatolik: cross-account DB aralashuv oldini olish.
fn check_user_isolation(state: &AppState, user_id: &str) -> Result<(), String> {
    let active = state.get_active_user_id();
    if active.is_empty() {
        // set_active_user hali chaqirilmagan (app yuklanishida)
        log::warn!("[History] active_user_id o'rnatilmagan, user_id={user_id} bilan davom etamiz");
        return Ok(());
    }
    if !user_id.is_empty() && user_id != active {
        let msg = format!(
            "[History] ✖ USER MISMATCH: request user_id={user_id}, active={active}"
        );
        log::error!("{msg}");
        return Err(msg);
    }
    Ok(())
}

/// Ochiq matnni mahalliy SQLite bazasiga yozadi.
/// user_id — TypeScript dan keladi (getActiveCryptoUserId()), AppState.active_user_id bilan taqqoslanadi.
#[tauri::command]
pub async fn save_local_message(
    msg:     StoredMessage,
    user_id: String,
    state:   State<'_, AppState>,
) -> Result<(), String> {
    check_user_isolation(&state, &user_id)?;

    // Himoya: plaintext bo'sh bo'lsa yozmaymiz
    if msg.plaintext.trim().is_empty() {
        log::warn!("[History] save_local_message: plaintext bo'sh, saqlash o'tkazib yuborildi id={}", msg.id);
        return Ok(());
    }

    let db = state.db_conn();
    let c  = db.lock().unwrap();
    c.execute(
        "INSERT INTO local_messages
             (id, chat_id, sender_id, plaintext, ciphertext, msg_type, status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(id) DO UPDATE SET
             plaintext  = excluded.plaintext,
             ciphertext = excluded.ciphertext,
             status     = excluded.status",
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

    log::debug!("[History] ✅ saqlandi id={} chat={}", msg.id, msg.chat_id);
    Ok(())
}

/// Suhbat tarixini ochiq matn sifatida qaytaradi.
/// Qaytarilgan xabarlar allaqachon deshifrlangan — qayta decryptMessage KERAK EMAS.
#[tauri::command]
pub async fn load_local_messages(
    chat_id: String,
    user_id: String,
    state:   State<'_, AppState>,
) -> Result<Vec<StoredMessage>, String> {
    check_user_isolation(&state, &user_id)?;

    let db = state.db_conn();
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

    log::debug!("[History] load_local_messages chat={chat_id} count={}", out.len());
    Ok(out)
}

/// client_msg_id → server_msg_id: mahalliy bazada ID almashtiriladi (ACK dan keyin).
#[tauri::command]
pub async fn migrate_local_message_id(
    old_id:  String,
    msg:     StoredMessage,
    user_id: String,
    state:   State<'_, AppState>,
) -> Result<(), String> {
    check_user_isolation(&state, &user_id)?;

    let db = state.db_conn();
    let c  = db.lock().unwrap();
    c.execute("DELETE FROM local_messages WHERE id = ?1", [&old_id])
        .map_err(|e| e.to_string())?;
    c.execute(
        "INSERT INTO local_messages
             (id, chat_id, sender_id, plaintext, ciphertext, msg_type, status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(id) DO UPDATE SET
             plaintext  = excluded.plaintext,
             ciphertext = excluded.ciphertext,
             status     = excluded.status,
             created_at = excluded.created_at",
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

    log::debug!("[History] migrate_local_message_id: {old_id} → {}", msg.id);
    Ok(())
}
