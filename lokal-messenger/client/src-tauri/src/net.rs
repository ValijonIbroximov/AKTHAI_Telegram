// Fayl: client/src-tauri/src/net.rs
// Maqsad: Server bilan REST aloqasi olib boriladi (login, kalit-bundle yuklash va so'rash).
//         WebSocket aloqasi esa frontend (JS) tomonida boshqariladi — bu kuchsiz
//         mashinada ortiqcha ikkinchi ulanishni oldini oladi.

use std::sync::{Arc, Mutex};

use crate::crypto::{UploadBundle, UploadPreKey};

// ApiClient — HTTP mijozi, server manzili va joriy sessiya tokenini saqlaydi.
// Token Arc<Mutex<...>> ichida bo'lgani uchun klon nusxalar bir xil sessiyani baham ko'radi.
#[derive(Clone)]
pub struct ApiClient {
    http: reqwest::Client,
    base_url: String,
    token: Arc<Mutex<Option<String>>>,
}

impl ApiClient {
    // new — standart HTTP mijozi bilan ApiClient yaratiladi.
    // Eslatma: yopiq tarmoqda o'z-o'zini imzolagan ichki CA ishonchli ro'yxatga
    //          qo'shilishi kerak. with_ca_pem orqali sertifikatni biriktirish mumkin.
    pub fn new(base_url: &str) -> Self {
        let http = reqwest::Client::builder()
            .use_rustls_tls()
            .build()
            .expect("HTTP mijozi yaratilmadi");
        Self {
            http,
            base_url: base_url.trim_end_matches('/').to_string(),
            token: Arc::new(Mutex::new(None)),
        }
    }

    // with_ca_pem — ichki CA sertifikati (PEM) HTTP mijoziga biriktiriladi.
    pub fn with_ca_pem(base_url: &str, ca_pem: &[u8]) -> Result<Self, reqwest::Error> {
        let cert = reqwest::Certificate::from_pem(ca_pem)?;
        let http = reqwest::Client::builder()
            .use_rustls_tls()
            .add_root_certificate(cert)
            .build()?;
        Ok(Self {
            http,
            base_url: base_url.trim_end_matches('/').to_string(),
            token: Arc::new(Mutex::new(None)),
        })
    }

    // token_value — joriy token nusxasi qaytariladi.
    fn token_value(&self) -> Option<String> {
        self.token.lock().unwrap().clone()
    }

    // set_token — sessiya tokeni saqlanadi.
    fn set_token(&self, value: Option<String>) {
        *self.token.lock().unwrap() = value;
    }

    // current_token — frontend WebSocket ulanishida foydalanish uchun token qaytariladi.
    pub fn current_token(&self) -> Option<String> {
        self.token_value()
    }

    // login — foydalanuvchi tekshiriladi va muvaffaqiyatli bo'lsa token saqlanadi.
    pub async fn login(&self, username: &str, password: &str) -> Result<serde_json::Value, String> {
        let url = format!("{}/api/v1/auth/login", self.base_url);
        let resp = self
            .http
            .post(&url)
            .json(&serde_json::json!({ "username": username, "password": password }))
            .send()
            .await
            .map_err(|e| format!("tarmoq xatosi: {e}"))?;

        if !resp.status().is_success() {
            return Err(format!("kirish rad etildi: {}", resp.status()));
        }

        let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
        if let Some(tok) = body.get("token").and_then(|v| v.as_str()) {
            self.set_token(Some(tok.to_string()));
        }
        Ok(body)
    }

    // logout — sessiya serverda bekor qilinadi va mahalliy token tozalanadi.
    pub async fn logout(&self) -> Result<(), String> {
        let url = format!("{}/api/v1/auth/logout", self.base_url);
        if let Some(tok) = self.token_value() {
            let _ = self.http.post(&url).bearer_auth(tok).send().await;
        }
        self.set_token(None);
        Ok(())
    }

    // upload_bundle — mijozning OCHIQ kalit-bundle'i serverga yuklanadi.
    pub async fn upload_bundle(&self, bundle: &UploadBundle) -> Result<(), String> {
        let url = format!("{}/api/v1/keys/upload", self.base_url);
        let token = self.token_value().ok_or("token yo'q")?;
        let resp = self
            .http
            .post(&url)
            .bearer_auth(token)
            .json(bundle)
            .send()
            .await
            .map_err(|e| format!("tarmoq xatosi: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("bundle yuklanmadi: {}", resp.status()));
        }
        Ok(())
    }

    // refill_otpks — tugayotgan bir martalik kalitlar zaxirasi serverda to'ldiriladi.
    pub async fn refill_otpks(&self, prekeys: &[UploadPreKey]) -> Result<(), String> {
        let url = format!("{}/api/v1/keys/refill-otpks", self.base_url);
        let token = self.token_value().ok_or("token yo'q")?;
        let resp = self
            .http
            .post(&url)
            .bearer_auth(token)
            .json(&serde_json::json!({ "one_time_prekeys": prekeys }))
            .send()
            .await
            .map_err(|e| format!("tarmoq xatosi: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("kalitlar to'ldirilmadi: {}", resp.status()));
        }
        Ok(())
    }

    // fetch_bundle — sherikning ochiq kalit-bundle'i serverdan so'raladi.
    pub async fn fetch_bundle(&self, user_id: &str) -> Result<serde_json::Value, String> {
        let url = format!("{}/api/v1/keys/{}/bundle", self.base_url, user_id);
        let token = self.token_value().ok_or("token yo'q")?;
        let resp = self
            .http
            .get(&url)
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| format!("tarmoq xatosi: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("bundle topilmadi: {}", resp.status()));
        }
        resp.json().await.map_err(|e| e.to_string())
    }
}
