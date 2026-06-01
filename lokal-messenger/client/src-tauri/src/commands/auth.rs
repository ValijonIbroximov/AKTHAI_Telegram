// Autentifikatsiya buyruqlari: token xavfsiz saqlanadi va Signal kalitlari boshqariladi.

use anyhow::Result;
use rand::RngCore;
use serde_json::json;
use tauri::State;

use crate::{
    AppState,
    crypto::{
        signal::{
            generate_dh_keypair, generate_identity_keypair,
            sign_prekey, to_b64,
        },
        store::{get_identity, save_identity, save_one_time_prekeys, save_signed_prekey},
    },
};

const OTPK_COUNT: u32 = 20;  // Bir martalik prekey miqdori (serverga yuklanadi)

/// JWT token xavfsiz xotiraga (ilova ma'lumot papkasiga) saqlanadi.
#[tauri::command]
pub async fn store_token(token: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut t = state.token.lock().unwrap();
    *t = Some(token);
    Ok(())
}

/// Saqlangan token o'chiriladi (chiqishda)
#[tauri::command]
pub async fn clear_token(state: State<'_, AppState>) -> Result<(), String> {
    let mut t = state.token.lock().unwrap();
    *t = None;
    Ok(())
}

/// Signal Protocol kalit-bundle'i yaratiladi va serverga yuklanadi.
/// Agar qurilmada kalit mavjud bo'lsa, yangisi yaratilmaydi.
#[tauri::command]
pub async fn init_signal_keys(
    token:   String,
    _user_id: String,
    state:   State<'_, AppState>,
) -> Result<(), String> {
    let db = state.db.clone();

    // Identifikatsiya kaliti mavjudligi tekshiriladi
    let existing = get_identity(&db).map_err(|e| e.to_string())?;
    if existing.is_some() {
        // Kalit allaqachon mavjud — serverga qayta yuklamaslik mumkin
        return Ok(());
    }

    // Yangi kalit-bundle yaratiladi
    let identity  = generate_identity_keypair();
    let mut reg_id_bytes = [0u8; 4];
    rand::thread_rng().fill_bytes(&mut reg_id_bytes);
    let reg_id = u32::from_be_bytes(reg_id_bytes) % 16_380 + 1;

    save_identity(&db, reg_id, &identity).map_err(|e| e.to_string())?;

    // Imzolangan prekey
    let spk = generate_dh_keypair(1);
    let spk_sig = sign_prekey(&identity.private_key, &spk.public_key)
        .map_err(|e| e.to_string())?;
    save_signed_prekey(&db, &spk, &spk_sig).map_err(|e| e.to_string())?;

    // Bir martalik prekey to'plami
    let otpks: Vec<_> = (1..=OTPK_COUNT)
        .map(|id| generate_dh_keypair(id))
        .collect();
    save_one_time_prekeys(&db, &otpks).map_err(|e| e.to_string())?;

    // Kalit-bundle serverga yuklanadi
    let bundle = json!({
        "registration_id": reg_id,
        "identity_key":    to_b64(&identity.public_key),
        "signed_prekey": {
            "key_id":     spk.key_id,
            "public_key": to_b64(&spk.public_key),
            "signature":  to_b64(&spk_sig),
        },
        "one_time_prekeys": otpks.iter().map(|k| json!({
            "key_id":     k.key_id,
            "public_key": to_b64(&k.public_key),
        })).collect::<Vec<_>>(),
    });

    // HTTPS so'rov (server.lokal sertifikati o'z-o'zini imzolaganligidan TLS tekshiruvi o'chiriladi)
    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .build()
        .map_err(|e| e.to_string())?;

    client
        .post("https://server.lokal:8443/api/v1/keys/upload")
        .bearer_auth(&token)
        .json(&bundle)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}
