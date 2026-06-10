// Guruh sozlamalari — umumiy, a'zolar (to'liq panel), xavfsizlik.
import { useState, useCallback, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import type { GroupMember, GroupMemberRole } from "@/types";
import { chatApi } from "@/api/http";
import { useAuthStore } from "@/store/authStore";
import { buildGroupKeyEnvelopes } from "@/crypto/groupKeyShare";
import { getChannelKey, exportChatKeyB64 } from "@/crypto/channelCrypto";
import { useRegisterBackHandler, BACK_PRIORITY } from "@/contexts/BackNavigationContext";
import GroupMembersPanel, { type ConfirmRequest } from "./GroupMembersPanel";
import { gradientCssFor } from "@/utils/avatarGradient";
import s from "./GroupSettingsModal.module.css";

type TabId = "info" | "members" | "security";
type MembersView = "list" | "add" | "invite";

interface Props {
  open:              boolean;
  onClose:           () => void;
  chatId:            string;
  title:             string;
  token:             string;
  memberCount?:      number | null;
  initialMembersView?: MembersView;
  onMembersChanged?: () => void;
}

interface ConfirmState extends ConfirmRequest {}

function roleLabel(role: GroupMemberRole): string {
  if (role === "owner") return "Yaratuvchi";
  if (role === "admin") return "Administrator";
  return "A'zo";
}

function roleBadgeClass(role: GroupMemberRole): string {
  if (role === "owner") return s.roleOwner;
  if (role === "admin") return s.roleAdmin;
  return s.roleMember;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("uz-UZ", {
    day: "2-digit", month: "long", year: "numeric",
  });
}

function ConfirmDialog({
  state, busy, onCancel,
}: {
  state: ConfirmState;
  busy: boolean;
  onCancel: () => void;
}) {
  return createPortal(
    <div className={s.confirmOverlay} onClick={busy ? undefined : onCancel} role="presentation">
      <div className={s.confirmBox} onClick={(e) => e.stopPropagation()} role="alertdialog" aria-modal="true">
        <h3 className={s.confirmTitle}>{state.title}</h3>
        <p className={s.confirmText}>{state.message}</p>
        <div className={s.confirmActions}>
          <button type="button" className={s.confirmCancel} onClick={onCancel} disabled={busy}>Bekor qilish</button>
          <button type="button" className={s.confirmDanger} disabled={busy} onClick={() => void state.onConfirm()}>
            {busy ? "Kutilmoqda…" : "Tasdiqlash"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default function GroupSettingsModal({
  open, onClose, chatId, title, token, memberCount, initialMembersView = "list", onMembersChanged,
}: Props) {
  const userId = useAuthStore((st) => st.userId);

  const [tab, setTab]         = useState<TabId>("members");
  const [membersView, setMembersView] = useState<MembersView>(initialMembersView);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [myRole, setMyRole]   = useState<GroupMemberRole>("member");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState("");
  const [success, setSuccess] = useState("");
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const canManage = myRole === "owner" || myRole === "admin";
  const isOwner   = myRole === "owner";
  const myMember  = members.find((m) => m.user_id === userId);

  const loadMembers = useCallback(async () => {
    setLoading(true);
    try {
      const list = await chatApi.listGroupMembers(token, chatId);
      setMembers(list ?? []);
      const me = (list ?? []).find((m) => m.user_id === userId);
      setMyRole(me?.role ?? "member");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [token, chatId, userId]);

  useEffect(() => {
    if (!open) return;
    setTab("members");
    setMembersView(initialMembersView);
    setError("");
    setSuccess("");
    setConfirm(null);
    void loadMembers();
  }, [open, initialMembersView, loadMembers]);

  useRegisterBackHandler(
    useCallback(() => {
      if (!open || busy) return false;
      if (confirm) { setConfirm(null); return true; }
      onClose();
      return true;
    }, [open, busy, confirm, onClose]),
    open,
    BACK_PRIORITY.modal,
  );

  const handleConfirm = (req: ConfirmRequest) => {
    setConfirm({
      ...req,
      onConfirm: async () => {
        setBusy(true);
        try {
          await req.onConfirm();
          setConfirm(null);
        } finally {
          setBusy(false);
        }
      },
    });
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setSuccess("Buferga nusxalandi");
    } catch {
      setError("Nusxalash amalga oshmadi");
    }
  };

  const handleReshareKeys = async () => {
    if (!canManage || !userId) return;
    setBusy(true);
    setError("");
    try {
      if (!getChannelKey(userId, chatId)) {
        throw new Error("Guruh kaliti bu qurilmada topilmadi");
      }
      await chatApi.putGroupKeyVault(token, chatId, exportChatKeyB64(userId, chatId)!);
      const targets = members.filter((m) => m.user_id !== userId).map((m) => m.user_id);
      const envelopes = await buildGroupKeyEnvelopes(userId, chatId, targets, token);
      if (envelopes.length === 0) throw new Error("Guruh kaliti topilmadi");
      await chatApi.putGroupKeyEnvelopes(token, chatId, envelopes);
      setSuccess(`Kalit ${envelopes.length} ta a'zoga yuborildi`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const permissions = useMemo(() => {
    const all = ["Guruhda xabar yuborish va o'qish", "Guruh a'zolarini ko'rish"];
    if (canManage) all.push("Yangi a'zolar qo'shish", "A'zolarni chiqarish", "Taklif havolalari yaratish");
    if (isOwner) all.push("Administratorlar tayinlash", "Guruh kalitini qayta ulashish");
    return all;
  }, [canManage, isOwner]);

  if (!open) return null;

  const displayCount = memberCount ?? members.length;

  return createPortal(
    <>
      <div className={s.overlay} onClick={busy ? undefined : onClose} role="presentation">
        <div className={s.panel} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Guruh sozlamalari">
          <div className={s.profileHeader}>
            <button type="button" className={s.closeBtn} onClick={onClose} disabled={busy} aria-label="Yopish">×</button>
            <div className={s.profileRow}>
              <div className={s.groupAvatar} style={{ background: gradientCssFor(title) }} aria-hidden>
                {title.charAt(0).toUpperCase()}
              </div>
              <div className={s.profileInfo}>
                <h2 className={s.groupTitle}>{title}</h2>
                <div className={s.groupMeta}>
                  <span>{displayCount} a'zo</span>
                  <span>·</span>
                  <span className={`${s.roleBadge} ${roleBadgeClass(myRole)}`}>{roleLabel(myRole)}</span>
                </div>
              </div>
            </div>
          </div>

          <nav className={s.tabs} aria-label="Guruh sozlamalari">
            {([
              ["members", `A'zolar (${members.length})`],
              ["info", "Umumiy"],
              ["security", "Xavfsizlik"],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`${s.tab} ${tab === id ? s.tabActive : ""}`}
                onClick={() => { setTab(id); setError(""); setSuccess(""); }}
              >
                {label}
              </button>
            ))}
          </nav>

          <div className={s.body}>
            {tab === "members" && (
              <GroupMembersPanel
                chatId={chatId}
                groupTitle={title}
                token={token}
                userId={userId}
                myRole={myRole}
                canManage={canManage}
                isOwner={isOwner}
                members={members}
                loading={loading}
                initialView={membersView}
                onReload={loadMembers}
                onConfirm={handleConfirm}
                onMembersChanged={() => {
                  onMembersChanged?.();
                }}
              />
            )}

            {tab === "info" && (
              <>
                <div className={s.card}>
                  <div className={s.cardRow}>
                    <span className={s.cardLabel}>Guruh nomi</span>
                    <span className={s.cardValue}>{title}</span>
                  </div>
                  <div className={s.cardRow}>
                    <span className={s.cardLabel}>A'zolar soni</span>
                    <span className={s.cardValue}>{displayCount}</span>
                  </div>
                  <div className={s.cardRow}>
                    <span className={s.cardLabel}>Sizning rolingiz</span>
                    <span className={s.cardValue}>{roleLabel(myRole)}</span>
                  </div>
                  {myMember && (
                    <div className={s.cardRow}>
                      <span className={s.cardLabel}>Qo'shilgan sana</span>
                      <span className={s.cardValue}>{fmtDate(myMember.joined_at)}</span>
                    </div>
                  )}
                  <div className={s.cardRow}>
                    <span className={s.cardLabel}>Guruh ID</span>
                    <span className={s.cardValue}>
                      <button type="button" className={s.textBtn} onClick={() => void copyText(chatId)}>
                        {chatId.slice(0, 8)}… Nusxalash
                      </button>
                    </span>
                  </div>
                </div>
                <h3 className={`${s.sectionTitle} ${s.sectionTitleSpaced}`}>Huquqlaringiz</h3>
                <ul className={s.permList}>
                  {permissions.map((p) => (
                    <li key={p} className={s.permItem}>
                      <svg className={s.permIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="20 6 9 17 4 12" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                      {p}
                    </li>
                  ))}
                </ul>
              </>
            )}

            {tab === "security" && (
              <>
                <div className={s.e2eeCard}>
                  <div className={s.e2eeIcon} aria-hidden>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>
                    </svg>
                  </div>
                  <div>
                    <h3 className={s.e2eeTitle}>Uch qavatli shifrlash</h3>
                    <p className={s.e2eeDesc}>
                      Guruh xabarlari AES-256-GCM umumiy kalit bilan shifrlanadi.
                      Kalit har bir a'zoga Signal Protocol orqali yetkaziladi.
                    </p>
                  </div>
                </div>
                {canManage && (
                  <div className={s.actionBlock}>
                    <h3 className={s.actionBlockTitle}>Kalitni barchaga ulashish</h3>
                    <p className={s.actionBlockDesc}>
                      Taklif orqali qo'shilgan a'zolar xabarlarni ocholmasa, kalitni qayta yuboring.
                      Yoki a'zolar ro'yxatida ⋮ → «Kalit ulashish» dan foydalaning.
                    </p>
                    <button type="button" className={s.primaryBtn} disabled={busy} onClick={() => void handleReshareKeys()}>
                      {busy ? "Yuborilmoqda…" : "Barcha a'zolarga kalit yuborish"}
                    </button>
                  </div>
                )}
              </>
            )}

            {tab !== "members" && error && <div className={s.error}>{error}</div>}
            {tab !== "members" && success && !error && <div className={s.successMsg}>{success}</div>}
          </div>

          <div className={s.footer}>
            <button type="button" className={s.footerBtn} onClick={onClose} disabled={busy}>Yopish</button>
          </div>
        </div>
      </div>

      {confirm && <ConfirmDialog state={confirm} busy={busy} onCancel={() => setConfirm(null)} />}
    </>,
    document.body,
  );
}
