// Fayl: client/src-tauri/src/store.rs
// Maqsad: Identity, prekey va session yozuvlari mahalliy SQLite faylida saqlanadi.
//         Bu Signal Protocol uchun "saqlov" (store) qatlami vazifasini bajaradi.
//
// Muhim arxitektura izohi:
//   libsignal protokol funksiyalari (message_encrypt, process_prekey_bundle, ...)
//   ALOHIDA saqlov ob'ektlarini (&mut SessionStore, &mut IdentityKeyStore, ...)
//   talab qiladi. Shu sababli yagona ob'ekt o'rniga to'rtta kichik-saqlov (sub-store)
//   ishlatiladi; ularning hammasi bitta SQLite ulanishini (Rc<Connection>) baham ko'radi.
//   Bu Rust o'zlashtirish (borrow) qoidalariga mos keladi.
//
// Xavfsizlik izohi:
//   Yopiq tarmoq talablari bo'yicha bu SQLite fayli OT darajasida shifrlangan
//   joyda saqlanishi tavsiya etiladi (yoki fayl kaliti OT keyring'iga bog'lanadi).

use async_trait::async_trait;
use libsignal_protocol::{
    Direction, IdentityKey, IdentityKeyPair, IdentityKeyStore, PreKeyId, PreKeyRecord, PreKeyStore,
    ProtocolAddress, SessionRecord, SessionStore, SignalProtocolError, SignedPreKeyId,
    SignedPreKeyRecord, SignedPreKeyStore,
};
use rand::rngs::OsRng;
use rusqlite::{params, Connection};
use std::path::Path;
use std::rc::Rc;

// LocalSignalStore — barcha kichik-saqlovlarni bitta tuzilmaga jamlaydi.
pub struct LocalSignalStore {
    pub session_store: SqliteSessionStore,
    pub identity_store: SqliteIdentityStore,
    pub pre_key_store: SqlitePreKeyStore,
    pub signed_pre_key_store: SqliteSignedPreKeyStore,
}

impl LocalSignalStore {
    // open — saqlov ochiladi yoki yaratiladi. Identity mavjud bo'lmasa, yangisi generatsiya qilinadi.
    pub fn open<P: AsRef<Path>>(path: P) -> Result<Self, Box<dyn std::error::Error>> {
        let conn = Connection::open(path)?;

        // Zarur jadvallar yaratiladi
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS local_identity (
                id              INTEGER PRIMARY KEY CHECK (id = 1),
                key_pair        BLOB NOT NULL,
                registration_id INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS prekeys (
                id     INTEGER PRIMARY KEY,
                record BLOB NOT NULL
            );
            CREATE TABLE IF NOT EXISTS signed_prekeys (
                id     INTEGER PRIMARY KEY,
                record BLOB NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
                address TEXT PRIMARY KEY,
                record  BLOB NOT NULL
            );
            CREATE TABLE IF NOT EXISTS identities (
                address TEXT PRIMARY KEY,
                key     BLOB NOT NULL
            );
            "#,
        )?;

        // Mavjud identity o'qiladi yoki yangisi yaratiladi
        let existing: Option<(Vec<u8>, i64)> = conn
            .query_row(
                "SELECT key_pair, registration_id FROM local_identity WHERE id = 1",
                [],
                |r| Ok((r.get::<_, Vec<u8>>(0)?, r.get::<_, i64>(1)?)),
            )
            .ok();

        let (own_identity, registration_id) = match existing {
            Some((bytes, reg)) => {
                let kp = IdentityKeyPair::try_from(bytes.as_slice())
                    .map_err(|e| format!("identity o'qilmadi: {e}"))?;
                (kp, reg as u32)
            }
            None => {
                // Yangi doimiy identifikator va registration ID yaratiladi
                let mut rng = OsRng;
                let kp = IdentityKeyPair::generate(&mut rng);
                let reg: u32 = (rand::random::<u32>() & 0x3fff) + 1;
                conn.execute(
                    "INSERT INTO local_identity (id, key_pair, registration_id) VALUES (1, ?1, ?2)",
                    params![kp.serialize().as_ref(), reg as i64],
                )?;
                (kp, reg)
            }
        };

        // Ulanish kichik-saqlovlar o'rtasida baham ko'riladi
        let shared = Rc::new(conn);

        Ok(Self {
            session_store: SqliteSessionStore {
                conn: Rc::clone(&shared),
            },
            identity_store: SqliteIdentityStore {
                conn: Rc::clone(&shared),
                own_identity,
                registration_id,
            },
            pre_key_store: SqlitePreKeyStore {
                conn: Rc::clone(&shared),
            },
            signed_pre_key_store: SqliteSignedPreKeyStore {
                conn: Rc::clone(&shared),
            },
        })
    }

