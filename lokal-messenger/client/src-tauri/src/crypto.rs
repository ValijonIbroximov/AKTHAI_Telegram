// Fayl: client/src-tauri/src/crypto.rs
// Maqsad: Signal kalitlari mijozning o'zida yaratiladi va mahalliy saqlovga yoziladi.
//         Server bu jarayonda hech qanday rol o'ynamaydi — unga faqat OCHIQ kalitlar yuboriladi.
//
// Eslatma: libsignal-protocol API'si versiyaga bog'liq. Quyidagi chaqiruvlar
//          Cargo.toml dagi "tag" qiymatiga mos kelishi qurish paytida tekshiriladi.

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use libsignal_protocol::{
    GenericSignedPreKey, IdentityKeyPair, KeyPair, PreKeyRecord, SignedPreKeyRecord,
};
use rand::rngs::OsRng;
use serde::{Deserialize, Serialize};

use crate::store::LocalSignalStore;

// Birinchi marta yaratiladigan bir martalik kalitlar soni.
pub const NUM_ONE_TIME_PREKEYS: u32 = 100;
// Imzolangan oldindan-kalitning boshlang'ich identifikatori.
pub const SIGNED_PREKEY_ID: u32 = 1;

// UploadBundle — serverga yuboriladigan OCHIQ kalitlar to'plami (base64).
// Shaxsiy kalitlar bu yerga hech qachon kiritilmaydi.
#[derive(Debug, Serialize, Deserialize)]
pub struct UploadBundle {
    pub registration_id: u32,
    pub identity_key: String, // base64 (ochiq)
    pub signed_prekey: UploadSignedPreKey,
    pub one_time_prekeys: Vec<UploadPreKey>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UploadSignedPreKey {
    pub key_id: u32,
    pub public_key: String,
    pub signature: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UploadPreKey {
    pub key_id: u32,
    pub public_key: String,
}

// bootstrap_identity — mijozning butun kriptografik shaxsi yaratiladi:
//   1. doimiy identifikator (identity) juftligi,
//   2. imzolangan oldindan-kalit,
//   3. bir martalik oldindan-kalitlar.
// Shaxsiy qismlar mahalliy saqlovga (store) yoziladi; ochiq qismlar UploadBundle
// sifatida qaytarilib, serverga yuklanadi.
pub async fn bootstrap_identity(
    store: &mut LocalSignalStore,
) -> Result<UploadBundle, Box<dyn std::error::Error>> {
    let mut rng = OsRng;

    // Identifikator (Curve25519) juftligi store ichidan olinadi (store yaratilganda generatsiya qilingan)
    let identity_kp: IdentityKeyPair = store.identity_key_pair();
    let registration_id = store.registration_id();

    // Imzolangan oldindan-kalit yaratiladi va identity bilan imzolanadi
    let signed_pre_kp = KeyPair::generate(&mut rng);
    let signature = identity_kp
        .private_key()
        .calculate_signature(&signed_pre_kp.public_key.serialize(), &mut rng)?;

    // Imzolangan oldindan-kalit yozuvi (shaxsiy bilan) mahalliy saqlovga yoziladi
    let signed_record = SignedPreKeyRecord::new(
        SIGNED_PREKEY_ID.into(),
        now_millis(),
        &signed_pre_kp,
        &signature,
    );
    store
        .persist_signed_prekey(SIGNED_PREKEY_ID, &signed_record)
        .await?;

    // Bir martalik kalitlar yaratiladi va saqlovga yoziladi
    let mut otpks = Vec::with_capacity(NUM_ONE_TIME_PREKEYS as usize);
    for i in 0..NUM_ONE_TIME_PREKEYS {
        let key_id = i + 1;
        let kp = KeyPair::generate(&mut rng);
        let record = PreKeyRecord::new(key_id.into(), &kp);
        store.persist_prekey(key_id, &record).await?;

        otpks.push(UploadPreKey {
            key_id,
            public_key: B64.encode(kp.public_key.serialize()),
        });
    }

    // Serverga yuboriladigan ochiq bundle shakllantiriladi
    Ok(UploadBundle {
        registration_id,
        identity_key: B64.encode(identity_kp.identity_key().serialize()),
        signed_prekey: UploadSignedPreKey {
            key_id: SIGNED_PREKEY_ID,
            public_key: B64.encode(signed_pre_kp.public_key.serialize()),
            signature: B64.encode(&signature),
        },
        one_time_prekeys: otpks,
    })
}

// generate_more_otpks — zaxira tugab qolganda yangi bir martalik kalitlar yaratiladi.
// Yangi kalitlar saqlovga yoziladi va ochiq qismlari to'ldirish uchun qaytariladi.
pub async fn generate_more_otpks(
    store: &mut LocalSignalStore,
    start_id: u32,
    count: u32,
) -> Result<Vec<UploadPreKey>, Box<dyn std::error::Error>> {
    let mut rng = OsRng;
    let mut out = Vec::with_capacity(count as usize);
    for i in 0..count {
        let key_id = start_id + i;
        let kp = KeyPair::generate(&mut rng);
        let record = PreKeyRecord::new(key_id.into(), &kp);
        store.persist_prekey(key_id, &record).await?;
        out.push(UploadPreKey {
            key_id,
            public_key: B64.encode(kp.public_key.serialize()),
        });
    }
    Ok(out)
}

// now_millis — joriy vaqt millisekundlarda qaytariladi (kalit yozuvlari uchun belgi).
fn now_millis() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
