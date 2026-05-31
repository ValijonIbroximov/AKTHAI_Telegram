// Fayl: client/src-tauri/src/session.rs
// Maqsad: Yangi sherikga birinchi xabar yuborishdan oldin X3DH sessiyasi quriladi,
//         so'ngra xabarlar Double Ratchet orqali shifrlanadi va ochiladi.
//
// Versiya muvofiqligi izohi:
//   libsignal git orqali ulanadi va uning funksiya imzolari versiyalar bo'yicha
//   o'zgarishi mumkin (masalan, ba'zi versiyalarda decrypt funksiyalari qo'shimcha
//   KyberPreKeyStore parametrini talab qiladi). Quyidagi chaqiruvlar Cargo.toml dagi
//   pin qilingan versiyaga moslab qurish paytida tekshiriladi.

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use libsignal_protocol::{
    message_decrypt_prekey, message_decrypt_signal, message_encrypt, process_prekey_bundle,
    CiphertextMessage, IdentityKey, PreKeyBundle, PreKeySignalMessage, ProtocolAddress, PublicKey,
    SignalMessage, SignalProtocolError,
};
use std::time::SystemTime;

use crate::store::LocalSignalStore;

// Sherik qurilmasining standart identifikatori (hozircha bitta qurilma qo'llab-quvvatlanadi).
pub const DEFAULT_DEVICE_ID: u32 = 1;

// PeerBundle — serverdan olingan ochiq kalit-bundle dekod qilingan ko'rinishi.
pub struct PeerBundle {
    pub user_id: String,
    pub device_id: u32,
    pub registration_id: u32,
    pub identity_key: IdentityKey,
    pub signed_prekey_id: u32,
    pub signed_prekey: PublicKey,
    pub signed_prekey_sig: Vec<u8>,
    pub onetime_prekey_id: Option<u32>,
    pub onetime_prekey: Option<PublicKey>,
}

// decode_bundle — serverdan kelgan JSON bundle PeerBundle ko'rinishiga dekod qilinadi.
pub fn decode_bundle(raw: &serde_json::Value) -> Result<PeerBundle, SignalProtocolError> {
    let user_id = raw["user_id"].as_str().unwrap_or("").to_string();
    let registration_id = raw["registration_id"].as_u64().unwrap_or(0) as u32;

    let identity_key = IdentityKey::decode(
        &B64.decode(raw["identity_key"].as_str().unwrap_or(""))
            .unwrap_or_default(),
    )?;

    let signed_prekey_id = raw["signed_prekey"]["key_id"].as_u64().unwrap_or(0) as u32;
    let signed_prekey = PublicKey::deserialize(
        &B64.decode(raw["signed_prekey"]["public_key"].as_str().unwrap_or(""))
            .unwrap_or_default(),
    )?;
    let signed_prekey_sig = B64
        .decode(raw["signed_prekey"]["signature"].as_str().unwrap_or(""))
        .unwrap_or_default();

    // Bir martalik kalit ixtiyoriy — server zaxirasi tugagan bo'lsa bo'lmasligi mumkin
    let mut onetime_prekey_id = None;
    let mut onetime_prekey = None;
    if let Some(otp) = raw.get("one_time_prekey") {
        if !otp.is_null() {
            onetime_prekey_id = otp["key_id"].as_u64().map(|v| v as u32);
            if let Some(s) = otp["public_key"].as_str() {
                onetime_prekey = Some(PublicKey::deserialize(&B64.decode(s).unwrap_or_default())?);
            }
        }
    }

    Ok(PeerBundle {
        user_id,
        device_id: DEFAULT_DEVICE_ID,
        registration_id,
        identity_key,
        signed_prekey_id,
        signed_prekey,
        signed_prekey_sig,
        onetime_prekey_id,
        onetime_prekey,
    })
}

// establish_session — sherikning bundle'i asosida X3DH sessiyasi quriladi.
pub async fn establish_session(
    store: &mut LocalSignalStore,
    bundle: PeerBundle,
) -> Result<(), SignalProtocolError> {
    let address = ProtocolAddress::new(bundle.user_id.clone(), bundle.device_id.into());

    let pre_key_bundle = PreKeyBundle::new(
        bundle.registration_id,
        bundle.device_id.into(),
        bundle
            .onetime_prekey_id
            .zip(bundle.onetime_prekey)
            .map(|(id, key)| (id.into(), key)),
        bundle.signed_prekey_id.into(),
        bundle.signed_prekey,
        bundle.signed_prekey_sig,
        bundle.identity_key,
    )?;

    let mut rng = rand::rngs::OsRng;
    process_prekey_bundle(
        &address,
        &mut store.session_store,
        &mut store.identity_store,
        &pre_key_bundle,
        SystemTime::now(),
        &mut rng,
    )
    .await
}

// encrypt_for — ochiq matn sherik uchun shifrlanadi. Natijada shifrlangan baytlar va
// xabar turi (1=PreKeySignalMessage, 2=SignalMessage) qaytariladi.
pub async fn encrypt_for(
    store: &mut LocalSignalStore,
    peer_user_id: &str,
    device_id: u32,
    plaintext: &[u8],
) -> Result<(Vec<u8>, u8), SignalProtocolError> {
    let addr = ProtocolAddress::new(peer_user_id.to_string(), device_id.into());

    let ct = message_encrypt(
        plaintext,
        &addr,
        &mut store.session_store,
        &mut store.identity_store,
        SystemTime::now(),
    )
    .await?;

    let (bytes, mtype) = match ct {
        CiphertextMessage::PreKeySignalMessage(m) => (m.serialized().to_vec(), 1u8),
        CiphertextMessage::SignalMessage(m) => (m.serialized().to_vec(), 2u8),
        _ => {
            return Err(SignalProtocolError::InvalidArgument(
                "kutilmagan xabar turi".into(),
            ))
        }
    };
    Ok((bytes, mtype))
}

// decrypt_from — serverdan kelgan ciphertext mijozda ochiladi.
// Eslatma: agar pin qilingan libsignal versiyasi KyberPreKeyStore parametrini talab
//          qilsa, message_decrypt_prekey chaqiruviga tegishli kichik-saqlov qo'shiladi.
pub async fn decrypt_from(
    store: &mut LocalSignalStore,
    peer_user_id: &str,
    device_id: u32,
    msg_type: u8,
    ciphertext: &[u8],
) -> Result<Vec<u8>, SignalProtocolError> {
    let addr = ProtocolAddress::new(peer_user_id.to_string(), device_id.into());
    let mut rng = rand::rngs::OsRng;

    let plaintext = match msg_type {
        1 => {
            // Birinchi xabar — X3DH sessiyasi shu yerda o'rnatiladi
            let m = PreKeySignalMessage::try_from(ciphertext)?;
            message_decrypt_prekey(
                &m,
                &addr,
                &mut store.session_store,
                &mut store.identity_store,
                &mut store.pre_key_store,
                &mut store.signed_pre_key_store,
                &mut rng,
            )
            .await?
        }
        2 => {
            // Mavjud sessiya doirasidagi keyingi xabar
            let m = SignalMessage::try_from(ciphertext)?;
            message_decrypt_signal(
                &m,
                &addr,
                &mut store.session_store,
                &mut store.identity_store,
                &mut rng,
            )
            .await?
        }
        _ => {
            return Err(SignalProtocolError::InvalidArgument(
                "noto'g'ri xabar turi".into(),
            ))
        }
    };

    Ok(plaintext)
}