    // identity_key_pair — mijozning doimiy identifikator juftligi qaytariladi.
    pub fn identity_key_pair(&self) -> IdentityKeyPair {
        self.identity_store.own_identity
    }

    // registration_id — mijozning registration identifikatori qaytariladi.
    pub fn registration_id(&self) -> u32 {
        self.identity_store.registration_id
    }

    // has_session — berilgan sherik bilan sessiya allaqachon mavjudligi tekshiriladi.
    pub fn has_session(&self, peer_user_id: &str, device_id: u32) -> bool {
        let addr = format!("{peer_user_id}.{device_id}");
        self.session_store
            .conn
            .query_row(
                "SELECT 1 FROM sessions WHERE address = ?1",
                params![addr],
                |_| Ok(()),
            )
            .is_ok()
    }

    // persist_prekey — bir martalik kalit yozuvi saqlanadi (bootstrap va to'ldirish uchun).
    pub async fn persist_prekey(
        &mut self,
        key_id: u32,
        record: &PreKeyRecord,
    ) -> Result<(), SignalProtocolError> {
        self.pre_key_store.save_pre_key(key_id.into(), record).await
    }

    // persist_signed_prekey — imzolangan oldindan-kalit yozuvi saqlanadi.
    pub async fn persist_signed_prekey(
        &mut self,
        key_id: u32,
        record: &SignedPreKeyRecord,
    ) -> Result<(), SignalProtocolError> {
        self.signed_pre_key_store
            .save_signed_pre_key(key_id.into(), record)
            .await
    }
}

// sqlite_err — rusqlite xatosini Signal protokol xatosiga aylantiruvchi yordamchi.
fn sqlite_err(ctx: &'static str) -> impl Fn(rusqlite::Error) -> SignalProtocolError {
    move |e| SignalProtocolError::ApplicationCallbackError(ctx, Box::new(e))
}

// addr_key — protokol manzili matn kalitiga aylantiriladi.
fn addr_key(address: &ProtocolAddress) -> String {
    format!("{}.{}", address.name(), u32::from(address.device_id()))
}

// ============================================================
// IdentityKeyStore — doimiy identifikator va ishonchli kalitlar saqlovi.
// ============================================================
pub struct SqliteIdentityStore {
    conn: Rc<Connection>,
    own_identity: IdentityKeyPair,
    registration_id: u32,
}

#[async_trait(?Send)]
impl IdentityKeyStore for SqliteIdentityStore {
    async fn get_identity_key_pair(&self) -> Result<IdentityKeyPair, SignalProtocolError> {
        Ok(self.own_identity)
    }

    async fn get_local_registration_id(&self) -> Result<u32, SignalProtocolError> {
        Ok(self.registration_id)
    }

    async fn save_identity(
        &mut self,
        address: &ProtocolAddress,
        identity: &IdentityKey,
    ) -> Result<bool, SignalProtocolError> {
        let key_bytes = identity.serialize();
        let addr = addr_key(address);

        // Avvalgi kalit o'qiladi (o'zgarganligini aniqlash uchun)
        let prev: Option<Vec<u8>> = self
            .conn
            .query_row(
                "SELECT key FROM identities WHERE address = ?1",
                params![addr],
                |r| r.get(0),
            )
            .ok();

        // Kalit upsert qilinadi
        self.conn
            .execute(
                "INSERT INTO identities (address, key) VALUES (?1, ?2)
                 ON CONFLICT(address) DO UPDATE SET key = excluded.key",
                params![addr, key_bytes.as_ref()],
            )
            .map_err(sqlite_err("save_identity"))?;

        // Kalit avval mavjud bo'lib, o'zgargan bo'lsa true qaytariladi
        Ok(prev.map(|p| p != key_bytes.as_ref()).unwrap_or(false))
    }

    async fn is_trusted_identity(
        &self,
        _address: &ProtocolAddress,
        _identity: &IdentityKey,
        _direction: Direction,
    ) -> Result<bool, SignalProtocolError> {
        // TOFU (Trust On First Use) sxemasi: birinchi ko'rilgan kalit ishonchli sanaladi.
        // Foydalanuvchi keyinchalik "xavfsizlik raqami" orqali tasdiqlashi mumkin.
        Ok(true)
    }

    async fn get_identity(
        &self,
        address: &ProtocolAddress,
    ) -> Result<Option<IdentityKey>, SignalProtocolError> {
        let addr = addr_key(address);
        let row: Option<Vec<u8>> = self
            .conn
            .query_row(
                "SELECT key FROM identities WHERE address = ?1",
                params![addr],
                |r| r.get(0),
            )
            .ok();
        match row {
            Some(b) => Ok(Some(IdentityKey::decode(&b)?)),
            None => Ok(None),
        }
    }
}

