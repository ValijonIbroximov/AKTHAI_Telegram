// Signal Protocol kalitlari va sessiyalari SQLite bazasida saqlanadi.
// thread-safe: Arc<Mutex<Connection>> bilan barcha operatsiyalar himoyalangan.

use anyhow::{Context, Result};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};

// ── Ma'lumot tuzilmalari ──────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdentityKeyPair {
    /// Ed25519 ochiq kalit (serverga Base64 formatida yuboriladi)
    pub public_key:  Vec<u8>,
    /// Ed25519 maxfiy kalit (faqat qurilmada saqlanadi, hech qachon uzatilmaydi)
    pub private_key: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DhKeyPair {
    pub key_id:      u32,
    /// X25519 ochiq kalit (serverga yuboriladi)
    pub public_key:  Vec<u8>,
    /// X25519 maxfiy kalit (qurilmada saqlanadi)
    pub private_key: Vec<u8>,
}

/// Double Ratchet sessiya holati — har bir suhbat sherigi uchun alohida.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignalSession {
    pub peer_id:             String,
    /// Ildiz kaliti — DH ratchet har yangilanishida o'zgaradi
    pub root_key:            Vec<u8>,
    /// Yuborish zanjir kaliti
    pub send_chain_key:      Vec<u8>,
    /// Qabul zanjir kaliti
    pub recv_chain_key:      Vec<u8>,
    /// Joriy zanjirdagi yuborilgan xabar raqami
    pub send_msg_num:        u32,
    /// Joriy zanjirdagi qabul qilingan xabar raqami
    pub recv_msg_num:        u32,
    /// Joriy yuborish DH ochiq kaliti (header'ga qo'shiladi)
    pub send_ratchet_pk:     Vec<u8>,
    /// Joriy yuborish DH maxfiy kaliti (DH ratchet uchun)
    pub send_ratchet_sk:     Vec<u8>,
    /// Oxirgi qabul qilingan DH ochiq kalit
    pub recv_ratchet_pk:     Option<Vec<u8>>,
    /// Oldingi yuborish zanjirining uzunligi (o'tkazib yuborilganlar uchun)
    pub prev_send_chain_len: u32,
}

pub type DbConn = Arc<Mutex<Connection>>;

// ── Baza ochilishi ────────────────────────────────────────────────────────

