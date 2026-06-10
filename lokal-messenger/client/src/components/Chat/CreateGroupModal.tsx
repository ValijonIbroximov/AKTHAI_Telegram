// Yangi guruh yaratish modali — nom va boshlang'ich a'zolar.
import { useState, useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { User } from "@/types";
import { userApi } from "@/api/http";
import { useAuthStore } from "@/store/authStore";
import { useRegisterBackHandler, BACK_PRIORITY } from "@/contexts/BackNavigationContext";
import s from "./CreateChannelModal.module.css";

interface Props {
  open:     boolean;
  onClose:  () => void;
  onCreate: (title: string, memberIds: string[]) => Promise<void>;
  token:    string;
}

export default function CreateGroupModal({ open, onClose, onCreate, token }: Props) {
  const userId = useAuthStore((st) => st.userId);
  const [title, setTitle]       = useState("");
  const [query, setQuery]       = useState("");
  const [results, setResults]   = useState<User[]>([]);
  const [selected, setSelected]   = useState<User[]>([]);
  const [busy, setBusy]           = useState(false);
  const [error, setError]         = useState("");
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTitle("");
      setQuery("");
      setResults([]);
      setSelected([]);
      setError("");
      setTimeout(() => titleRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    if (!open || query.trim().length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    void userApi.search(token, query.trim()).then((list) => {
      if (!cancelled) {
        setResults((list ?? []).filter((u) => u.id !== userId));
      }
    });
    return () => { cancelled = true; };
  }, [open, query, token, userId]);

  useRegisterBackHandler(
    useCallback(() => {
      if (!open || busy) return false;
      onClose();
      return true;
    }, [open, busy, onClose]),
    open,
    BACK_PRIORITY.modal,
  );

  const toggleUser = (u: User) => {
    setSelected((prev) =>
      prev.some((x) => x.id === u.id)
        ? prev.filter((x) => x.id !== u.id)
        : [...prev, u],
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    if (!t) {
      setError("Guruh nomi kiritilishi shart");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onCreate(t, selected.map((u) => u.id));
      onClose();
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return createPortal(
    <div className={s.overlay} onClick={busy ? undefined : onClose} role="presentation">
      <div
        className={s.modal}
        style={{ maxWidth: 480 }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Yangi guruh"
      >
        <div className={s.header}>
          <h2 className={s.title}>Yangi guruh</h2>
          <button type="button" className={s.closeBtn} onClick={onClose} disabled={busy} aria-label="Yopish">×</button>
        </div>

        <form className={s.form} onSubmit={(e) => void handleSubmit(e)}>
          <div className={s.field}>
            <label className={s.label} htmlFor="group-title">Guruh nomi *</label>
            <input
              ref={titleRef}
              id="group-title"
              className={s.input}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Masalan: Operativ guruh"
              maxLength={128}
              disabled={busy}
              autoComplete="off"
            />
          </div>

          <div className={s.field}>
            <label className={s.label} htmlFor="group-search">A'zolar qo'shish</label>
            <input
              id="group-search"
              className={s.input}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ism yoki login bo'yicha qidirish…"
              disabled={busy}
              autoComplete="off"
            />
          </div>

          {selected.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {selected.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => toggleUser(u)}
                  style={{
                    padding: "4px 10px",
                    borderRadius: 999,
                    border: "1px solid var(--border)",
                    background: "var(--bg-hover)",
                    fontSize: 13,
                  }}
                >
                  {u.display_name} ×
                </button>
              ))}
            </div>
          )}

          {results.length > 0 && (
            <div style={{ maxHeight: 160, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
              {results.map((u) => {
                const on = selected.some((x) => x.id === u.id);
                return (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => toggleUser(u)}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      padding: "8px 12px",
                      background: on ? "var(--bg-hover)" : "transparent",
                      fontSize: 14,
                    }}
                  >
                    {u.display_name}
                    <span style={{ color: "var(--text-3)", marginLeft: 8 }}>@{u.username}</span>
                  </button>
                );
              })}
            </div>
          )}

          <p className={s.hint}>
            Barcha a'zolar umumiy shifrlangan suhbatda xabar almashadi. Keyin sozlamalardan yangi a'zolar va adminlar qo'shishingiz mumkin.
          </p>

          {error && <div className={s.error}>{error}</div>}

          <div className={s.actions}>
            <button type="button" className={s.cancelBtn} onClick={onClose} disabled={busy}>Bekor qilish</button>
            <button type="submit" className={s.submitBtn} disabled={busy}>
              {busy ? "Yaratilmoqda…" : "Guruh yaratish"}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
