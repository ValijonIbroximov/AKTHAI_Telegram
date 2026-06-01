// Signal Protocol kalitlari SQLite bazasida saqlanadi.
// Har bir foydalanuvchi sessiyasi alohida yozuv sifatida yuritiladi.

use anyhow::{Context, Result};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdentityKeyPair {
    pub public_key:  Vec<u8>,   // Ed25519 ochiq kalit (Base64 kodlanadi serverga yuborishda)
    pub private_key: Vec<u8>,   // Ed25519 maxfiy kalit (faqat qurilmada saqlanadi)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DhKeyPair {
    pub key_id:      u32,
    pub public_key:  Vec<u8>,   // X25519 ochiq kalit
    pub private_key: Vec<u8>,   // X25519 maxfiy kalit
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignalSession {
    pub peer_id:         String,
    pub root_key:        Vec<u8>,   // Double Ratchet ildiz kaliti
    pub send_chain_key:  Vec<u8>,   // Yuborish zanjir kaliti
    pub recv_chain_key:  Vec<u8>,   // Qabul zanjir kaliti
    pub send_msg_num:    u32,
    pub recv_msg_num:    u32,
    pub send_ratchet_pk: Vec<u8>,   // Joriy yuborish DH kaliti
    pub recv_ratchet_pk: Option<Vec<u8>>,
}

/// SQLite baza ulanmasi — `Arc<Mutex<>>` bilan thread-safe.
pub type DbConn = Arc<Mutex<Connection>>;

/// Ma'lumotlar bazasi ochiladi va jadvallar yaratiladi (agar mavjud bo'lmasa).
pub fn open_db(path: &str) -> Result<DbConn> {
    let conn = Connection::open(path)
        .with_context(|| format!("SQLite bazasi ochilmadi: {path}"))?;

    // WAL rejimi: parallel o'qish/yozish imkonini beradi, RAM kamroq ishlatiladi
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;

    conn.execute_batch("
        CREATE TABLE IF NOT EXISTS identity (
            id           INTEGER PRIMARY KEY CHECK (id = 1),
            registration_id INTEGER NOT NULL,
            public_key   BLOB NOT NULL,
            private_key  BLOB NOT NULL
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
            peer_id          TEXT PRIMARY KEY,
            root_key         BLOB NOT NULL,
            send_chain_key   BLOB NOT NULL,
            recv_chain_key   BLOB NOT NULL,
            send_msg_num     INTEGER NOT NULL DEFAULT 0,
            recv_msg_num     INTEGER NOT NULL DEFAULT 0,
            send_ratchet_pk  BLOB NOT NULL,
            recv_ratchet_pk  BLOB
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

/// Identifikatsiya kalit juftligi o'qiladi
pub fn get_identity(db: &DbConn) -> Result<Option<(u32, IdentityKeyPair)>> {
    let conn = db.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT registration_id, public_key, private_key FROM identity WHERE id = 1"
    )?;
    let result = stmt.query_row([], |row| {
        Ok((
            row.get::<_, u32>(0)?,
            IdentityKeyPair {
                public_key:  row.get(1)?,
                private_key: row.get(2)?,
            },
        ))
    });
    match result {
        Ok(pair)                              => Ok(Some(pair)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e)                                => Err(e.into()),
    }
}

/// Yangi identifikatsiya kalit juftligi saqlanadi
pub fn save_identity(db: &DbConn, reg_id: u32, pair: &IdentityKeyPair) -> Result<()> {
    let conn = db.lock().unwrap();
    conn.execute(
        "INSERT OR REPLACE INTO identity (id, registration_id, public_key, private_key)
         VALUES (1, ?1, ?2, ?3)",
        params![reg_id, pair.public_key, pair.private_key],
    )?;
    Ok(())
}

/// Imzolangan prekey saqlanadi
pub fn save_signed_prekey(db: &DbConn, kp: &DhKeyPair, signature: &[u8]) -> Result<()> {
    let conn = db.lock().unwrap();
    conn.execute(
        "INSERT OR REPLACE INTO signed_prekeys (key_id, public_key, private_key, signature)
         VALUES (?1, ?2, ?3, ?4)",
        params![kp.key_id, kp.public_key, kp.private_key, signature],
    )?;
    Ok(())
}

/// Oxirgi imzolangan prekey o'qiladi
pub fn get_signed_prekey(db: &DbConn) -> Result<Option<(DhKeyPair, Vec<u8>)>> {
    let conn = db.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT key_id, public_key, private_key, signature FROM signed_prekeys
         ORDER BY key_id DESC LIMIT 1"
    )?;
    let result = stmt.query_row([], |row| {
        Ok((
            DhKeyPair {
                key_id:      row.get(0)?,
                public_key:  row.get(1)?,
                private_key: row.get(2)?,
            },
            row.get::<_, Vec<u8>>(3)?,
        ))
    });
    match result {
        Ok(v)                                 => Ok(Some(v)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e)                                => Err(e.into()),
    }
}

/// Bir martalik prekey to'plami saqlanadi
pub fn save_one_time_prekeys(db: &DbConn, keys: &[DhKeyPair]) -> Result<()> {
    let conn = db.lock().unwrap();
    for kp in keys {
        conn.execute(
            "INSERT OR IGNORE INTO one_time_prekeys (key_id, public_key, private_key)
             VALUES (?1, ?2, ?3)",
            params![kp.key_id, kp.public_key, kp.private_key],
        )?;
    }
    Ok(())
}

/// Bir martalik prekey ishlatilganidan keyin belgilanadi
pub fn mark_one_time_prekey_used(db: &DbConn, key_id: u32) -> Result<()> {
    let conn = db.lock().unwrap();
    conn.execute(
        "UPDATE one_time_prekeys SET used = 1 WHERE key_id = ?1",
        params![key_id],
    )?;
    Ok(())
}

/// Foydalanilmagan bir martalik prekey maxfiy kaliti olinadi (X3DH jarayonida)
pub fn get_one_time_prekey(db: &DbConn, key_id: u32) -> Result<Option<DhKeyPair>> {
    let conn = db.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT key_id, public_key, private_key FROM one_time_prekeys
         WHERE key_id = ?1 AND used = 0"
    )?;
    let result = stmt.query_row(params![key_id], |row| {
        Ok(DhKeyPair {
            key_id:      row.get(0)?,
            public_key:  row.get(1)?,
            private_key: row.get(2)?,
        })
    });
    match result {
        Ok(kp)                                => Ok(Some(kp)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e)                                => Err(e.into()),
    }
}

/// Sessiya saqlanadi yoki yangilanadi
pub fn save_session(db: &DbConn, session: &SignalSession) -> Result<()> {
    let conn = db.lock().unwrap();
    conn.execute(
        "INSERT OR REPLACE INTO sessions
         (peer_id, root_key, send_chain_key, recv_chain_key,
          send_msg_num, recv_msg_num, send_ratchet_pk, recv_ratchet_pk)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            session.peer_id,
            session.root_key,
            session.send_chain_key,
            session.recv_chain_key,
            session.send_msg_num,
            session.recv_msg_num,
            session.send_ratchet_pk,
            session.recv_ratchet_pk,
        ],
    )?;
    Ok(())
}

/// Sessiya o'qiladi
pub fn get_session(db: &DbConn, peer_id: &str) -> Result<Option<SignalSession>> {
    let conn = db.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT peer_id, root_key, send_chain_key, recv_chain_key,
                send_msg_num, recv_msg_num, send_ratchet_pk, recv_ratchet_pk
         FROM sessions WHERE peer_id = ?1"
    )?;
    let result = stmt.query_row(params![peer_id], |row| {
        Ok(SignalSession {
            peer_id:         row.get(0)?,
            root_key:        row.get(1)?,
            send_chain_key:  row.get(2)?,
            recv_chain_key:  row.get(3)?,
            send_msg_num:    row.get(4)?,
            recv_msg_num:    row.get(5)?,
            send_ratchet_pk: row.get(6)?,
            recv_ratchet_pk: row.get(7)?,
        })
    });
    match result {
        Ok(s)                                 => Ok(Some(s)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e)                                => Err(e.into()),
    }
}
