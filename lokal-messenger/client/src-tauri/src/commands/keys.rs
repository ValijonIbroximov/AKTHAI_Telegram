// X3DH sessiyasini boshlash buyrug'i.
// React frontend bu buyruqni birinchi xabar yuborishdan avval chaqiradi.

use serde::Deserialize;
use tauri::State;

use crate::{
    AppState,
    crypto::{
        ratchet::generate_ratchet_keypair,
        signal::{from_b64, x3dh_sender},
        store::{get_identity, save_session, SignalSession},
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
    pub registration_id: u32,
    pub identity_key:    String,
    pub signed_prekey:   RemoteSpk,
    pub one_time_prekey: Option<RemoteOtpk>,
}

/// Sherik kalit-bundle'i asosida X3DH sessiya o'rnatiladi.
/// Bu buyruq birinchi xabar yuborishdan oldin chaqirilishi shart.
#[tauri::command]
pub async fn establish_session(
    peer_id:     String,
    bundle_json: String,
    state:       State<'_, AppState>,
) -> Result<(), String> {
    let bundle: RemoteKeyBundle = serde_json::from_str(&bundle_json)
        .map_err(|e| format!("Bundle JSON formati noto'g'ri: {e}"))?;
    let db = state.db.clone();

    // Bizning identifikatsiya kalitimiz
    let (_, our_ik) = get_identity(&db)
        .map_err(|e| e.to_string())?
        .ok_or("Identifikatsiya kaliti topilmadi — avval init_signal_keys chaqiring")?;

    // Sherik kalitlari Base64 dan dekodlanadi
    let peer_ik_pk   = from_b64(&bundle.identity_key).map_err(|e| e.to_string())?;
    let peer_spk_pk  = from_b64(&bundle.signed_prekey.public_key).map_err(|e| e.to_string())?;
    let peer_spk_sig = from_b64(&bundle.signed_prekey.signature).map_err(|e| e.to_string())?;

    let otpk: Option<(Vec<u8>, u32)> = if let Some(ref k) = bundle.one_time_prekey {
        Some((from_b64(&k.public_key).map_err(|e| e.to_string())?, k.key_id))
    } else { None };

    let otpk_ref = otpk.as_ref().map(|(pk, id)| (pk.as_slice(), *id));

    // X3DH: shared_key va efemer ochiq kalit hosil qilinadi
    let (shared_key, _ek_pk) = x3dh_sender(
        &our_ik.private_key,
        &our_ik.public_key,
        &peer_ik_pk,
        &peer_spk_pk,
        &peer_spk_sig,
        otpk_ref,
    ).map_err(|e| e.to_string())?;

    // Double Ratchet boshlang'ich holati — SK bilan initialize qilinadi
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

    save_session(&db, &session).map_err(|e| e.to_string())?;
    Ok(())
}
