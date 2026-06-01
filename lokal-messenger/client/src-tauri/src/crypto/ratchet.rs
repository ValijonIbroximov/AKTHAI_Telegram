// ================================================================
// Double Ratchet Algoritmi — to'liq implementatsiya
//
// Referans: https://signal.org/docs/specifications/doubleratchet/
//
// Holat maydoni:
//   root_key        — ildiz kaliti (DH ratchet yangilanganda o'zgaradi)
//   send_chain_key  — yuborish zanjir kaliti (har xabar uchun bir bosqich)
//   recv_chain_key  — qabul zanjir kaliti
//   send_ratchet_pk — joriy yuborish DH ochiq kaliti (header'ga qo'shiladi)
//   recv_ratchet_pk — oxirgi qabul qilingan DH ochiq kalit
//   send_msg_num    — yuborilgan xabar raqami (joriy zanjirda)
//   recv_msg_num    — qabul qilingan xabar raqami
//
// "O'tkazib yuborilgan xabar" mexanizmi:
//   O'tkazib yuborilgan xabarlarning MSG kalitlari skipped_keys jadvalida
//   saqlanadi. Bu tarmoq kechikmasida to'g'ri tartibdan tashqari yetkazilgan
//   xabarlarni ochish imkonini beradi.
// ================================================================

use anyhow::{bail, Result};
use rand::rngs::OsRng;
use serde::{Deserialize, Serialize};
use x25519_dalek::{PublicKey as X25519Pub, StaticSecret};

use super::{
    signal::{aes_gcm_decrypt, aes_gcm_encrypt, from_b64, kdf_ck, kdf_rk, to_b64},
    store::{
        get_session, get_skipped_key, remove_skipped_key, save_session, save_skipped_key, DbConn,
        SignalSession,
    },
};

// O'tkazib yuborilgan xabar kalitlarining maksimal soni (xotira limitidan saqlaydi)
const MAX_SKIP: u32 = 1000;

/// Xabar header'i — Double Ratchet holati bilan birga uzatiladi.
/// AAD (associated data) sifatida AES-GCM ga beriladi — autentifikatsiya uchun.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageHeader {
    /// Yuboruvchining joriy DH ratchet ochiq kaliti (Base64)
    pub dh_ratchet_pk: String,
    /// Joriy zanjirdagi xabar raqami (0-indexed)
    pub msg_num: u32,
    /// Oldingi yuborish zanjirining uzunligi (o'tkazib yuborilganlarni aniqlash uchun)
    pub prev_chain_len: u32,
}

/// Yangi X25519 ratchet kalit juftligi yaratiladi.
/// (pub_bytes, priv_bytes) ko'rinishida qaytariladi.
pub fn generate_ratchet_keypair() -> ([u8; 32], [u8; 32]) {
    let sk = StaticSecret::random_from_rng(OsRng);
    let pk = X25519Pub::from(&sk);
    (pk.to_bytes(), sk.to_bytes())
}

/// O'tkazib yuborilgan xabar kalitlarini saqlaydi (tarmoq kechikmasiga bardosh berish).
fn skip_message_keys(
    db:        &DbConn,
    peer_id:   &str,
    session:   &mut SignalSession,
    until:     u32,
) -> Result<()> {
    if until < session.recv_msg_num {
        bail!("O'tkazib yuborilgan xabar raqami joriy pozitsiyadan kichik");
    }
    if until - session.recv_msg_num > MAX_SKIP {
        bail!("Juda ko'p xabar o'tkazib yuborilgan ({})", until - session.recv_msg_num);
    }

    let ratchet_pk_key = session.recv_ratchet_pk.clone().unwrap_or_default();

    while session.recv_msg_num < until {
        let ck: [u8; 32] = session.recv_chain_key.clone().try_into()
            .map_err(|_| anyhow::anyhow!("Qabul zanjir kalit o'lchami noto'g'ri"))?;
        let (msg_key, next_ck) = kdf_ck(&ck)?;

        // Bu xabar kaliti keyinchalik kerak bo'lishi mumkin — saqlanadi
        save_skipped_key(db, peer_id, &ratchet_pk_key, session.recv_msg_num, &msg_key)?;

        session.recv_chain_key = next_ck.to_vec();
        session.recv_msg_num  += 1;
    }
    Ok(())
}

/// DH ratchet bosqichini bajaradi (yangi sherik DH kaliti kelganda).
fn dh_ratchet_step(session: &mut SignalSession, their_new_pk: &[u8]) -> Result<()> {
    // Joriy yuborish ratchet maxfiy kaliti
    let our_sk_bytes: [u8; 32] = session.send_ratchet_sk.clone().try_into()
        .map_err(|_| anyhow::anyhow!("Ratchet SK o'lchami noto'g'ri"))?;
    let our_sk = StaticSecret::from(our_sk_bytes);

    // Sherik yangi DH kaliti
    let their_pk_bytes: [u8; 32] = their_new_pk.try_into()
        .map_err(|_| anyhow::anyhow!("DH PK o'lchami noto'g'ri"))?;
    let their_pk = X25519Pub::from(their_pk_bytes);

    // 1. Qabul zanjir kaliti: DH(bizning SK, ularning yangi PK) + ildiz kalit
    let root_key: [u8; 32] = session.root_key.clone().try_into()
        .map_err(|_| anyhow::anyhow!("Ildiz kalit o'lchami noto'g'ri"))?;
    let dh_out1 = our_sk.diffie_hellman(&their_pk);
    let (new_root1, recv_chain) = kdf_rk(&root_key, dh_out1.as_bytes())?;

    // 2. Yangi yuborish ratchet kalit juftligi
    let new_send_sk  = StaticSecret::random_from_rng(OsRng);
    let new_send_pk  = X25519Pub::from(&new_send_sk);
    let dh_out2      = new_send_sk.diffie_hellman(&their_pk);
    let (new_root2, send_chain) = kdf_rk(&new_root1, dh_out2.as_bytes())?;

    // Sessiya holati yangilanadi
    session.prev_send_chain_len = session.send_msg_num;
    session.root_key            = new_root2.to_vec();
    session.recv_chain_key      = recv_chain.to_vec();
    session.send_chain_key      = send_chain.to_vec();
    session.recv_ratchet_pk     = Some(their_new_pk.to_vec());
    session.send_ratchet_pk     = new_send_pk.as_bytes().to_vec();
    session.send_ratchet_sk     = new_send_sk.to_bytes().to_vec();
    session.send_msg_num        = 0;
    session.recv_msg_num        = 0;

    Ok(())
}

