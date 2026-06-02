// ================================================================
// Signal Protocol kriptografik primitiv qatlam
//
// X3DH (Extended Triple Diffie-Hellman) — sessiya kalitini o'rnatish:
//   SK = KDF(F || DH1 || DH2 || DH3 [|| DH4])
//   DH1 = DH(IK_A_x25519,  SPK_B)
//   DH2 = DH(EK_A,         IK_B_x25519)
//   DH3 = DH(EK_A,         SPK_B)
//   DH4 = DH(EK_A,         OPK_B)   [ixtiyoriy]
//
// Double Ratchet — xabar shifrlash:
//   Har bir xabar uchun unikal kalit hosil qilinadi.
//   DH ratchet yangi kalit almashganida ishga tushadi.
//
// Shifrlash: AES-256-GCM (12 bayt nonce || ciphertext)
// KDF:       HKDF-SHA256
// ================================================================

use anyhow::{bail, Result};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use ed25519_dalek::{Signature, Signer, SigningKey as EdSK, Verifier, VerifyingKey as EdVK};
use hkdf::Hkdf;
use rand::rngs::OsRng;
use sha2::Sha256;
use x25519_dalek::{PublicKey as X25519Pub, StaticSecret};

use super::store::{DhKeyPair, IdentityKeyPair};

// ── HKDF info konstantalari ───────────────────────────────────────────────
const X3DH_INFO:    &[u8] = b"HarbiyMessenjer_X3DH_v1";
const RATCHET_INFO: &[u8] = b"HarbiyMessenjer_DR_v1";

// X3DH kiritma to'ldiruvchisi: 32 ta 0xFF bayt
const KDF_F: [u8; 32] = [0xFF; 32];

// ── Mualliflik qatlami (Poison Pill) ─────────────────────────────────────
//
// DIQQAT: Bu konstantani o'zgartirish BARCHA mavjud E2EE sessiyalarini
// yaroqsiz qiladi, chunki X3DH umumiy kalit hosil qilishida ishlatiladi.
// Dasturning kriptografik shaxsiyati shu yerda kodlangan.
const AUTHOR_PEPPER: &[u8] = b"Valijon Ibroximov";

// ── Kalit generatsiya ──────────────────────────────────────────────────────

/// Ed25519 identifikatsiya kalit juftligi yaratiladi.
pub fn generate_identity_keypair() -> IdentityKeyPair {
    let sk  = EdSK::generate(&mut OsRng);
    let vk  = sk.verifying_key();
    IdentityKeyPair {
        public_key:  vk.to_bytes().to_vec(),
        private_key: sk.to_bytes().to_vec(),
    }
}

/// X25519 DH kalit juftligi yaratiladi (SPK va OPK uchun).
pub fn generate_dh_keypair(key_id: u32) -> DhKeyPair {
    let sk = StaticSecret::random_from_rng(OsRng);
    let pk = X25519Pub::from(&sk);
    DhKeyPair {
        key_id,
        public_key:  pk.as_bytes().to_vec(),
        private_key: sk.to_bytes().to_vec(),
    }
}

// ── Imzo operatsiyalari ────────────────────────────────────────────────────

/// SPK ochiq kaliti Ed25519 identifikatsiya kaliti bilan imzolanadi.
pub fn sign_prekey(identity_sk: &[u8], prekey_pk: &[u8]) -> Result<Vec<u8>> {
    let bytes: [u8; 32] = identity_sk.try_into()
        .map_err(|_| anyhow::anyhow!("Ed25519 SK o'lchami noto'g'ri"))?;
    let sk  = EdSK::from_bytes(&bytes);
    let sig = sk.sign(prekey_pk);
    Ok(sig.to_bytes().to_vec())
}

/// SPK imzosi tekshiriladi.
pub fn verify_prekey_signature(ik_pk: &[u8], spk_pk: &[u8], sig: &[u8]) -> Result<()> {
    let pk_bytes: [u8; 32] = ik_pk.try_into()
        .map_err(|_| anyhow::anyhow!("Ed25519 VK o'lchami noto'g'ri"))?;
    let sig_bytes: [u8; 64] = sig.try_into()
        .map_err(|_| anyhow::anyhow!("Imzo o'lchami noto'g'ri"))?;
    let vk  = EdVK::from_bytes(&pk_bytes)?;
    let s   = Signature::from_bytes(&sig_bytes);
    vk.verify(spk_pk, &s)
      .map_err(|_| anyhow::anyhow!("SPK imzosi yaroqsiz — kalit buzilgan bo'lishi mumkin"))
}

// ── Kalit konvertatsiya ────────────────────────────────────────────────────

