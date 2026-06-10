// Guruh a'zolari — to'liq boshqaruv: ko'rish, qidiruv, filter, qo'shish, taklif, admin, chiqarish.
import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import type { GroupMember, GroupMemberRole, GroupInviteLink, User } from "@/types";
import { chatApi, userApi } from "@/api/http";
import { buildGroupKeyEnvelopes } from "@/crypto/groupKeyShare";
import { getChannelKey } from "@/crypto/channelCrypto";
import UserAvatar from "@/components/Common/UserAvatar";
import s from "./GroupMembersPanel.module.css";

type ViewMode = "list" | "add" | "invite";
type RoleFilter = "all" | "admins" | "members";
type SortKey = "name" | "role" | "joined";

export interface ConfirmRequest {
  title:   string;
  message: string;
  onConfirm: () => Promise<void>;
}

interface Props {
  chatId:            string;
  groupTitle:        string;
  token:             string;
  userId:            string | null;
  myRole:            GroupMemberRole;
  canManage:         boolean;
  isOwner:           boolean;
  members:           GroupMember[];
  loading:           boolean;
  initialView?:      ViewMode;
  onReload:          () => Promise<void>;
  onConfirm:         (req: ConfirmRequest) => void;
  onMembersChanged?: () => void;
}

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
    day: "2-digit", month: "short", year: "numeric",
  });
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("uz-UZ", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

function inviteStatus(inv: GroupInviteLink): "active" | "expired" | "exhausted" {
  if (inv.expires_at && new Date(inv.expires_at) < new Date()) return "expired";
  if (inv.max_uses != null && (inv.use_count ?? 0) >= inv.max_uses) return "exhausted";
  return "active";
}

function inviteStatusLabel(st: ReturnType<typeof inviteStatus>): string {
  if (st === "expired") return "Tugagan";
  if (st === "exhausted") return "Limit";
  return "Faol";
}

function buildInviteMessage(groupTitle: string, tok: string): string {
  return [
    `📨 Guruh taklifi: ${groupTitle}`,
    ``,
    `Token: ${tok}`,
    ``,
    `Qo'shilish: ☰ menyu → Guruh taklifi → tokenni kiriting.`,
  ].join("\n");
}

function roleSortOrder(role: GroupMemberRole): number {
  if (role === "owner") return 0;
  if (role === "admin") return 1;
  return 2;
}

function sortMembers(list: GroupMember[], sortKey: SortKey): GroupMember[] {
  const copy = [...list];
  copy.sort((a, b) => {
    if (sortKey === "name") {
      return a.display_name.localeCompare(b.display_name, "uz");
    }
    if (sortKey === "role") {
      const d = roleSortOrder(a.role) - roleSortOrder(b.role);
      return d !== 0 ? d : a.display_name.localeCompare(b.display_name, "uz");
    }
    return new Date(b.joined_at).getTime() - new Date(a.joined_at).getTime();
  });
  return copy;
}

function MemberMenu({
  member,
  isSelf,
  isOwner,
  canManage,
  busy,
  onPromote,
  onDemote,
  onRemove,
  onShareKey,
}: {
  member: GroupMember;
  isSelf: boolean;
  isOwner: boolean;
  canManage: boolean;
  busy: boolean;
  onPromote: () => void;
  onDemote: () => void;
  onRemove: () => void;
  onShareKey: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const canPromote = isOwner && member.role === "member";
  const canDemote  = isOwner && member.role === "admin";
  const canRemove  =
    !isSelf &&
    member.role !== "owner" &&
    (isOwner || member.role === "member");
  const canShareKey = canManage && !isSelf && member.role !== "owner";

  const hasActions = canPromote || canDemote || canRemove || canShareKey;
  if (!hasActions) return null;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div className={s.menuWrap} ref={ref}>
      <button
        type="button"
        className={`${s.menuBtn} ${open ? s.menuBtnActive : ""}`}
        aria-label="Amallar"
        disabled={busy}
        onClick={() => setOpen((v) => !v)}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="5" r="2"/>
          <circle cx="12" cy="12" r="2"/>
          <circle cx="12" cy="19" r="2"/>
        </svg>
      </button>
      {open && (
        <div className={s.dropMenu}>
          {canPromote && (
            <button type="button" className={s.dropItem} onClick={() => { setOpen(false); onPromote(); }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2l3 7h7l-5.5 4 2 7L12 16l-6.5 4 2-7L2 9h7z" strokeLinejoin="round"/>
              </svg>
              Administrator qilish
            </button>
          )}
          {canDemote && (
            <button type="button" className={s.dropItem} onClick={() => { setOpen(false); onDemote(); }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2l3 7h7l-5.5 4 2 7L12 16l-6.5 4 2-7L2 9h7z" strokeLinejoin="round" opacity="0.4"/>
              </svg>
              Adminlikdan olish
            </button>
          )}
          {canShareKey && (
            <button type="button" className={s.dropItem} onClick={() => { setOpen(false); onShareKey(); }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2"/>
                <path d="M7 11V7a5 5 0 0110 0v4"/>
              </svg>
              Kalit ulashish
            </button>
          )}
          {canRemove && (
            <>
              <div className={s.dropDivider} />
              <button type="button" className={`${s.dropItem} ${s.dropItemDanger}`} onClick={() => { setOpen(false); onRemove(); }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round"/>
                </svg>
                Guruhdan chiqarish
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MemberRow({
  member, token, userId, isOwner, canManage, busy,
  onPromote, onDemote, onRemove, onShareKey,
}: {
  member: GroupMember;
  token: string;
  userId: string | null;
  isOwner: boolean;
  canManage: boolean;
  busy: boolean;
  onPromote: (m: GroupMember) => void;
  onDemote: (m: GroupMember) => void;
  onRemove: (m: GroupMember) => void;
  onShareKey: (m: GroupMember) => void;
}) {
  const isSelf = member.user_id === userId;
  return (
    <li className={s.memberRow}>
      <UserAvatar
        userId={member.user_id}
        name={member.display_name}
        token={token}
        hasAvatar={member.has_avatar}
        size={42}
      />
      <div className={s.memberBody}>
        <div className={s.memberName}>
          {member.display_name}
          {isSelf && " (siz)"}
        </div>
        <div className={s.memberSub}>
          <span className={`${s.roleBadge} ${roleBadgeClass(member.role)}`}>
            {roleLabel(member.role)}
          </span>
          <span>@{member.username}</span>
          <span>· {fmtDate(member.joined_at)}</span>
        </div>
      </div>
      <MemberMenu
        member={member}
        isSelf={isSelf}
        isOwner={isOwner}
        canManage={canManage}
        busy={busy}
        onPromote={() => onPromote(member)}
        onDemote={() => onDemote(member)}
        onRemove={() => onRemove(member)}
        onShareKey={() => onShareKey(member)}
      />
    </li>
  );
}

export default function GroupMembersPanel({
  chatId, groupTitle, token, userId, myRole, canManage, isOwner,
  members, loading, initialView = "list", onReload, onConfirm, onMembersChanged,
}: Props) {
  const [view, setView]               = useState<ViewMode>(initialView);
  const [search, setSearch]           = useState("");
  const [roleFilter, setRoleFilter]   = useState<RoleFilter>("all");
  const [sortKey, setSortKey]         = useState<SortKey>("role");
  const [busy, setBusy]               = useState(false);
  const [error, setError]             = useState("");
  const [success, setSuccess]         = useState("");

  const [addQuery, setAddQuery]       = useState("");
  const [addSearching, setAddSearching] = useState(false);
  const [addHits, setAddHits]         = useState<User[]>([]);

  const [invites, setInvites]         = useState<GroupInviteLink[]>([]);
  const [newInviteToken, setNewInviteToken] = useState("");
  const [inviteExpiry, setInviteExpiry] = useState("72");
  const [inviteMaxUses, setInviteMaxUses] = useState("50");

  useEffect(() => {
    setView(initialView);
    if (initialView === "list") {
      setSearch("");
      setAddQuery("");
      setError("");
    }
  }, [initialView, chatId]);

  const adminCount = members.filter((m) => m.role === "owner" || m.role === "admin").length;
  const regularCount = members.filter((m) => m.role === "member").length;

  const filtered = useMemo(() => {
    let list = members;
    if (roleFilter === "admins") {
      list = list.filter((m) => m.role === "owner" || m.role === "admin");
    } else if (roleFilter === "members") {
      list = list.filter((m) => m.role === "member");
    }
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (m) =>
          m.display_name.toLowerCase().includes(q) ||
          m.username.toLowerCase().includes(q),
      );
    }
    return sortMembers(list, sortKey);
  }, [members, roleFilter, search, sortKey]);

  const grouped = useMemo(() => {
    if (roleFilter !== "all" || sortKey !== "role") return null;
    const owners  = filtered.filter((m) => m.role === "owner");
    const admins  = filtered.filter((m) => m.role === "admin");
    const regular = filtered.filter((m) => m.role === "member");
    return { owners, admins, regular };
  }, [filtered, roleFilter, sortKey]);

  const loadInvites = useCallback(async () => {
    if (!canManage) return;
    try {
      const list = await chatApi.listGroupInvites(token, chatId);
      setInvites(list ?? []);
    } catch { /* ignore */ }
  }, [token, chatId, canManage]);

  useEffect(() => {
    if (view === "invite" && canManage) void loadInvites();
  }, [view, canManage, loadInvites]);

  useEffect(() => {
    if (view !== "add" || addQuery.trim().length < 2) {
      setAddHits([]);
      setAddSearching(false);
      return;
    }
    setAddSearching(true);
    let cancelled = false;
    const t = window.setTimeout(() => {
      void userApi.search(token, addQuery.trim()).then((list) => {
        if (cancelled) return;
        const memberIds = new Set(members.map((m) => m.user_id));
        setAddHits((list ?? []).filter((u) => u.id !== userId && !memberIds.has(u.id)));
        setAddSearching(false);
      }).catch(() => {
        if (!cancelled) setAddSearching(false);
      });
    }, 300);
    return () => { cancelled = true; window.clearTimeout(t); };
  }, [view, addQuery, token, userId, members]);

  const notify = () => onMembersChanged?.();

  const handleAdd = async (u: User) => {
    setBusy(true);
    setError("");
    try {
      if (!userId || !getChannelKey(userId, chatId)) {
        throw new Error("Guruh kaliti bu qurilmada topilmadi");
      }
      const envelopes = await buildGroupKeyEnvelopes(userId, chatId, [u.id], token);
      await chatApi.addGroupMember(token, chatId, u.id, envelopes);
      setSuccess(`${u.display_name} guruhga qo'shildi`);
      setAddHits((prev) => prev.filter((x) => x.id !== u.id));
      await onReload();
      notify();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = (m: GroupMember) => {
    onConfirm({
      title: "A'zoni chiqarish",
      message: `${m.display_name} (@${m.username}) guruhdan chiqarilsinmi? U endi guruh xabarlarini ko'ra olmaydi va qayta qo'shilishi kerak bo'ladi.`,
      onConfirm: async () => {
        setBusy(true);
        try {
          await chatApi.removeGroupMember(token, chatId, m.user_id);
          setSuccess(`${m.display_name} guruhdan chiqarildi`);
          await onReload();
          notify();
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        } finally {
          setBusy(false);
        }
      },
    });
  };

  const handlePromote = (m: GroupMember) => {
    onConfirm({
      title: "Administrator tayinlash",
      message: `${m.display_name} (@${m.username}) guruh administratori qilinsinmi? U yangi a'zolar qo'shishi, chiqarishi va taklif havolalari yaratishi mumkin bo'ladi.`,
      onConfirm: async () => {
        setBusy(true);
        try {
          await chatApi.updateGroupMemberRole(token, chatId, m.user_id, "admin");
          setSuccess(`${m.display_name} administrator qilindi`);
          await onReload();
          notify();
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        } finally {
          setBusy(false);
        }
      },
    });
  };

  const handleDemote = (m: GroupMember) => {
    onConfirm({
      title: "Adminlikdan olish",
      message: `${m.display_name} oddiy a'zo darajasiga tushirilsinmi? U endi a'zolarni boshqara olmaydi.`,
      onConfirm: async () => {
        setBusy(true);
        try {
          await chatApi.updateGroupMemberRole(token, chatId, m.user_id, "member");
          setSuccess(`${m.display_name} oddiy a'zo qilindi`);
          await onReload();
          notify();
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        } finally {
          setBusy(false);
        }
      },
    });
  };

  const handleShareKey = async (m: GroupMember) => {
    if (!userId) return;
    setBusy(true);
    setError("");
    try {
      if (!getChannelKey(userId, chatId)) {
        throw new Error("Guruh kaliti bu qurilmada topilmadi");
      }
      const envelopes = await buildGroupKeyEnvelopes(userId, chatId, [m.user_id], token);
      if (envelopes.length === 0) throw new Error("Guruh kaliti topilmadi");
      await chatApi.putGroupKeyEnvelopes(token, chatId, envelopes);
      setSuccess(`${m.display_name} ga guruh kaliti yuborildi`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleCreateInvite = async () => {
    setBusy(true);
    setError("");
    try {
      const expiresHours = inviteExpiry === "0" ? undefined : Number(inviteExpiry);
      const maxUses = inviteMaxUses === "0" ? undefined : Number(inviteMaxUses);
      const res = await chatApi.createGroupInvite(token, chatId, {
        expires_hours: expiresHours,
        max_uses: maxUses,
      });
      setNewInviteToken(res.token);
      setSuccess("Taklif havolasi yaratildi — nusxalab yuboring");
      await loadInvites();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleRevokeInvite = (inv: GroupInviteLink) => {
    onConfirm({
      title: "Havolani bekor qilish",
      message: `Bu taklif havolasi bekor qilinsinmi? (${inv.token.slice(0, 10)}…)`,
      onConfirm: async () => {
        setBusy(true);
        try {
          await chatApi.revokeGroupInvite(token, chatId, inv.token);
          if (newInviteToken === inv.token) setNewInviteToken("");
          setSuccess("Havola bekor qilindi");
          await loadInvites();
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
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

  const rowProps = {
    token, userId, isOwner, canManage, busy,
    onPromote: handlePromote,
    onDemote: handleDemote,
    onRemove: handleRemove,
    onShareKey: (m: GroupMember) => void handleShareKey(m),
  };

  const renderMemberList = (list: GroupMember[]) => (
    <ul className={s.memberList}>
      {list.map((m) => (
        <MemberRow key={m.user_id} member={m} {...rowProps} />
      ))}
    </ul>
  );

  /* ── A'zo qo'shish ── */
  if (view === "add") {
    return (
      <div className={s.root}>
        <div className={s.subHeader}>
          <button type="button" className={s.backBtn} onClick={() => { setView("list"); setAddQuery(""); setError(""); }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M19 12H5M12 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <h3 className={s.subTitle}>A'zo qo'shish</h3>
        </div>
        <p className={s.hint}>
          Tizimdagi foydalanuvchini ism yoki login bo'yicha qidiring. Qo'shilganda guruh kaliti avtomatik yuboriladi.
        </p>
        <div className={s.searchWrap}>
          <svg className={s.searchIcon} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7"/><path d="M17 17l4 4" strokeLinecap="round"/>
          </svg>
          <input
            className={s.searchInput}
            value={addQuery}
            onChange={(e) => setAddQuery(e.target.value)}
            placeholder="Kamida 2 ta belgi kiriting…"
            autoFocus
            disabled={busy}
          />
        </div>
        {addSearching && <p className={s.searching}>Qidirilmoqda…</p>}
        {!addSearching && addQuery.trim().length >= 2 && addHits.length === 0 && (
          <p className={s.emptyState}>Foydalanuvchi topilmadi yoki allaqachon a'zo</p>
        )}
        {addHits.length > 0 && (
          <div className={s.addResults}>
            {addHits.map((u) => (
              <div key={u.id} className={s.addResultItem}>
                <UserAvatar userId={u.id} name={u.display_name} size={40} />
                <div className={s.addResultBody}>
                  <div className={s.addResultName}>{u.display_name}</div>
                  <div className={s.addResultUser}>@{u.username}</div>
                </div>
                <button type="button" className={s.addBtn} disabled={busy} onClick={() => void handleAdd(u)}>
                  Qo'shish
                </button>
              </div>
            ))}
          </div>
        )}
        {error && <div className={`${s.message} ${s.messageError}`}>{error}</div>}
        {success && !error && <div className={`${s.message} ${s.messageSuccess}`}>{success}</div>}
      </div>
    );
  }

  /* ── Taklif havolasi ── */
  if (view === "invite") {
    return (
      <div className={s.root}>
        <div className={s.subHeader}>
          <button type="button" className={s.backBtn} onClick={() => { setView("list"); setError(""); }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M19 12H5M12 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <h3 className={s.subTitle}>Taklif havolasi</h3>
        </div>
        <p className={s.hint}>
          Havola yaratib yangi foydalanuvchilarga yuboring. Ular ☰ menyu → Guruh taklifi orqali qo'shiladi.
          Qo'shilgandan keyin «Kalit ulashish» orqali shifrlash kalitini yuboring.
        </p>

        <div className={s.inviteForm}>
          <div>
            <label className={s.fieldLabel} htmlFor="gmp-expiry">Amal qilish muddati</label>
            <select id="gmp-expiry" className={s.select} value={inviteExpiry} onChange={(e) => setInviteExpiry(e.target.value)} disabled={busy}>
              <option value="24">24 soat</option>
              <option value="72">3 kun</option>
              <option value="168">7 kun</option>
              <option value="720">30 kun</option>
              <option value="0">Cheksiz</option>
            </select>
          </div>
          <div>
            <label className={s.fieldLabel} htmlFor="gmp-max">Foydalanish limiti</label>
            <select id="gmp-max" className={s.select} value={inviteMaxUses} onChange={(e) => setInviteMaxUses(e.target.value)} disabled={busy}>
              <option value="5">5 marta</option>
              <option value="10">10 marta</option>
              <option value="50">50 marta</option>
              <option value="100">100 marta</option>
              <option value="0">Cheksiz</option>
            </select>
          </div>
          <button type="button" className={s.createInviteBtn} disabled={busy} onClick={() => void handleCreateInvite()}>
            {busy ? "Yaratilmoqda…" : "Yangi havola yaratish"}
          </button>
        </div>

        {newInviteToken && (
          <div className={s.newInviteBox}>
            <div className={s.newInviteLabel}>Yangi taklif</div>
            <div className={s.inviteToken}>{newInviteToken}</div>
            <div className={s.inviteActions} style={{ marginTop: 10 }}>
              <button type="button" className={s.textBtn} onClick={() => void copyText(newInviteToken)}>Token</button>
              <button type="button" className={`${s.textBtn} ${s.textBtnPrimary}`} onClick={() => void copyText(buildInviteMessage(groupTitle, newInviteToken))}>
                To'liq xabar
              </button>
            </div>
          </div>
        )}

        <div className={s.sectionTitle}>Faol havolalar ({invites.length})</div>
        {invites.length === 0 ? (
          <p className={s.emptyState}>Havolalar yo'q</p>
        ) : (
          <div className={s.inviteList}>
            {invites.map((inv) => {
              const st = inviteStatus(inv);
              return (
                <div key={inv.token} className={s.inviteCard}>
                  <div className={s.inviteCardHead}>
                    <span className={s.inviteToken}>{inv.token}</span>
                    <span className={st === "active" ? s.statusActive : s.statusExpired}>
                      {inviteStatusLabel(st)}
                    </span>
                  </div>
                  <div className={s.inviteMeta}>
                    <span>Yaratilgan: {fmtDateTime(inv.created_at)}</span>
                    {inv.expires_at && <span>Tugash: {fmtDateTime(inv.expires_at)}</span>}
                    <span>Foydalanish: {inv.use_count ?? 0}{inv.max_uses != null ? ` / ${inv.max_uses}` : " / ∞"}</span>
                  </div>
                  <div className={s.inviteActions}>
                    <button type="button" className={s.textBtn} onClick={() => void copyText(inv.token)}>Token</button>
                    <button type="button" className={`${s.textBtn} ${s.textBtnPrimary}`} onClick={() => void copyText(buildInviteMessage(groupTitle, inv.token))}>Xabar</button>
                    <button type="button" className={`${s.textBtn} ${s.textBtnDanger}`} disabled={busy} onClick={() => handleRevokeInvite(inv)}>Bekor</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {error && <div className={`${s.message} ${s.messageError}`}>{error}</div>}
        {success && !error && <div className={`${s.message} ${s.messageSuccess}`}>{success}</div>}
      </div>
    );
  }

  /* ── Asosiy ro'yxat ── */
  return (
    <div className={s.root}>
      <div className={s.statsBar}>
        <span className={s.statChip}><strong>{members.length}</strong> jami a'zo</span>
        <span className={s.statChip}><strong>{adminCount}</strong> admin</span>
        <span className={s.statChip}><strong>{regularCount}</strong> oddiy a'zo</span>
      </div>

      {canManage && (
        <div className={s.toolbar}>
          <button type="button" className={`${s.toolbarBtn} ${s.toolbarBtnPrimary}`} disabled={busy} onClick={() => { setView("add"); setError(""); setSuccess(""); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 5v14M5 12h14" strokeLinecap="round"/>
            </svg>
            A'zo qo'shish
          </button>
          <button type="button" className={s.toolbarBtn} disabled={busy} onClick={() => { setView("invite"); setError(""); setSuccess(""); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" strokeLinecap="round"/>
              <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" strokeLinecap="round"/>
            </svg>
            Taklif havolasi
          </button>
        </div>
      )}

      <div className={s.controls}>
        <div className={s.searchWrap}>
          <svg className={s.searchIcon} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7"/><path d="M17 17l4 4" strokeLinecap="round"/>
          </svg>
          <input
            className={s.searchInput}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Ism yoki @login bo'yicha qidirish…"
          />
          {search && (
            <button type="button" className={s.searchClear} onClick={() => setSearch("")} aria-label="Tozalash">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round"/>
              </svg>
            </button>
          )}
        </div>

        <div className={s.filterRow}>
          {([
            ["all", "Barchasi"],
            ["admins", "Adminlar"],
            ["members", "A'zolar"],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`${s.filterChip} ${roleFilter === id ? s.filterChipActive : ""}`}
              onClick={() => setRoleFilter(id)}
            >
              {label}
            </button>
          ))}
          <select
            className={s.sortSelect}
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            aria-label="Saralash"
          >
            <option value="role">Rol bo'yicha</option>
            <option value="name">Ism bo'yicha</option>
            <option value="joined">Qo'shilgan sana</option>
          </select>
        </div>
      </div>

      {!loading && (
        <p className={s.resultCount}>
          {filtered.length === members.length
            ? `${members.length} ta a'zo`
            : `${filtered.length} ta natija (${members.length} tadan)`}
        </p>
      )}

      {loading ? (
        <p className={s.loading}>A'zolar yuklanmoqda…</p>
      ) : filtered.length === 0 ? (
        <p className={s.emptyState}>
          {search || roleFilter !== "all" ? "Qidiruv bo'yicha a'zo topilmadi" : "A'zolar yo'q"}
        </p>
      ) : grouped ? (
        <>
          {grouped.owners.length > 0 && (
            <div className={s.groupSection}>
              <div className={s.groupSectionTitle}>
                Yaratuvchi <span className={s.groupSectionCount}>({grouped.owners.length})</span>
              </div>
              {renderMemberList(grouped.owners)}
            </div>
          )}
          {grouped.admins.length > 0 && (
            <div className={s.groupSection}>
              <div className={s.groupSectionTitle}>
                Administratorlar <span className={s.groupSectionCount}>({grouped.admins.length})</span>
              </div>
              {renderMemberList(grouped.admins)}
            </div>
          )}
          {grouped.regular.length > 0 && (
            <div className={s.groupSection}>
              <div className={s.groupSectionTitle}>
                A'zolar <span className={s.groupSectionCount}>({grouped.regular.length})</span>
              </div>
              {renderMemberList(grouped.regular)}
            </div>
          )}
        </>
      ) : (
        renderMemberList(filtered)
      )}

      {!canManage && (
        <p className={s.hint} style={{ marginTop: 16 }}>
          Sizning rolingiz: {roleLabel(myRole)}. A'zo qo'shish va boshqarish faqat administratorlar uchun.
        </p>
      )}

      {error && <div className={`${s.message} ${s.messageError}`}>{error}</div>}
      {success && !error && <div className={`${s.message} ${s.messageSuccess}`}>{success}</div>}
    </div>
  );
}
