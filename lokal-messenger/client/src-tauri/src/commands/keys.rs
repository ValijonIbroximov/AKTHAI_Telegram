// X3DH sessiyasini boshlash, qabul qilish va tekshirish buyruqlari.
// React frontend bu buyruqlarni birinchi xabar yuborishdan avval chaqiradi.

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::{
    AppState,
    crypto::{
        ratchet::generate_ratchet_keypair,
        signal::{from_b64, to_b64, x3dh_sender, x3dh_receiver},
        store::{
            get_identity, get_signed_prekey, get_session, mark_one_time_prekey_used,
            save_session, SignalSession,
        },
    },
};

#[derive(Debug, Deserialize)]
pub struct RemoteSpk {
    pub key_id:     u32,
    pub public_key: String,
    pub signature:  String,
}

#[derive(Debug, Deserialize)]
pub struct RemoteOtpk {
    pub key_id:     u32,
    pub public_key: String,
}

#[derive(Debug, Deserialize)]
pub struct RemoteKeyBundle {
    pub registration_id:      u32,
    pub identity_key:         String,
    pub identity_key_x25519:  Option<String>,
    pub signed_prekey:        RemoteSpk,
    pub one_time_prekey:      Option<RemoteOtpk>,
}

/// establish_session natijasi — frontend key_exchange WS xabarini yuborish uchun ishlatadi.
#[derive(Debug, Serialize)]
pub struct EstablishResult {
    /// Efemer ochiq kalit (Base64) — qabul qiluvchiga yuboriladi
    pub ek_pk:          String,
    /// Bizning identifikatsiya kalitimiz X25519 shaklida (Base64) — qabul qiluvchiga yuboriladi
    pub sender_ik_x25519: String,
    /// Qabul qiluvchi tomondan ishlatilgan SPK key_id
    pub spk_key_id:     u32,
    /// Qabul qiluvchi tomondan ishlatilgan OPK key_id (0 = ishlatilmadi)
    pub otpk_key_id:    u32,
}

/// Sherik kalit-bundle'i asosida X3DH sessiya o'rnatiladi (yuboruvchi tomoni).
/// Bu buyruq birinchi xabar yuborishdan oldin chaqirilishi shart.
/// Qaytaradi: ek_pk va sender_ik_x25519 (key_exchange WS xabariga qo'shiladi).
#[tauri::command]
pub async fn establish_session(
    peer_id:     String,
    bundle_json: String,
    state:       State<'_, AppState>,
) -> Result<EstablishResult, String> {
    let bundle: RemoteKeyBundle = serde_json::from_str(&bundle_json)
        .map_err(|e| format!("Bundle JSON formati noto'g'ri: {e}"))?;
    let db = state.db_conn();

    let (_, our_ik) = get_identity(&db)
        .map_err(|e| e.to_string())?
        .ok_or("Identifikatsiya kaliti topilmadi — avval init_signal_keys chaqiring")?;

    let peer_ik_raw  = from_b64(&bundle.identity_key).map_err(|e| e.to_string())?;
    let peer_spk_pk  = from_b64(&bundle.signed_prekey.public_key).map_err(|e| e.to_string())?;
    let peer_spk_sig = from_b64(&bundle.signed_prekey.signature).map_err(|e| e.to_string())?;

    let otpk_key_id = bundle.one_time_prekey.as_ref().map(|k| k.key_id).unwrap_or(0);

    let otpk: Option<(Vec<u8>, u32)> = if let Some(ref k) = bundle.one_time_prekey {
        Some((from_b64(&k.public_key).map_err(|e| e.to_string())?, k.key_id))
    } else { None };

    let otpk_ref = otpk.as_ref().map(|(pk, id)| (pk.as_slice(), *id));

    // X3DH: endi (shared_key, ek_pk, our_ik_x25519) qaytariladi
    let (shared_key, ek_pk_raw, our_ik_x25519_raw) = x3dh_sender(
        &our_ik.private_key,
        &our_ik.public_key,
        &peer_ik_raw,
        &peer_spk_pk,
        &peer_spk_sig,
        otpk_ref,
        bundle.identity_key_x25519.as_deref(),
    ).map_err(|e| e.to_string())?;

    let (ratchet_pk, ratchet_sk) = generate_ratchet_keypair();

    let session = SignalSession {
        peer_id:             peer_id.clone(),
        root_key:            shared_key.to_vec(),
        send_chain_key:      shared_key.to_vec(),
        recv_chain_key:      shared_key.to_vec(),
        send_msg_num:        0,
        recv_msg_num:        0,
        send_ratchet_pk:     ratchet_pk.to_vec(),
        send_ratchet_sk:     ratchet_sk.to_vec(),
        recv_ratchet_pk:     None,
        prev_send_chain_len: 0,
    };

    save_session(&db, &session).map_err(|e| e.to_string())?;

    Ok(EstablishResult {
        ek_pk:          to_b64(&ek_pk_raw),
        sender_ik_x25519: to_b64(&our_ik_x25519_raw),
        spk_key_id:     bundle.signed_prekey.key_id,
        otpk_key_id,
    })
}