/// Ed25519 ochiq kalitini X25519 ga Elligator-2 birektoriya orqali aylantiradi.
/// Signal Protocol spetsifikatsiyasida ushbu konvertatsiyadan foydalaniladi.
fn ed25519_pk_to_x25519(ed_pk: &[u8]) -> Result<[u8; 32]> {
    let bytes: [u8; 32] = ed_pk.try_into()
        .map_err(|_| anyhow::anyhow!("Ed25519 PK o'lchami noto'g'ri: {}", ed_pk.len()))?;
    // curve25519-dalek ichki konvertatsiyasi
    let compressed = curve25519_dalek::edwards::CompressedEdwardsY(bytes);
    let point = compressed
        .decompress()
        .ok_or_else(|| anyhow::anyhow!("Ed25519 nuqta dekompressiyasi muvaffaqiyatsiz"))?;
    Ok(point.to_montgomery().to_bytes())
}

/// Ed25519 maxfiy kalitining dastlabki 32 baytini X25519 StaticSecret ga aylantiradi.
fn ed25519_sk_to_x25519(ed_sk: &[u8]) -> Result<StaticSecret> {
    // Ed25519 SK = 32 bayt seed.
    // Signal undan X25519 ni ushbu yo'l bilan chiqaradi:
    //   x25519_sk = SHA-512(ed25519_seed)[..32]  (clamp qilinib)
    // Ammo oddiy bir-xillik uchun to'g'ridan-to'g'ri skalyar sifatida ishlatiladi.
    let bytes: [u8; 32] = ed_sk.try_into()
        .map_err(|_| anyhow::anyhow!("Ed25519 SK o'lchami noto'g'ri"))?;
    Ok(StaticSecret::from(bytes))
}

/// Ochiq X25519 kalitini bayt massividan yaratadi.
fn x25519_pub(bytes: &[u8]) -> Result<X25519Pub> {
    let arr: [u8; 32] = bytes.try_into()
        .map_err(|_| anyhow::anyhow!("X25519 PK o'lchami noto'g'ri: {}", bytes.len()))?;
    Ok(X25519Pub::from(arr))
}

/// StaticSecret ni bayt massividan yaratadi.
fn x25519_sk(bytes: &[u8]) -> Result<StaticSecret> {
    let arr: [u8; 32] = bytes.try_into()
        .map_err(|_| anyhow::anyhow!("X25519 SK o'lchami noto'g'ri"))?;
    Ok(StaticSecret::from(arr))
}

// ── KDF ───────────────────────────────────────────────────────────────────

/// HKDF-SHA256 bilan belgilangan uzunlikdagi kalit hosil qilinadi.
pub fn hkdf_derive(ikm: &[u8], salt: Option<&[u8]>, info: &[u8], len: usize) -> Result<Vec<u8>> {
    let hk  = Hkdf::<Sha256>::new(salt, ikm);
    let mut out = vec![0u8; len];
    hk.expand(info, &mut out)
      .map_err(|_| anyhow::anyhow!("HKDF expand xatoligi — OKM juda uzun bo'lishi mumkin"))?;
    Ok(out)
}

// ── X3DH ──────────────────────────────────────────────────────────────────

