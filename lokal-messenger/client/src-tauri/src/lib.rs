// Tauri ilovasi kutubxona kiritish nuqtasi.
// AppState — barcha buyruqlar orasida umumlashtirilgan holat.

use std::path::PathBuf;
use std::sync::{
    atomic::AtomicBool,
    Arc, Mutex,
};
use tauri::Manager;

pub mod commands;
pub mod crypto;

use crypto::store::{open_db, DbConn};

/// Ilova umumiy holati — barcha Tauri buyruqlariga State<AppState> orqali beriladi.
pub struct AppState {
    /// Har bir foydalanuvchi uchun alohida signal_{user_id}.db
    pub db:             Mutex<DbConn>,
    pub data_dir:       PathBuf,
    pub token:          Arc<Mutex<Option<String>>>,
    /// Joriy faol foydalanuvchi ID — set_active_user paytida o'rnatiladi.
    /// save_local_message / load_local_messages shu bilan validatsiya qilinadi.
    pub active_user_id: Mutex<String>,
    /// Mualliflik tekshiruvi o'tmasa true bo'ladi — barcha kripto buyruqlar bloklanadi.
    pub poisoned:       Arc<AtomicBool>,
}

impl AppState {
    /// Thread-safe SQLite ulanish nusxasi (har bir buyruq uchun).
    pub fn db_conn(&self) -> DbConn {
        self.db.lock().unwrap().clone()
    }
    /// Joriy faol foydalanuvchi ID ni olish.
    pub fn get_active_user_id(&self) -> String {
        self.active_user_id.lock().unwrap().clone()
    }
}

/// Tauri ilovasini sozlash va ishga tushirish.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            // Signal Protocol SQLite bazasi ilova ma'lumot papkasida saqlanadi
            let data_dir = app.path().app_data_dir()
                .expect("App data dir aniqlanmadi");
            std::fs::create_dir_all(&data_dir)?;
            let db_path = data_dir.join("signal_default.db");

            let db = open_db(db_path.to_str().unwrap())
                .expect("Signal bazasini ochib bo'lmadi");

            // poisoned = true: React mualliflik tekshiruvini o'tkazguncha kripto bloklanadi
            app.manage(AppState {
                db:             Mutex::new(db),
                data_dir,
                token:          Arc::new(Mutex::new(None)),
                active_user_id: Mutex::new(String::new()),
                poisoned:       Arc::new(AtomicBool::new(true)),
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Mualliflik yaxlitligi (birinchi navbatda chaqirilishi shart)
            commands::integrity::verify_author_text,
            commands::integrity::get_author,
            // Autentifikatsiya
            commands::auth::store_token,
            commands::auth::clear_token,
            commands::auth::init_signal_keys,
            commands::auth::set_active_user,
            // Kalit almashish
            commands::keys::establish_session,
            commands::keys::establish_session_receiver,
            commands::keys::has_session,
            commands::keys::list_session_peers,
            commands::keys::clear_peer_session,
            commands::keys::clear_all_sessions,
            // E2EE xabar
            commands::messages::encrypt_message,
            commands::messages::decrypt_message,
            // Mahalliy ochiq matn tarixi
            commands::history::save_local_message,
            commands::history::load_local_messages,
            commands::history::migrate_local_message_id,
        ])
        .run(tauri::generate_context!())
        .expect("Tauri ilovasini ishga tushirib bo'lmadi");
}
