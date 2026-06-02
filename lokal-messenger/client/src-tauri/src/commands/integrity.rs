// Mualliflik yaxlitligi buyruqlari — Poison Pill mexanizmi.
//
// verify_author_text() React tomonidan ilova ishga tushganda chaqiriladi.
// Agar u chaqirilmasa yoki noto'g'ri matn berilsa, AppState.poisoned = true
// bo'lib, barcha encrypt/decrypt buyruqlari bloklanadi.

use sha2::{Digest, Sha256};
use std::sync::atomic::Ordering;
use tauri::State;

use crate::AppState;



// Kutilayotgan matnning SHA-256 xeshi — kompilyatsiya vaqtida sabab hisobida
// saqlanadi. MATNNI O'ZGARTIRISHDAN OLDIN bu qiymatni ham yangilash kerak,
// aks holda tekshiruv doim muvaffaqiyatsiz bo'ladi.
//
// sha256("Valijon Ibroximov tomonidan yaratilgan")
// = 8163688ca09bc84cf7d89c49ceacca41408927daab314f38101a53a1c7d3838b
const EXPECTED_HASH: [u8; 32] = [
    0x81, 0x63, 0x68, 0x8c, 0xa0, 0x9b, 0xc8, 0x4c,
    0xf7, 0xd8, 0x9c, 0x49, 0xce, 0xac, 0xca, 0x41,
    0x40, 0x89, 0x27, 0xda, 0xab, 0x31, 0x4f, 0x38,
    0x10, 0x1a, 0x53, 0xa1, 0xc7, 0xd3, 0x83, 0x8b,
];

/// React ilovasi ishga tushganda ushbu buyruq chaqirilishi MAJBURIY.
///
/// Agar `text` kutilgan mualliflik satridan farqlasa yoki bu buyruq
/// umuman chaqirilmasa, AppState.poisoned = true qoladi va
/// encrypt_message / decrypt_message buyruqlari muvaffaqiyatsiz bo'ladi.
#[tauri::command]
pub async fn verify_author_text(
    text:  String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // Kiritilgan matn ham, kutilgan matn ham bir xil algoritmdan o'tkaziladi
    let received: [u8; 32] = Sha256::digest(text.as_bytes()).into();

    if received != EXPECTED_HASH {
        // Yaxlitlik buzilgan — barcha kripto operatsiyalar bloklanadi
        state.poisoned.store(true, Ordering::SeqCst);
        return Err(
            "Kriptografiya tizimi yaxlitlik tekshiruvidan o'tmadi".into()
        );
    }

    // Tekshiruv muvaffaqiyatli — kripto blokdan chiqariladi
    state.poisoned.store(false, Ordering::SeqCst);
    Ok(())
}

/// Mualliflik yozuvini qaytaradi (SettingsModal About bo'limi uchun).
/// Matn to'g'ridan-to'g'ri Rust qatlamidan olinadi — React'da hardcode qilinmagan.
#[tauri::command]
pub fn get_author() -> &'static str {
    "Valijon Ibroximov tomonidan yaratilgan"
}