/// Kelayotgan key_exchange xabari asosida X3DH sessiya o'rnatiladi (qabul qiluvchi tomoni).
/// Parametrlar key_exchange WS xabaridan olinadi.
#[tauri::command]
pub async fn establish_session_receiver(
    peer_id:          String,
    peer_ek_pk_b64:   String,     // Yuboruvchining efemer ochiq kaliti
    sender_ik_x25519_b64: String, // Yuboruvchining IK X25519 shaklida
    spk_key_id:       u32,        // Qaysi SPK ishlatilganini bilish uchun
    otpk_key_id:      u32,        // Qaysi OPK ishlatilganini bilish uchun (0=yo'q)
    state:            State<'_, AppState>,
) -> Result<(), String> {
    let db = state.db_conn();

    // Bizning identifikatsiya kalitimiz
    let (_, our_ik) = get_identity(&db)
        .map_err(|e| e.to_string())?
        .ok_or("Identifikatsiya kaliti topilmadi")?;

    // Bizning SPK (key_id bo'yicha yoki oxirgisi)
    let (our_spk, _) = get_signed_prekey(&db)
        .map_err(|e| e.to_string())?
        .ok_or("Imzolangan prekey topilmadi")?;

    // Agar SPK key_id mos kelmasa ham oxirgisini ishlatamiz (soddalashtirilgan)
    let _ = spk_key_id; // ishlatilmaydi — oxirgi SPK olinadi

    // Bizning OPK (agar ishlatilgan bo'lsa)
    let our_otpk_sk = if otpk_key_id > 0 {
        match crate::crypto::store::get_one_time_prekey(&db, otpk_key_id) {
            Ok(Some(k)) => {
                let _ = mark_one_time_prekey_used(&db, otpk_key_id);
                Some(k.private_key)
            }
            _ => None,
        }
    } else { None };

    let peer_ek_pk      = from_b64(&peer_ek_pk_b64).map_err(|e| e.to_string())?;
    let sender_ik_x25519 = from_b64(&sender_ik_x25519_b64).map_err(|e| e.to_string())?;

    // X3DH qabul qiluvchi tomoni
    let shared_key = x3dh_receiver(
        &our_ik.private_key,
        &our_spk.private_key,
        our_otpk_sk.as_deref(),
        &sender_ik_x25519,
        &peer_ek_pk,
    ).map_err(|e| e.to_string())?;

    let (ratchet_pk, ratchet_sk) = generate_ratchet_keypair();

    let session = SignalSession {
        peer_id,
        root_key:            shared_key.to_vec(),
        send_chain_key:      shared_key.to_vec(),
        recv_chain_key:      shared_key.to_vec(),
        send_msg_num:        0,
        recv_msg_num:        0,
        send_ratchet_pk:     ratchet_pk.to_vec(),
        send_ratchet_sk:     ratchet_sk.to_vec(),
        recv_ratchet_pk:     None,
        prev_send_chain_len: 0,
    };

    save_session(&db, &session).map_err(|e| e.to_string())
}

/// Berilgan peer bilan sessiya mavjudligini tekshiradi.
/// sendMessage dan oldin chaqiriladi — agar false bo'lsa, X3DH qayta ishlatiladi.
#[tauri::command]
pub async fn has_session(peer_id: String, state: State<'_, AppState>) -> Result<bool, String> {
    get_session(&state.db_conn(), &peer_id)
        .map(|s| s.is_some())
        .map_err(|e| e.to_string())
}

/// Berilgan peer bilan Signal sessiyasini o'chirish.
#[tauri::command]
pub async fn clear_peer_session(peer_id: String, state: State<'_, AppState>) -> Result<(), String> {
    crate::crypto::store::clear_session(&state.db_conn(), &peer_id).map_err(|e| e.to_string())
}

/// Barcha Signal sessiyalarini o'chirish.
#[tauri::command]
pub async fn clear_all_sessions(state: State<'_, AppState>) -> Result<(), String> {
    crate::crypto::store::clear_all_sessions(&state.db_conn()).map_err(|e| e.to_string())
}

/// SQLite dagi barcha Signal sessiya peer_id lari (bootstrap / debug).
#[tauri::command]
pub async fn list_session_peers(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let c = state.db_conn();
    let db = c.lock().unwrap();
    let mut st = db
        .prepare("SELECT peer_id FROM sessions ORDER BY peer_id")
        .map_err(|e| e.to_string())?;
    let rows = st
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}
