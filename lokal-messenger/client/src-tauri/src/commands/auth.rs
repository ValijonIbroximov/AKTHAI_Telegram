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
        store::{get_identity, get_signed_prekey, save_identity, save_one_time_prekeys, save_signed_prekey},
    },
};

const OTPK_COUNT: u32 = 10;  // Bir martalik prekey miqdori (har loginда yangilari yuklanadi)

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
///
/// Har loginда server'ga UPSERT qilinadi (kalit o'zgarmas, OTPK'lar yangilanadi).
/// Bu server DB tozalanganida yoki birinchi upload muvaffaqiyatsiz bo'lganida
/// kalitlar server'da yo'qolmasligini kafolatlaydi.
#[tauri::command]
pub async fn init_signal_keys(
    token:    String,
    _user_id: String,
    state:    State<'_, AppState>,
) -> Result<(), String> {
    let db = state.db.clone();

    // ── Identity Key: SQLite'da bor bo'lsa ishlatiladi, yo'q bo'lsa yangi ───
    let (reg_id, identity) = match get_identity(&db).map_err(|e| e.to_string())? {
        Some((id, ident)) => {
            log::info!("[KEYS] Tauri: mavjud IK topildi, serverga qayta yuklanmoqda…");
            (id, ident)
        }
        None => {
            let ident = generate_identity_keypair();
            let mut bytes = [0u8; 4];
            rand::thread_rng().fill_bytes(&mut bytes);
            let id = u32::from_be_bytes(bytes) % 16_380 + 1;
            save_identity(&db, id, &ident).map_err(|e| e.to_string())?;
            log::info!("[KEYS] Tauri: yangi IK yaratildi");
            (id, ident)
        }
    };

    // ── Signed PreKey: SQLite'da bor bo'lsa ishlatiladi, yo'q bo'lsa yangi ─
    let (spk, spk_sig) = match get_signed_prekey(&db).map_err(|e| e.to_string())? {
        Some((k, sig)) => (k, sig),
        None => {
            let k = generate_dh_keypair(1);
            let sig = sign_prekey(&identity.private_key, &k.public_key)
                .map_err(|e| e.to_string())?;
            save_signed_prekey(&db, &k, &sig).map_err(|e| e.to_string())?;
            (k, sig)
        }
    };

    // ── One-Time PreKeys: har loginда timestamp-bazali yangi ID'lar ─────────
    // Eski used=TRUE bo'lgan kalit ID'lari bilan to'qnashuv bo'lmasligi uchun.
    let base_id = (std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        % 900_000) as u32 + 100_000;
    let otpks: Vec<_> = (0..OTPK_COUNT)
        .map(|i| generate_dh_keypair(base_id + i))
        .collect();
    save_one_time_prekeys(&db, &otpks).map_err(|e| e.to_string())?;
    log::info!("[KEYS] Tauri: {} OTPK yaratildi, base_id={}", OTPK_COUNT, base_id);

    // ── Serverga UPSERT (identity + spk doim yangilanadi, OTPK'lar qo'shiladi) ─
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

    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .post("https://server.lokal:8443/api/v1/keys/upload")
        .bearer_auth(&token)
        .json(&bundle)
        .send()
        .await
        .map_err(|e| format!("Server'ga ulanib bo'lmadi: {e}"))?;

    if resp.status().is_success() || resp.status().as_u16() == 204 {
        log::info!("[KEYS] ✅ Tauri: kalit bundle serverga yuklandi");
    } else {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        log::error!("[KEYS] ❌ Tauri: kalit yuklash muvaffaqiyatsiz: {} — {}", status, body);
        return Err(format!("Kalit yuklash muvaffaqiyatsiz: {status}"));
    }

    Ok(())
}