// ============================================================
// PreKeyStore — bir martalik oldindan-kalitlar saqlovi.
// ============================================================
pub struct SqlitePreKeyStore {
    conn: Rc<Connection>,
}

#[async_trait(?Send)]
impl PreKeyStore for SqlitePreKeyStore {
    async fn get_pre_key(&self, prekey_id: PreKeyId) -> Result<PreKeyRecord, SignalProtocolError> {
        let id = u32::from(prekey_id) as i64;
        let row: Option<Vec<u8>> = self
            .conn
            .query_row(
                "SELECT record FROM prekeys WHERE id = ?1",
                params![id],
                |r| r.get(0),
            )
            .ok();
        match row {
            Some(b) => PreKeyRecord::deserialize(&b),
            None => Err(SignalProtocolError::InvalidPreKeyId),
        }
    }

    async fn save_pre_key(
        &mut self,
        prekey_id: PreKeyId,
        record: &PreKeyRecord,
    ) -> Result<(), SignalProtocolError> {
        let bytes = record.serialize()?;
        self.conn
            .execute(
                "INSERT OR REPLACE INTO prekeys (id, record) VALUES (?1, ?2)",
                params![u32::from(prekey_id) as i64, bytes],
            )
            .map_err(sqlite_err("save_pre_key"))?;
        Ok(())
    }

    async fn remove_pre_key(&mut self, prekey_id: PreKeyId) -> Result<(), SignalProtocolError> {
        // Ishlatilgan bir martalik kalit o'chiriladi (qayta foydalanishning oldini olish uchun)
        self.conn
            .execute(
                "DELETE FROM prekeys WHERE id = ?1",
                params![u32::from(prekey_id) as i64],
            )
            .map_err(sqlite_err("remove_pre_key"))?;
        Ok(())
    }
}

// ============================================================
// SignedPreKeyStore — imzolangan oldindan-kalitlar saqlovi.
// ============================================================
pub struct SqliteSignedPreKeyStore {
    conn: Rc<Connection>,
}

#[async_trait(?Send)]
impl SignedPreKeyStore for SqliteSignedPreKeyStore {
    async fn get_signed_pre_key(
        &self,
        id: SignedPreKeyId,
    ) -> Result<SignedPreKeyRecord, SignalProtocolError> {
        let key_id = u32::from(id) as i64;
        let row: Option<Vec<u8>> = self
            .conn
            .query_row(
                "SELECT record FROM signed_prekeys WHERE id = ?1",
                params![key_id],
                |r| r.get(0),
            )
            .ok();
        match row {
            Some(b) => SignedPreKeyRecord::deserialize(&b),
            None => Err(SignalProtocolError::InvalidSignedPreKeyId),
        }
    }

    async fn save_signed_pre_key(
        &mut self,
        id: SignedPreKeyId,
        record: &SignedPreKeyRecord,
    ) -> Result<(), SignalProtocolError> {
        let bytes = record.serialize()?;
        self.conn
            .execute(
                "INSERT OR REPLACE INTO signed_prekeys (id, record) VALUES (?1, ?2)",
                params![u32::from(id) as i64, bytes],
            )
            .map_err(sqlite_err("save_signed_pre_key"))?;
        Ok(())
    }
}

// ============================================================
// SessionStore — Double Ratchet sessiya holatlari saqlovi.
// ============================================================
pub struct SqliteSessionStore {
    conn: Rc<Connection>,
}

#[async_trait(?Send)]
impl SessionStore for SqliteSessionStore {
    async fn load_session(
        &self,
        address: &ProtocolAddress,
    ) -> Result<Option<SessionRecord>, SignalProtocolError> {
        let addr = addr_key(address);
        let row: Option<Vec<u8>> = self
            .conn
            .query_row(
                "SELECT record FROM sessions WHERE address = ?1",
                params![addr],
                |r| r.get(0),
            )
            .ok();
        match row {
            Some(b) => Ok(Some(SessionRecord::deserialize(&b)?)),
            None => Ok(None),
        }
    }

    async fn store_session(
        &mut self,
        address: &ProtocolAddress,
        record: &SessionRecord,
    ) -> Result<(), SignalProtocolError> {
        let addr = addr_key(address);
        let bytes = record.serialize()?;
        self.conn
            .execute(
                "INSERT INTO sessions (address, record) VALUES (?1, ?2)
                 ON CONFLICT(address) DO UPDATE SET record = excluded.record",
                params![addr, bytes],
            )
            .map_err(sqlite_err("store_session"))?;
        Ok(())
    }
}