/// Double Ratchet — xabar shifrlanadi (yuboruvchi tomoni).
///
/// Qaytaradi: JSON formatidagi shifrlangan xabar `{"header":{...},"ciphertext":"..."}`
pub fn ratchet_encrypt(db: &DbConn, peer_id: &str, plaintext: &[u8]) -> Result<String> {
    let mut session = get_session(db, peer_id)?
        .ok_or_else(|| anyhow::anyhow!(
            "Sessiya topilmadi: {peer_id}. Avval X3DH sessiyasini o'rnating."
        ))?;

    // Simmetrik ratchet: zanjir kalitidan xabar kaliti hosil qilinadi
    let ck: [u8; 32] = session.send_chain_key.clone().try_into()
        .map_err(|_| anyhow::anyhow!("Yuborish zanjir kalit o'lchami noto'g'ri"))?;
    let (msg_key, next_ck) = kdf_ck(&ck)?;

    // Header konstruktsiyasi
    let header = MessageHeader {
        dh_ratchet_pk:  to_b64(&session.send_ratchet_pk),
        msg_num:        session.send_msg_num,
        prev_chain_len: session.prev_send_chain_len,
    };

    // Header AAD sifatida ishlatiladi — autentifikatsiyani ta'minlaydi
    let aad = serde_json::to_vec(&header)?;

    // AES-256-GCM shifrlash
    let ciphertext = aes_gcm_encrypt(&msg_key, plaintext, &aad)?;

    // Sessiya yangilanadi
    session.send_chain_key = next_ck.to_vec();
    session.send_msg_num  += 1;
    save_session(db, &session)?;

    // Chiqish: header + ciphertext JSON formatida
    let payload = serde_json::json!({
        "header":     header,
        "ciphertext": to_b64(&ciphertext),
    });
    Ok(payload.to_string())
}

/// Double Ratchet — xabar shifri ochiladi (qabul qiluvchi tomoni).
///
/// `payload_json`: `{"header":{...},"ciphertext":"..."}` formatidagi matn
pub fn ratchet_decrypt(db: &DbConn, peer_id: &str, payload_json: &str) -> Result<Vec<u8>> {
    // JSON parserlash
    let val: serde_json::Value = serde_json::from_str(payload_json)
        .map_err(|e| anyhow::anyhow!("Payload JSON formati noto'g'ri: {e}"))?;

    let header: MessageHeader = serde_json::from_value(
        val["header"].clone()
    ).map_err(|e| anyhow::anyhow!("Header formati noto'g'ri: {e}"))?;

    let cipher_b64 = val["ciphertext"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("ciphertext maydoni yo'q"))?;
    let ciphertext = from_b64(cipher_b64)?;

    let their_rk_pk = from_b64(&header.dh_ratchet_pk)?;
    let aad         = serde_json::to_vec(&header)?;

    // Avval o'tkazib yuborilgan kalitlar ro'yxatini tekshiramiz
    if let Some(skipped_key) = get_skipped_key(db, peer_id, &their_rk_pk, header.msg_num)? {
        let mk: [u8; 32] = skipped_key.try_into()
            .map_err(|_| anyhow::anyhow!("O'tkazib yuborilgan kalit o'lchami noto'g'ri"))?;
        let pt = aes_gcm_decrypt(&mk, &ciphertext, &aad)?;
        remove_skipped_key(db, peer_id, &their_rk_pk, header.msg_num)?;
        return Ok(pt);
    }

    let mut session = get_session(db, peer_id)?
        .ok_or_else(|| anyhow::anyhow!("Sessiya topilmadi: {peer_id}"))?;

    // Yangi DH ratchet kaliti kelganligini aniqlash
    let is_new_ratchet = session.recv_ratchet_pk.as_deref() != Some(&their_rk_pk);

    if is_new_ratchet {
        // Oldingi zanjirdagi o'tkazib yuborilgan xabarlar saqlanadi
        skip_message_keys(db, peer_id, &mut session, header.prev_chain_len)?;
        // DH ratchet bosqichi bajariladi
        dh_ratchet_step(&mut session, &their_rk_pk)?;
    }

    // Joriy zanjirdagi o'tkazib yuborilgan xabarlar (agar mavjud bo'lsa)
    skip_message_keys(db, peer_id, &mut session, header.msg_num)?;

    // Joriy xabar uchun simmetrik ratchet
    let ck: [u8; 32] = session.recv_chain_key.clone().try_into()
        .map_err(|_| anyhow::anyhow!("Qabul zanjir kalit o'lchami noto'g'ri"))?;
    let (msg_key, next_ck) = kdf_ck(&ck)?;

    // AES-256-GCM shifr ochish
    let plaintext = aes_gcm_decrypt(&msg_key, &ciphertext, &aad)?;

    // Sessiya yangilanadi
    session.recv_chain_key = next_ck.to_vec();
    session.recv_msg_num  += 1;
    save_session(db, &session)?;

    Ok(plaintext)
}
