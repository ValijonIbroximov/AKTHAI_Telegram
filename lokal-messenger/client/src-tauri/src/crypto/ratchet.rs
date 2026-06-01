// Double Ratchet algoritmining to'liq implementatsiyasi.
// Referans: https://signal.org/docs/specifications/doubleratchet/
//
// Har bir xabar yuborish/qabul qilishda:
//  1. Simmetrik-kalit ratchet (zanjir kaliti bir bosqich oldinga siljiydi)
//  2. DH ratchet (yangi DH kalit juftligi almashilganda ildiz kalit yangilanadi)

use anyhow::Result;
use rand::rngs::OsRng;
use x25519_dalek::{PublicKey as X25519Pub, StaticSecret};

use super::{
    signal::{decrypt_msg, encrypt_msg, from_b64, kdf_ck, kdf_rk, to_b64},
    store::DbConn,
};

// Xabar header'i: qabul qiluvchiga DH ratchet kalitini va xabar raqamini bildiradi
#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct MessageHeader {
    pub dh_public_key: String,    // Yuboruvchining joriy DH ochiq kaliti (Base64)
    pub msg_num:       u32,       // Xabar raqami (o'tkazib yuborilgan xabarlar uchun)
    pub prev_chain_len: u32,      // Oldingi zanjir uzunligi
}

/// Xabar shifrlanadi (Double Ratchet yuborish tomoni).
/// Qaytariladi: (header: MessageHeader, ciphertext_b64: String)
pub fn ratchet_encrypt(
    db:        &DbConn,
    peer_id:   &str,
    plaintext: &[u8],
) -> Result<(MessageHeader, String)> {
    let mut session = super::store::get_session(db, peer_id)?
        .ok_or_else(|| anyhow::anyhow!("Sessiya topilmadi: {peer_id} — avval X3DH bajaring"))?;

    // Simmetrik ratchet: zanjir kalitidan xabar kaliti hosil qilinadi
    let chain_key: [u8; 32] = session.send_chain_key.clone().try_into()
        .map_err(|_| anyhow::anyhow!("Zanjir kalit o'lchami noto'g'ri"))?;
    let (msg_key, next_chain_key) = kdf_ck(&chain_key)?;

    // Header konstruksiyasi: AAD sifatida ishlatiladi (autentifikatsiyalangan ma'lumot)
    let header = MessageHeader {
        dh_public_key: to_b64(&session.send_ratchet_pk),
        msg_num:       session.send_msg_num,
        prev_chain_len: 0,
    };

    // Associated data: header JSON baytlari
    let aad = serde_json::to_vec(&header)?;

    // AES-256-GCM shifrlash
    let ciphertext = encrypt_msg(&msg_key, plaintext, &aad)?;

    // Sessiya yangilanadi
    session.send_chain_key = next_chain_key.to_vec();
    session.send_msg_num  += 1;
    super::store::save_session(db, &session)?;

    Ok((header, to_b64(&ciphertext)))
}

/// Xabar shifr ochiladi (Double Ratchet qabul tomoni).
pub fn ratchet_decrypt(
    db:           &DbConn,
    peer_id:      &str,
    header:       &MessageHeader,
    ciphertext_b64: &str,
) -> Result<Vec<u8>> {
    let mut session = super::store::get_session(db, peer_id)?
        .ok_or_else(|| anyhow::anyhow!("Sessiya topilmadi: {peer_id}"))?;

    let ciphertext = from_b64(ciphertext_b64)?;

    // Kelgan DH kalit joriy ratchet kalitidan farq qilsa — DH ratchet bajariladir
    let incoming_dh = from_b64(&header.dh_public_key)?;
    let need_dh_ratchet = session.recv_ratchet_pk.as_deref() != Some(&incoming_dh);

    if need_dh_ratchet {
        // Yangi DH ratchet bosqichi: ildiz kaliti va qabul zanjir kaliti yangilanadi
        let our_sk_bytes: [u8; 32] = session.send_ratchet_pk.clone().try_into()
            .map_err(|_| anyhow::anyhow!("Ratchet maxfiy kalit o'lchami noto'g'ri"))?;
        let our_sk = StaticSecret::from(our_sk_bytes);

        let their_pk_bytes: [u8; 32] = incoming_dh.clone().try_into()
            .map_err(|_| anyhow::anyhow!("Kelgan DH kalit o'lchami noto'g'ri"))?;
        let their_pk = X25519Pub::from(their_pk_bytes);

        let dh_output = our_sk.diffie_hellman(&their_pk);

        let root_key: [u8; 32] = session.root_key.clone().try_into()
            .map_err(|_| anyhow::anyhow!("Ildiz kalit o'lchami noto'g'ri"))?;

        let (new_root, new_recv_chain) = kdf_rk(&root_key, dh_output.as_bytes())?;

        // Yangi yuborish uchun DH kalit juftligi yaratiladi
        let new_send_sk  = StaticSecret::random_from_rng(OsRng);
        let new_send_pk  = X25519Pub::from(&new_send_sk);
        let dh_send      = new_send_sk.diffie_hellman(&their_pk);
        let (new_root2, new_send_chain) = kdf_rk(&new_root, dh_send.as_bytes())?;

        session.root_key        = new_root2.to_vec();
        session.recv_chain_key  = new_recv_chain.to_vec();
        session.send_chain_key  = new_send_chain.to_vec();
        session.recv_ratchet_pk = Some(incoming_dh);
        session.send_ratchet_pk = new_send_pk.as_bytes().to_vec();
        session.recv_msg_num    = 0;
    }

    // Simmetrik ratchet: zanjir kalitidan xabar kaliti hosil qilinadi
    let chain_key: [u8; 32] = session.recv_chain_key.clone().try_into()
        .map_err(|_| anyhow::anyhow!("Qabul zanjir kalit o'lchami noto'g'ri"))?;
    let (msg_key, next_chain_key) = kdf_ck(&chain_key)?;

    // Associated data: header JSON baytlari
    let aad = serde_json::to_vec(header)?;

    // AES-256-GCM shifr ochish
    let plaintext = decrypt_msg(&msg_key, &ciphertext, &aad)?;

    // Sessiya yangilanadi
    session.recv_chain_key = next_chain_key.to_vec();
    session.recv_msg_num  += 1;
    super::store::save_session(db, &session)?;

    Ok(plaintext)
}

/// Yangi X25519 ratchet kalit juftligi yaratiladi
pub fn generate_ratchet_keypair() -> ([u8; 32], [u8; 32]) {
    let sk  = StaticSecret::random_from_rng(OsRng);
    let pk  = X25519Pub::from(&sk);
    (pk.to_bytes(), sk.to_bytes())
}