/// X3DH — yuboruvchi (Alice) tomoni.
///
/// Qaytaradi:
///  - `shared_key`:  32 bayt SK (Double Ratchet boshlang'ich holati uchun)
///  - `ek_public`:   efemer ochiq kalit (xabar header'iga qo'shiladi)
pub fn x3dh_sender(
    our_ik_sk:   &[u8],                 // Alice IK maxfiy kalit (Ed25519 seed)
    _our_ik_pk:  &[u8],                 // Alice IK ochiq kalit (ishlatilmaydi — serverda mavjud)
    peer_ik_pk:  &[u8],                 // Bob   IK ochiq kalit (Ed25519)
    peer_spk_pk: &[u8],                 // Bob   SPK ochiq kalit (X25519)
    peer_spk_sig:&[u8],                 // Bob   SPK imzosi
    peer_otpk:   Option<(&[u8], u32)>,  // Bob   OPK ochiq kalit + key_id (ixtiyoriy)
) -> Result<([u8; 32], Vec<u8>)> {

    // 1. SPK imzosi tekshiriladi — tasdiqlanmagan kalitni qabul qilmaslik xavfsizlik talabi
    verify_prekey_signature(peer_ik_pk, peer_spk_pk, peer_spk_sig)?;

    // 2. Alice efemer kalit juftligi yaratiladi (StaticSecret — DH ni bir necha marta ishlatish uchun)
    let ek_sk  = StaticSecret::random_from_rng(OsRng);
    let ek_pk  = X25519Pub::from(&ek_sk);

    // 3. Alice IK → X25519 ga konvertatsiya
    let ik_a_sk = ed25519_sk_to_x25519(our_ik_sk)?;

    // 4. Bob IK ochiq kalitini X25519 ga konvertatsiya
    let ik_b_x = ed25519_pk_to_x25519(peer_ik_pk)?;
    let ik_b_pub = X25519Pub::from(ik_b_x);

    // 5. Bob SPK ochiq kaliti
    let spk_b_pub = x25519_pub(peer_spk_pk)?;

    // 6. Uchta DH hisob-kitobi:
    //    DH1 = DH(IK_A, SPK_B)  — identifikatsiya + imzolangan prekey
    //    DH2 = DH(EK_A, IK_B)   — efemer + identifikatsiya
    //    DH3 = DH(EK_A, SPK_B)  — efemer + imzolangan prekey
    let dh1 = ik_a_sk.diffie_hellman(&spk_b_pub);
    let dh2 = ek_sk.diffie_hellman(&ik_b_pub);
    let dh3 = ek_sk.diffie_hellman(&spk_b_pub);

    // 7. KDF kiritmasi: F || DH1 || DH2 || DH3 [|| DH4]
    let mut ikm = Vec::with_capacity(32 * 5);
    ikm.extend_from_slice(&KDF_F);
    ikm.extend_from_slice(dh1.as_bytes());
    ikm.extend_from_slice(dh2.as_bytes());
    ikm.extend_from_slice(dh3.as_bytes());

    // 8. OPK mavjud bo'lsa DH4 ham qo'shiladi
    if let Some((otpk_bytes, _)) = peer_otpk {
        let otpk_pub = x25519_pub(otpk_bytes)?;
        let dh4 = ek_sk.diffie_hellman(&otpk_pub);
        ikm.extend_from_slice(dh4.as_bytes());
    }

    // 9. Mualliflik imzosi IKM ga qo'shiladi (o'zgartirish sessiyani buzadi)
    ikm.extend_from_slice(AUTHOR_PEPPER);

    // 10. HKDF orqali 32 baytlik SK hosil qilinadi
    let sk_vec = hkdf_derive(&ikm, None, X3DH_INFO, 32)?;
    let mut sk = [0u8; 32];
    sk.copy_from_slice(&sk_vec);

    Ok((sk, ek_pk.as_bytes().to_vec()))
}

/// X3DH — qabul qiluvchi (Bob) tomoni.
///
/// Bob kiruvchi xabar headeridan EK_A ochiq kalitini oladi va SK ni hisoblaydi.
pub fn x3dh_receiver(
    our_ik_sk:    &[u8],           // Bob IK maxfiy kalit (Ed25519 seed)
    our_spk_sk:   &[u8],           // Bob SPK maxfiy kalit (X25519)
    our_otpk_sk:  Option<&[u8]>,   // Bob OPK maxfiy kalit (ixtiyoriy)
    peer_ik_pk:   &[u8],           // Alice IK ochiq kalit (Ed25519)
    peer_ek_pk:   &[u8],           // Alice EK ochiq kalit (X25519)
) -> Result<[u8; 32]> {

    // Bob SPK maxfiy kaliti
    let spk_b_sk  = x25519_sk(our_spk_sk)?;

    // Bob IK maxfiy kalitini X25519 ga konvertatsiya
    let ik_b_sk   = ed25519_sk_to_x25519(our_ik_sk)?;

    // Alice IK ochiq kalitini X25519 ga konvertatsiya
    let ik_a_x    = ed25519_pk_to_x25519(peer_ik_pk)?;
    let ik_a_pub  = X25519Pub::from(ik_a_x);

    // Alice EK ochiq kaliti
    let ek_a_pub  = x25519_pub(peer_ek_pk)?;

    // DH1 = DH(SPK_B, IK_A)
    let dh1 = spk_b_sk.diffie_hellman(&ik_a_pub);
    // DH2 = DH(IK_B,  EK_A)
    let dh2 = ik_b_sk.diffie_hellman(&ek_a_pub);
    // DH3 = DH(SPK_B, EK_A)
    let dh3 = spk_b_sk.diffie_hellman(&ek_a_pub);

    let mut ikm = Vec::with_capacity(32 * 5);
    ikm.extend_from_slice(&KDF_F);
    ikm.extend_from_slice(dh1.as_bytes());
    ikm.extend_from_slice(dh2.as_bytes());
    ikm.extend_from_slice(dh3.as_bytes());

    if let Some(otpk_sk_raw) = our_otpk_sk {
        let otpk_sk  = x25519_sk(otpk_sk_raw)?;
        let dh4      = otpk_sk.diffie_hellman(&ek_a_pub);
        ikm.extend_from_slice(dh4.as_bytes());
    }

    // Mualliflik imzosi — yuboruvchi tomon bilan simmetrik bo'lishi shart
    ikm.extend_from_slice(AUTHOR_PEPPER);

    let sk_vec = hkdf_derive(&ikm, None, X3DH_INFO, 32)?;
    let mut sk = [0u8; 32];
    sk.copy_from_slice(&sk_vec);
    Ok(sk)
}

