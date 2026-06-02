// Tauri ilovasi kutubxona kiritish nuqtasi.
// AppState — barcha buyruqlar orasida umumlashtirilgan holat.

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
    pub db:       DbConn,
    pub token:    Arc<Mutex<Option<String>>>,
    /// Mualliflik tekshiruvi o'tmasa true bo'ladi — barcha kripto buyruqlar bloklanadi.
    pub poisoned: Arc<AtomicBool>,
}

/// Tauri ilovasini sozlash va ishga tushirish.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_log::Builder::new().build())
        .setup(|app| {
            // Signal Protocol SQLite bazasi ilova ma'lumot papkasida saqlanadi
            let data_dir = app.path().app_data_dir()
                .expect("App data dir aniqlanmadi");
            std::fs::create_dir_all(&data_dir)?;
            let db_path = data_dir.join("signal.db");

            let db = open_db(db_path.to_str().unwrap())
                .expect("Signal bazasini ochib bo'lmadi");

            // poisoned = true: React mualliflik tekshiruvini o'tkazguncha kripto bloklanadi
            app.manage(AppState {
                db,
                token:    Arc::new(Mutex::new(None)),
                poisoned: Arc::new(AtomicBool::new(true)),
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
            // Kalit almashish
            commands::keys::establish_session,
            commands::keys::establish_session_receiver,
            commands::keys::has_session,
            // E2EE xabar
            commands::messages::encrypt_message,
            commands::messages::decrypt_message,
        ])
        .run(tauri::generate_context!())
        .expect("Tauri ilovasini ishga tushirib bo'lmadi");
}
