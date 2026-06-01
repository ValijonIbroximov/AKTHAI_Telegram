// Signal kalit almashish buyrug'i: X3DH sessiya boshlash.

use anyhow::Result;
use serde::Deserialize;
use tauri::State;

use crate::{
    AppState,
    crypto::{
        signal::{from_b64, x3dh_sender},
        store::{get_identity, save_session, SignalSession},
        ratchet::generate_ratchet_keypair,
    },
};

#[derive(Debug, Deserialize)]
pub struct SignedPrekey {
    pub key_id:     u32,
    pub public_key: String,
    pub signature:  String,
}

#[derive(Debug, Deserialize)]
pub struct OneTimePrekey {
    pub key_id:     u32,
    pub public_key: String,
}

#[derive(Debug, Deserialize)]
pub struct RemoteKeyBundle {
    pub registration_id: u32,
    pub identity_key:    String,
    pub signed_prekey:   SignedPrekey,
    pub one_time_prekey: Option<OneTimePrekey>,
}

/// Sheriklning kalit-bundle'i asosida X3DH sessiya yaratiladi.
/// Birinchi xabar yuborishdan oldin chaqiriladi.
#[tauri::command]
pub async fn establish_session(
    peer_id:    String,
    bundle_json: String,
    state:      State<'_, AppState>,
) -> Result<(), String> {
    let bundle: RemoteKeyBundle = serde_json::from_str(&bundle_json)
        .map_err(|e| format!("Bundle formati noto'g'ri: {e}"))?;
    let db = state.db.clone();

    // Bizning identifikatsiya kalitimiz
    let (_, our_identity) = get_identity(&db)
        .map_err(|e| e.to_string())?
        .ok_or("Identifikatsiya kaliti topilmadi — avval init_signal_keys chaqiring")?;

    // Sherik kalitlari Base64 dan dekodlanadi
    let peer_ik_pk  = from_b64(&bundle.identity_key).map_err(|e| e.to_string())?;
    let peer_spk_pk = from_b64(&bundle.signed_prekey.public_key).map_err(|e| e.to_string())?;
    let peer_spk_sig = from_b64(&bundle.signed_prekey.signature).map_err(|e| e.to_string())?;

    let otpk = bundle.one_time_prekey.as_ref().map(|k| {
        let pk = from_b64(&k.public_key).unwrap_or_default();
        (pk, k.key_id)
    });

    let otpk_ref = otpk.as_ref().map(|(pk, id)| (pk.as_slice(), *id));

    // X3DH bajariladi — shared key va efemer ochiq kalit qaytariladi
    let (shared_key, _ek_pk) = x3dh_sender(
        &our_identity.private_key,
        &our_identity.public_key,
        &peer_ik_pk,
        &peer_spk_pk,
        &peer_spk_sig,
        otpk_ref,
    )
    .map_err(|e| e.to_string())?;

    // Double Ratchet boshlang'ich holati yaratiladi
    let (ratchet_pk, _ratchet_sk) = generate_ratchet_keypair();

    let session = SignalSession {
        peer_id:         peer_id.clone(),
        root_key:        shared_key.to_vec(),
        send_chain_key:  shared_key.to_vec(),
        recv_chain_key:  shared_key.to_vec(),
        send_msg_num:    0,
        recv_msg_num:    0,
        send_ratchet_pk: ratchet_pk.to_vec(),
        recv_ratchet_pk: None,
    };

    save_session(&db, &session).map_err(|e| e.to_string())?;
    Ok(())
}