pub fn open_db(path: &str) -> Result<DbConn> {
    let conn = Connection::open(path)
        .with_context(|| format!("SQLite bazasi ochilmadi: {path}"))?;

    // WAL rejimi: bir vaqtda o'qish/yozish, minimal RAM
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;

    conn.execute_batch("
        CREATE TABLE IF NOT EXISTS identity (
            id              INTEGER PRIMARY KEY CHECK (id = 1),
            registration_id INTEGER NOT NULL,
            public_key      BLOB NOT NULL,
            private_key     BLOB NOT NULL
        );

        CREATE TABLE IF NOT EXISTS signed_prekeys (
            key_id      INTEGER PRIMARY KEY,
            public_key  BLOB NOT NULL,
            private_key BLOB NOT NULL,
            signature   BLOB NOT NULL,
            created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS one_time_prekeys (
            key_id      INTEGER PRIMARY KEY,
            public_key  BLOB NOT NULL,
            private_key BLOB NOT NULL,
            used        INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS sessions (
            peer_id              TEXT PRIMARY KEY,
            root_key             BLOB NOT NULL,
            send_chain_key       BLOB NOT NULL,
            recv_chain_key       BLOB NOT NULL,
            send_msg_num         INTEGER NOT NULL DEFAULT 0,
            recv_msg_num         INTEGER NOT NULL DEFAULT 0,
            send_ratchet_pk      BLOB NOT NULL,
            send_ratchet_sk      BLOB NOT NULL,
            recv_ratchet_pk      BLOB,
            prev_send_chain_len  INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS skipped_keys (
            peer_id     TEXT NOT NULL,
            ratchet_pk  BLOB NOT NULL,
            msg_num     INTEGER NOT NULL,
            msg_key     BLOB NOT NULL,
            PRIMARY KEY (peer_id, ratchet_pk, msg_num)
        );
    ")?;

    Ok(Arc::new(Mutex::new(conn)))
}

// ── Identity ──────────────────────────────────────────────────────────────

pub fn get_identity(db: &DbConn) -> Result<Option<(u32, IdentityKeyPair)>> {
    let c = db.lock().unwrap();
    let mut st = c.prepare(
        "SELECT registration_id, public_key, private_key FROM identity WHERE id = 1"
    )?;
    match st.query_row([], |r| Ok((
        r.get::<_, u32>(0)?,
        IdentityKeyPair { public_key: r.get(1)?, private_key: r.get(2)? },
    ))) {
        Ok(v)                                     => Ok(Some(v)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e)                                    => Err(e.into()),
    }
}

pub fn save_identity(db: &DbConn, reg_id: u32, kp: &IdentityKeyPair) -> Result<()> {
    db.lock().unwrap().execute(
        "INSERT OR REPLACE INTO identity (id, registration_id, public_key, private_key)
         VALUES (1, ?1, ?2, ?3)",
        params![reg_id, kp.public_key, kp.private_key],
    )?;
    Ok(())
}

// ── Signed prekey ─────────────────────────────────────────────────────────

pub fn save_signed_prekey(db: &DbConn, kp: &DhKeyPair, sig: &[u8]) -> Result<()> {
    db.lock().unwrap().execute(
        "INSERT OR REPLACE INTO signed_prekeys (key_id, public_key, private_key, signature)
         VALUES (?1, ?2, ?3, ?4)",
        params![kp.key_id, kp.public_key, kp.private_key, sig],
    )?;
    Ok(())
}

pub fn get_signed_prekey(db: &DbConn) -> Result<Option<(DhKeyPair, Vec<u8>)>> {
    let c = db.lock().unwrap();
    let mut st = c.prepare(
        "SELECT key_id, public_key, private_key, signature FROM signed_prekeys
         ORDER BY key_id DESC LIMIT 1"
    )?;
    match st.query_row([], |r| Ok((
        DhKeyPair { key_id: r.get(0)?, public_key: r.get(1)?, private_key: r.get(2)? },
        r.get::<_, Vec<u8>>(3)?,
    ))) {
        Ok(v)                                     => Ok(Some(v)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e)                                    => Err(e.into()),
    }
}

// ── One-time prekeys ──────────────────────────────────────────────────────

pub fn save_one_time_prekeys(db: &DbConn, keys: &[DhKeyPair]) -> Result<()> {
    let c = db.lock().unwrap();
    for k in keys {
        c.execute(
            "INSERT OR IGNORE INTO one_time_prekeys (key_id, public_key, private_key)
             VALUES (?1, ?2, ?3)",
            params![k.key_id, k.public_key, k.private_key],
        )?;
    }
    Ok(())
}

pub fn get_one_time_prekey(db: &DbConn, key_id: u32) -> Result<Option<DhKeyPair>> {
    let c = db.lock().unwrap();
    let mut st = c.prepare(
        "SELECT key_id, public_key, private_key FROM one_time_prekeys
         WHERE key_id = ?1 AND used = 0"
    )?;
    match st.query_row(params![key_id], |r| Ok(DhKeyPair {
        key_id: r.get(0)?, public_key: r.get(1)?, private_key: r.get(2)?
    })) {
        Ok(v)                                     => Ok(Some(v)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e)                                    => Err(e.into()),
    }
}

pub fn mark_one_time_prekey_used(db: &DbConn, key_id: u32) -> Result<()> {
    db.lock().unwrap().execute(
        "UPDATE one_time_prekeys SET used = 1 WHERE key_id = ?1",
        params![key_id],
    )?;
    Ok(())
}

// ── Sessions ──────────────────────────────────────────────────────────────

pub fn save_session(db: &DbConn, s: &SignalSession) -> Result<()> {
    db.lock().unwrap().execute(
        "INSERT OR REPLACE INTO sessions
         (peer_id, root_key, send_chain_key, recv_chain_key,
          send_msg_num, recv_msg_num, send_ratchet_pk, send_ratchet_sk,
          recv_ratchet_pk, prev_send_chain_len)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            s.peer_id, s.root_key, s.send_chain_key, s.recv_chain_key,
            s.send_msg_num, s.recv_msg_num, s.send_ratchet_pk, s.send_ratchet_sk,
            s.recv_ratchet_pk, s.prev_send_chain_len,
        ],
    )?;
    Ok(())
}

pub fn get_session(db: &DbConn, peer_id: &str) -> Result<Option<SignalSession>> {
    let c = db.lock().unwrap();
    let mut st = c.prepare(
        "SELECT peer_id, root_key, send_chain_key, recv_chain_key,
                send_msg_num, recv_msg_num, send_ratchet_pk, send_ratchet_sk,
                recv_ratchet_pk, prev_send_chain_len
         FROM sessions WHERE peer_id = ?1"
    )?;
    match st.query_row(params![peer_id], |r| Ok(SignalSession {
        peer_id:             r.get(0)?,
        root_key:            r.get(1)?,
        send_chain_key:      r.get(2)?,
        recv_chain_key:      r.get(3)?,
        send_msg_num:        r.get(4)?,
        recv_msg_num:        r.get(5)?,
        send_ratchet_pk:     r.get(6)?,
        send_ratchet_sk:     r.get(7)?,
        recv_ratchet_pk:     r.get(8)?,
        prev_send_chain_len: r.get(9)?,
    })) {
        Ok(v)                                     => Ok(Some(v)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e)                                    => Err(e.into()),
    }
}

// ── Skipped keys ──────────────────────────────────────────────────────────

/// O'tkazib yuborilgan xabar kaliti saqlanadi.
pub fn save_skipped_key(
    db: &DbConn, peer_id: &str, ratchet_pk: &[u8], msg_num: u32, msg_key: &[u8]
) -> Result<()> {
    db.lock().unwrap().execute(
        "INSERT OR REPLACE INTO skipped_keys (peer_id, ratchet_pk, msg_num, msg_key)
         VALUES (?1, ?2, ?3, ?4)",
        params![peer_id, ratchet_pk, msg_num, msg_key],
    )?;
    Ok(())
}

/// O'tkazib yuborilgan xabar kaliti o'qiladi (mavjud bo'lsa).
pub fn get_skipped_key(
    db: &DbConn, peer_id: &str, ratchet_pk: &[u8], msg_num: u32
) -> Result<Option<Vec<u8>>> {
    let c = db.lock().unwrap();
    let mut st = c.prepare(
        "SELECT msg_key FROM skipped_keys WHERE peer_id=?1 AND ratchet_pk=?2 AND msg_num=?3"
    )?;
    match st.query_row(params![peer_id, ratchet_pk, msg_num], |r| r.get(0)) {
        Ok(v)                                     => Ok(Some(v)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e)                                    => Err(e.into()),
    }
}

/// Ishlatilgan kalit o'chiriladi (takroriy foydalanishning oldini olish uchun).
pub fn remove_skipped_key(
    db: &DbConn, peer_id: &str, ratchet_pk: &[u8], msg_num: u32
) -> Result<()> {
    db.lock().unwrap().execute(
        "DELETE FROM skipped_keys WHERE peer_id=?1 AND ratchet_pk=?2 AND msg_num=?3",
        params![peer_id, ratchet_pk, msg_num],
    )?;
    Ok(())
}
