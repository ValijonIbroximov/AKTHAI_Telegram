// Fayl: client/src-tauri/src/main.rs
// Maqsad: Frontend (React) chaqirishi uchun ochiq Tauri command'lari ro'yxatga olinadi.
//         Rust tomoni faqat kriptografiya va REST bilan shug'ullanadi; WebSocket
//         aloqasi frontendda boshqariladi.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod crypto;
mod net;
mod session;
mod store;

use std::path::PathBuf;
use std::sync::Mutex;

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use tauri::{Manager, State};

use crate::session::DEFAULT_DEVICE_ID;
use crate::store::LocalSignalStore;

// Server manzili — yopiq tarmoqdagi ichki nom orqali ulanadi.
const SERVER_BASE_URL: &str = "https://server.lokal:8443";

// AppState — mijozning umumiy holati: kriptografik saqlov, tarmoq mijozi va saqlov fayli yo'li.
struct AppState {
    store: Mutex<Option<LocalSignalStore>>,
    api: net::ApiClient,
    store_path: PathBuf,
}

impl AppState {
    // ensure_store — kriptografik saqlov ochiq ekanligini ta'minlaydi (kerak bo'lsa ochiladi).
    fn ensure_store(&self) -> Result<(), String> {
        let mut guard = self.store.lock().unwrap();
        if guard.is_none() {
            let opened = LocalSignalStore::open(&self.store_path)
                .map_err(|e| format!("saqlov ochilmadi: {e}"))?;
            *guard = Some(opened);
        }
        Ok(())
    }
}

// block_on — libsignal'ning mahalliy (Send bo'lmagan) asinxron chaqiruvini joriy
// ip'da bloklab bajaradi. Bu chaqiruvlar tarmoqqa chiqmaydi, shuning uchun xavfsiz.
fn block_on<F: std::future::Future>(fut: F) -> F::Output {
    futures::executor::block_on(fut)
}

// login — server orqali foydalanuvchi tekshiriladi va sessiya ochiladi.
#[tauri::command]
async fn login(
    state: State<'_, AppState>,
    username: String,
    password: String,
) -> Result<serde_json::Value, String> {
    let api = state.api.clone();
    let res = api.login(&username, &password).await?;
    // Kirishdan so'ng mahalliy kriptografik saqlov tayyorlanadi
    state.ensure_store()?;
    Ok(res)
}

// bootstrap_keys — birinchi kirishda kalit-bundle yaratiladi va serverga yuklanadi.
#[tauri::command]
async fn bootstrap_keys(state: State<'_, AppState>) -> Result<(), String> {
    state.ensure_store()?;

    // Kalitlar mahalliy yaratiladi (qulf faqat sinxron jarayon davomida ushlanadi)
    let bundle = {
        let mut guard = state.store.lock().unwrap();
        let store_ref = guard.as_mut().ok_or("saqlov yopiq")?;
        block_on(crypto::bootstrap_identity(store_ref)).map_err(|e| e.to_string())?
    };

    // Ochiq bundle serverga yuklanadi (tarmoq chaqiruvi qulfdan tashqarida)
    let api = state.api.clone();
    api.upload_bundle(&bundle).await?;
    Ok(())
}

// send_message — ochiq matn shifrlanadi. Shifrlangan baytlar frontendga qaytariladi;
// frontend ularni o'z WebSocket ulanishi orqali serverga yuboradi.
#[tauri::command]
async fn send_message(
    state: State<'_, AppState>,
    recipient_id: String,
    plaintext: String,
) -> Result<serde_json::Value, String> {
    state.ensure_store()?;

    // Sessiya mavjudligi tekshiriladi
    let need_session = {
        let guard = state.store.lock().unwrap();
        let store_ref = guard.as_ref().ok_or("saqlov yopiq")?;
        !store_ref.has_session(&recipient_id, DEFAULT_DEVICE_ID)
    };

    // Sessiya bo'lmasa, sherikning bundle'i olinib X3DH orqali o'rnatiladi
    if need_session {
        let api = state.api.clone();
        let raw = api.fetch_bundle(&recipient_id).await?;
        let mut guard = state.store.lock().unwrap();
        let store_ref = guard.as_mut().ok_or("saqlov yopiq")?;
        let bundle = session::decode_bundle(&raw).map_err(|e| e.to_string())?;
        block_on(session::establish_session(store_ref, bundle)).map_err(|e| e.to_string())?;
    }

    // Xabar shifrlanadi
    let (ciphertext, msg_type) = {
        let mut guard = state.store.lock().unwrap();
        let store_ref = guard.as_mut().ok_or("saqlov yopiq")?;
        block_on(session::encrypt_for(
            store_ref,
            &recipient_id,
            DEFAULT_DEVICE_ID,
            plaintext.as_bytes(),
        ))
        .map_err(|e| e.to_string())?
    };

    // Shifrlangan natija frontendga qaytariladi
    Ok(serde_json::json!({
        "ciphertext": B64.encode(&ciphertext),
        "msg_type": msg_type,
    }))
}

// decrypt_incoming — serverdan kelgan ciphertext mijozda ochiladi.
#[tauri::command]
async fn decrypt_incoming(
    state: State<'_, AppState>,
    sender_id: String,
    msg_type: u8,
    ciphertext_b64: String,
) -> Result<String, String> {
    state.ensure_store()?;
    let bytes = B64.decode(&ciphertext_b64).map_err(|e| e.to_string())?;

    let plaintext = {
        let mut guard = state.store.lock().unwrap();
        let store_ref = guard.as_mut().ok_or("saqlov yopiq")?;
        block_on(session::decrypt_from(
            store_ref,
            &sender_id,
            DEFAULT_DEVICE_ID,
            msg_type,
            &bytes,
        ))
        .map_err(|e| e.to_string())?
    };

    String::from_utf8(plaintext).map_err(|e| e.to_string())
}

// ws_token — frontend WebSocket ulanishida ishlatish uchun joriy sessiya tokeni qaytariladi.
#[tauri::command]
fn ws_token(state: State<'_, AppState>) -> Option<String> {
    state.api.current_token()
}

// logout — sessiya serverda bekor qilinadi va mahalliy token tozalanadi.
#[tauri::command]
async fn logout(state: State<'_, AppState>) -> Result<(), String> {
    let api = state.api.clone();
    api.logout().await
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            // Kriptografik saqlov fayli ilovaning ma'lumotlar katalogida joylashtiriladi
            let data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| PathBuf::from("."));
            std::fs::create_dir_all(&data_dir).ok();
            let store_path = data_dir.join("signal-store.sqlite");

            app.manage(AppState {
                store: Mutex::new(None),
                api: net::ApiClient::new(SERVER_BASE_URL),
                store_path,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            login,
            bootstrap_keys,
            send_message,
            decrypt_incoming,
            ws_token,
            logout
        ])
        .run(tauri::generate_context!())
        .expect("Tauri ilovasi ishga tushmadi");
}
