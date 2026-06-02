// Xabar shifrlash va shifr ochish buyruqlari (Double Ratchet).

use std::sync::atomic::Ordering;
use tauri::State;

use crate::{
    AppState,
    crypto::ratchet::{ratchet_decrypt, ratchet_encrypt},
};

/// Mualliflik tekshiruvi o'tmagan bo'lsa kripto operatsiyalar bloklanadi.
macro_rules! guard_integrity {
    ($state:expr) => {
        if $state.poisoned.load(Ordering::SeqCst) {
            return Err(
                "Kriptografiya tizimi bloklanган: yaxlitlik tekshiruvi bajarilmagan \
                 (verify_author_text chaqirilmagan yoki mualliflik ma'lumoti o'zgartirilgan)"
                    .into(),
            );
        }
    };
}

/// Matn xabarini E2EE bilan shifrlab, JSON payload qaytaradi.
/// Qaytariladigan format: `{"header":{...},"ciphertext":"<base64>"}`
#[tauri::command]
pub async fn encrypt_message(
    _chat_id:     String,
    recipient_id: String,
    plaintext:    String,
    state:        State<'_, AppState>,
) -> Result<String, String> {
    guard_integrity!(state);
    ratchet_encrypt(&state.db, &recipient_id, plaintext.as_bytes())
        .map_err(|e| e.to_string())
}

/// Shifrlangan JSON payload'ni ochib, matn qaytaradi.
/// `ciphertext` parametri: `{"header":{...},"ciphertext":"<base64>"}` formatida
#[tauri::command]
pub async fn decrypt_message(
    _chat_id:   String,
    sender_id:  String,
    ciphertext: String,
    state:      State<'_, AppState>,
) -> Result<String, String> {
    guard_integrity!(state);
    let bytes = ratchet_decrypt(&state.db, &sender_id, &ciphertext)
        .map_err(|e| e.to_string())?;
    String::from_utf8(bytes)
        .map_err(|e| format!("UTF-8 xatoligi: {e}"))
}
