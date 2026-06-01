// Xabar shifrlash va shifr ochish buyruqlari.
// Bu buyruqlar React frontend tomonidan invoke() orqali chaqiriladi.

use tauri::State;

use crate::{
    AppState,
    crypto::ratchet::{ratchet_decrypt, ratchet_encrypt, MessageHeader},
};

/// Matn xabarini E2EE bilan shifrlaydi.
/// Qaytaradi: Base64 kodlangan JSON {"header": {...}, "ciphertext": "..."}
#[tauri::command]
pub async fn encrypt_message(
    chat_id:      String,
    recipient_id: String,
    plaintext:    String,
    state:        State<'_, AppState>,
) -> Result<String, String> {
    let db = state.db.clone();

    let (header, cipher_b64) = ratchet_encrypt(&db, &recipient_id, plaintext.as_bytes())
        .map_err(|e| e.to_string())?;

    let payload = serde_json::json!({
        "header":     header,
        "ciphertext": cipher_b64,
        "chat_id":    chat_id,
    });

    Ok(payload.to_string())
}

/// Kiruvchi xabar E2EE shifridan ochiladi.
/// `ciphertext` parametri JSON formatida: {"header": {...}, "ciphertext": "..."}
#[tauri::command]
pub async fn decrypt_message(
    _chat_id:    String,
    sender_id:  String,
    ciphertext: String,
    state:      State<'_, AppState>,
) -> Result<String, String> {
    let db = state.db.clone();

    // JSON parserlash
    let parsed: serde_json::Value = serde_json::from_str(&ciphertext)
        .map_err(|e| format!("Xabar formati noto'g'ri: {e}"))?;

    let header: MessageHeader = serde_json::from_value(
        parsed.get("header").cloned().unwrap_or_default()
    )
    .map_err(|e| format!("Header formati noto'g'ri: {e}"))?;

    let cipher_b64 = parsed
        .get("ciphertext")
        .and_then(|v| v.as_str())
        .ok_or("ciphertext maydoni yo'q")?;

    let plaintext_bytes = ratchet_decrypt(&db, &sender_id, &header, cipher_b64)
        .map_err(|e| e.to_string())?;

    String::from_utf8(plaintext_bytes)
        .map_err(|e| format!("UTF-8 xatoligi: {e}"))
}