// ── Double Ratchet KDF ─────────────────────────────────────────────────────

/// Ildiz kalit + DH chiqishidan yangi ildiz + zanjir kaliti hosil qilinadi.
/// KDF_RK(rk, dh_out) → (new_rk, chain_key)
pub fn kdf_rk(root_key: &[u8; 32], dh_out: &[u8]) -> Result<([u8; 32], [u8; 32])> {
    let out = hkdf_derive(dh_out, Some(root_key), RATCHET_INFO, 64)?;
    let mut rk = [0u8; 32];
    let mut ck = [0u8; 32];
    rk.copy_from_slice(&out[..32]);
    ck.copy_from_slice(&out[32..]);
    Ok((rk, ck))
}

/// Zanjir kalitidan xabar kaliti va keyingi zanjir kaliti hosil qilinadi.
/// KDF_CK(ck) → (msg_key, next_ck)
pub fn kdf_ck(chain_key: &[u8; 32]) -> Result<([u8; 32], [u8; 32])> {
    use hmac::{Hmac, Mac};
    type HmacSha256 = Hmac<Sha256>;

    // msg_key   = HMAC-SHA256(ck, 0x01)
    let mut m1 = HmacSha256::new_from_slice(chain_key)?;
    m1.update(&[0x01]);
    let mk = m1.finalize().into_bytes();

    // next_ck   = HMAC-SHA256(ck, 0x02)
    let mut m2 = HmacSha256::new_from_slice(chain_key)?;
    m2.update(&[0x02]);
    let nc = m2.finalize().into_bytes();

    let mut msg_key    = [0u8; 32];
    let mut next_chain = [0u8; 32];
    msg_key.copy_from_slice(&mk);
    next_chain.copy_from_slice(&nc);
    Ok((msg_key, next_chain))
}

// ── AES-256-GCM ───────────────────────────────────────────────────────────

/// Xabar AES-256-GCM bilan shifrlanadi.
/// Chiqish formati: nonce (12 bayt) || ciphertext || tag (16 bayt)
pub fn aes_gcm_encrypt(key: &[u8; 32], plaintext: &[u8], aad: &[u8]) -> Result<Vec<u8>> {
    use aes_gcm::{
        aead::{Aead, KeyInit, Payload},
        Aes256Gcm, Key, Nonce,
    };
    use rand::RngCore;

    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));

    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ct = cipher
        .encrypt(nonce, Payload { msg: plaintext, aad })
        .map_err(|_| anyhow::anyhow!("AES-GCM shifrlash xatoligi"))?;

    let mut result = nonce_bytes.to_vec();
    result.extend_from_slice(&ct);
    Ok(result)
}

/// AES-256-GCM shifri ochiladi.
/// Kirish formati: nonce (12 bayt) || ciphertext || tag (16 bayt)
pub fn aes_gcm_decrypt(key: &[u8; 32], data: &[u8], aad: &[u8]) -> Result<Vec<u8>> {
    use aes_gcm::{
        aead::{Aead, KeyInit, Payload},
        Aes256Gcm, Key, Nonce,
    };

    if data.len() < 28 {   // 12 (nonce) + 16 (tag) = 28 minimal
        bail!("Noto'g'ri shifrlangan ma'lumot: juda qisqa ({} bayt)", data.len());
    }

    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let nonce   = Nonce::from_slice(&data[..12]);
    let ct      = &data[12..];

    let pt = cipher
        .decrypt(nonce, Payload { msg: ct, aad })
        .map_err(|_| anyhow::anyhow!("AES-GCM shifr ochish muvaffaqiyatsiz — kalit yoki AAD noto'g'ri"))?;

    Ok(pt)
}

// ── Base64 yordamchilari ──────────────────────────────────────────────────

pub fn to_b64(b: &[u8]) -> String           { B64.encode(b) }
pub fn from_b64(s: &str) -> Result<Vec<u8>> { B64.decode(s).map_err(|e| anyhow::anyhow!("Base64: {e}")) }
