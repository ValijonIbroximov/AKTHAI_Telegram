// Guruh taklifi orqali qo'shilish.
import { useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { chatApi } from "@/api/http";
import { useChatStore } from "@/store/chatStore";
import { useRegisterBackHandler, BACK_PRIORITY } from "@/contexts/BackNavigationContext";
import s from "./GroupSettingsModal.module.css";

interface Props {
  open:    boolean;
  onClose: () => void;
  token:   string;
}

interface Preview {
  chat_id:        string;
  title:          string;
  member_count:   number;
  already_member: boolean;
}

export default function JoinGroupModal({ open, onClose, token }: Props) {
  const selectChat = useChatStore((st) => st.selectChat);
  const [tokenInput, setTokenInput] = useState("");
  const [preview, setPreview]       = useState<Preview | null>(null);
  const [busy, setBusy]             = useState(false);
  const [error, setError]           = useState("");

  const reset = useCallback(() => {
    setTokenInput("");
    setPreview(null);
    setError("");
  }, []);

  useRegisterBackHandler(
    useCallback(() => {
      if (!open || busy) return false;
      onClose();
      return true;
    }, [open, busy, onClose]),
    open,
    BACK_PRIORITY.modal,
  );

  const handlePreview = async () => {
    const tok = tokenInput.trim();
    if (!tok) {
      setError("Taklif tokenini kiriting");
      return;
    }
    setBusy(true);
    setError("");
    setPreview(null);
    try {
      const p = await chatApi.previewGroupInvite(token, tok);
      setPreview(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Havola topilmadi yoki muddati tugagan");
    } finally {
      setBusy(false);
    }
  };

  const handleJoin = async () => {
    const tok = tokenInput.trim();
    if (!tok) return;
    setBusy(true);
    setError("");
    try {
      const res = await chatApi.joinGroupInvite(token, tok);
      reset();
      onClose();
      await selectChat(res.chat_id, token);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return createPortal(
    <div className={s.overlay} onClick={busy ? undefined : () => { reset(); onClose(); }} role="presentation">
      <div
        className={s.panel}
        style={{ maxWidth: 440 }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Guruh taklifi"
      >
        <div className={s.profileHeader}>
          <button type="button" className={s.closeBtn} onClick={() => { reset(); onClose(); }} disabled={busy}>×</button>
          <h2 className={s.groupTitle} style={{ margin: 0 }}>Guruh taklifi</h2>
          <p className={s.hint} style={{ marginTop: 8, marginBottom: 0 }}>
            Sizga yuborilgan taklif tokenini kiriting.
          </p>
        </div>

        <div className={s.body}>
          <div className={s.field} style={{ marginBottom: 12 }}>
            <label className={s.fieldLabel} htmlFor="join-token">Taklif tokeni</label>
            <input
              id="join-token"
              className={s.searchInput}
              style={{ paddingLeft: 12 }}
              value={tokenInput}
              onChange={(e) => { setTokenInput(e.target.value); setPreview(null); setError(""); }}
              placeholder="Masalan: a1b2c3d4e5f6…"
              disabled={busy}
              autoComplete="off"
            />
          </div>

          <button
            type="button"
            className={s.primaryBtn}
            style={{ width: "100%", marginBottom: 14 }}
            disabled={busy || !tokenInput.trim()}
            onClick={() => void handlePreview()}
          >
            {busy && !preview ? "Tekshirilmoqda…" : "Guruhni ko'rish"}
          </button>

          {preview && (
            <div className={s.card}>
              <div className={s.cardRow}>
                <span className={s.cardLabel}>Guruh</span>
                <span className={s.cardValue}>{preview.title}</span>
              </div>
              <div className={s.cardRow}>
                <span className={s.cardLabel}>A'zolar</span>
                <span className={s.cardValue}>{preview.member_count}</span>
              </div>
              {preview.already_member ? (
                <p className={s.hint} style={{ marginTop: 12, marginBottom: 0 }}>
                  Siz allaqachon bu guruh a'zosisiz.
                </p>
              ) : (
                <button
                  type="button"
                  className={s.primaryBtn}
                  style={{ width: "100%", marginTop: 12 }}
                  disabled={busy}
                  onClick={() => void handleJoin()}
                >
                  {busy ? "Qo'shilmoqda…" : "Guruhga qo'shilish"}
                </button>
              )}
            </div>
          )}

          {preview?.already_member && (
            <button
              type="button"
              className={s.footerBtn}
              style={{ width: "100%", marginTop: 10 }}
              onClick={() => {
                void selectChat(preview.chat_id, token);
                reset();
                onClose();
              }}
            >
              Guruhga o'tish
            </button>
          )}

          {error && <div className={s.error}>{error}</div>}
        </div>

        <div className={s.footer}>
          <button type="button" className={s.footerBtn} onClick={() => { reset(); onClose(); }} disabled={busy}>
            Yopish
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
