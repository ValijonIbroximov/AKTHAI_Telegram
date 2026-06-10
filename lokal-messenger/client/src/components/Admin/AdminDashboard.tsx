/**
 * Professional Administrator Panel
 * ──────────────────────────────────
 * Sections:
 *  1. Overview   – stats cards + recent audit
 *  2. Users      – full CRUD, search/filter, edit modal, reset password
 *  3. Chats      – all chats table
 *  4. Audit Log  – paginated, filterable
 *  5. Security   – locked accounts
 */
import {
  useState, useEffect, useCallback, useRef, type ReactNode,
} from "react";
import { useAuthStore } from "@/store/authStore";
import { adminApi, type AdminStats, type AdminChat, type AuditEntry, type AdminChatDetail, type AdminChatMessage } from "@/api/http";
import { useRegisterBackHandler, BACK_PRIORITY } from "@/contexts/BackNavigationContext";
import { gradientCssFor } from "@/utils/avatarGradient";
import type { User } from "@/types";
import type { ProfileEditPolicy, ProfileFieldKey } from "@/types";
import PasswordInput from "@/components/Common/PasswordInput";
import DeleteUserConfirmModal from "@/components/Admin/DeleteUserConfirmModal";
import bubbleS from "@/components/Chat/MessageBubble.module.css";
import s from "./AdminDashboard.module.css";

interface Props { onBack: () => void; }
type Section = "overview" | "users" | "chats" | "audit" | "security";

// ─── tiny helpers ────────────────────────────────────────────────────────────
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString("uz-UZ", { dateStyle: "short", timeStyle: "short" }); }
  catch { return iso; }
}
function fmtDateShort(iso: string | null | undefined): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString("uz-UZ", { dateStyle: "short", timeStyle: "short" }); }
  catch { return iso; }
}
function ago(iso: string | null | undefined): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "hozir";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} dq oldin`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} s oldin`;
  return `${Math.floor(diff / 86_400_000)} kun oldin`;
}

const ACTION_LABELS: Record<string, string> = {
  "admin.user.create":         "Foydalanuvchi yaratildi",
  "admin.user.update":         "Ma'lumot yangilandi",
  "admin.user.set_active":     "Holat o'zgartirildi",
  "admin.user.delete":         "Foydalanuvchi o'chirildi",
  "admin.profile_policy.update": "Profil ruxsatlari yangilandi",
  "admin.user.reset_password": "Parol tiklandi",
  "admin.chat.read":           "Suhbat ko'rildi",
  "auth.login":                "Tizimga kirish",
  "auth.logout":               "Tizimdan chiqish",
  "auth.failed_login":         "Noto'g'ri parol",
  "auth.locked":               "Hisob qulflandi",
};

// ─── Form types ──────────────────────────────────────────────────────────────
interface UserForm {
  username: string; display_name: string; role: "user" | "admin";
  password: string;
  rank_title: string; unit_code: string;
  okrug_name: string; okrug_code: string;
  unit_name: string; division_name: string; division_code: string;
  display_short: string;
  can_create_channel: boolean;
  can_create_group:   boolean;
}
const EMPTY_FORM: UserForm = {
  username: "", display_name: "", role: "user", password: "",
  rank_title: "", unit_code: "",
  okrug_name: "", okrug_code: "",
  unit_name: "", division_name: "", division_code: "", display_short: "",
  can_create_channel: true,
  can_create_group:   true,
};

// ─── Sub-components ──────────────────────────────────────────────────────────
function StatCard({ icon, label, value, sub, accent }: {
  icon: string; label: string; value: number | string;
  sub?: string; accent?: string;
}) {
  return (
    <div className={s.statCard} style={accent ? { "--card-accent": accent } as React.CSSProperties : {}}>
      <div className={s.statIcon}>{icon}</div>
      <div className={s.statBody}>
        <div className={s.statValue}>{value}</div>
        <div className={s.statLabel}>{label}</div>
        {sub && <div className={s.statSub}>{sub}</div>}
      </div>
    </div>
  );
}

function Badge({ children, variant = "default" }: { children: ReactNode; variant?: "default" | "admin" | "active" | "blocked" | "warn" }) {
  return <span className={`${s.badge} ${s[`badge_${variant}`]}`}>{children}</span>;
}

function Spinner() {
  return (
    <div className={s.spinnerWrap}>
      <svg className={s.spinner} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <circle cx="12" cy="12" r="9" strokeDasharray="56" strokeDashoffset="14" />
      </svg>
    </div>
  );
}

// ─── User Edit / Create Modal ─────────────────────────────────────────────────
function UserModal({
  initial, onClose, onSave, creating,
}: {
  initial: UserForm | null;
  onClose: () => void;
  onSave: (form: UserForm) => Promise<void>;
  creating: boolean;
}) {
  const [form, setForm] = useState<UserForm>(initial ?? EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const isNew = !initial;
  const f = (k: keyof UserForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.display_name.trim()) { setErr("To'liq ism kiritilishi shart"); return; }
    if (isNew && !form.username.trim()) { setErr("Username kiritilishi shart"); return; }
    setBusy(true); setErr("");
    try { await onSave(form); }
    catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
    finally { setBusy(false); }
  };

  return (
    <div className={s.overlay} onClick={onClose}>
      <div className={s.modal} onClick={e => e.stopPropagation()}>
        <div className={s.modalHead}>
          <h2 className={s.modalTitle}>{isNew ? "Yangi foydalanuvchi" : "Ma'lumotlarni tahrirlash"}</h2>
          <button className={s.modalClose} onClick={onClose} aria-label="Yopish">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <form className={s.modalBody} onSubmit={submit}>
          <fieldset className={s.fieldset} disabled={busy || creating}>
            <legend className={s.legend}>Asosiy ma'lumotlar</legend>
            <div className={s.formGrid2}>
              {isNew && (
                <div className={s.field}>
                  <label className={s.label}>Login *</label>
                  <input className={s.input} value={form.username} onChange={f("username")} placeholder="login_nomi" autoComplete="off"/>
                </div>
              )}
              <div className={s.field}>
                <label className={s.label}>To'liq ism *</label>
                <input className={s.input} value={form.display_name} onChange={f("display_name")} placeholder="Familiya Ism Sharif"/>
              </div>
              <div className={s.field}>
                <label className={s.label}>Rol</label>
                <select className={s.select} value={form.role} onChange={f("role")}>
                  <option value="user">Foydalanuvchi</option>
                  <option value="admin">Administrator</option>
                </select>
              </div>
              <div className={s.field}>
                <label className={s.label}>Unvon</label>
                <input className={s.input} value={form.rank_title} onChange={f("rank_title")} placeholder="kursant / mayor…"/>
              </div>
              <div className={s.field}>
                <label className={s.label}>{isNew ? "Parol" : "Yangi parol"}</label>
                <PasswordInput
                  value={form.password}
                  onChange={(v) => setForm((p) => ({ ...p, password: v }))}
                  placeholder={isNew ? "Bo'sh qoldirsangiz avtomatik yaratiladi" : "O'zgartirmasangiz bo'sh qoldiring"}
                  autoComplete="new-password"
                  disabled={busy || creating}
                />
              </div>
              <div className={s.field}>
                <label className={s.label}>Qisqa ko'rinish</label>
                <input className={s.input} value={form.display_short} onChange={f("display_short")} placeholder="k-nt Ibroximov V.A."/>
              </div>
              {!isNew && (
                <>
                  <div className={s.field} style={{ gridColumn: "1 / -1" }}>
                    <label className={s.label}>
                      <input
                        type="checkbox"
                        checked={form.can_create_channel}
                        onChange={(e) => setForm((p) => ({ ...p, can_create_channel: e.target.checked }))}
                        disabled={busy || creating}
                      />
                      {" "}Kanal yaratishga ruxsat
                    </label>
                  </div>
                  <div className={s.field} style={{ gridColumn: "1 / -1" }}>
                    <label className={s.label}>
                      <input
                        type="checkbox"
                        checked={form.can_create_group}
                        onChange={(e) => setForm((p) => ({ ...p, can_create_group: e.target.checked }))}
                        disabled={busy || creating}
                      />
                      {" "}Guruh yaratishga ruxsat
                    </label>
                  </div>
                </>
              )}
            </div>
          </fieldset>

          <fieldset className={s.fieldset} disabled={busy || creating}>
            <legend className={s.legend}>Tashkiliy tuzilma</legend>
            <div className={s.formGrid3}>
              <div className={s.field}>
                <label className={s.label}>Harbiy okrug</label>
                <input className={s.input} value={form.okrug_name} onChange={f("okrug_name")} placeholder="Toshkent harbiy okrugi"/>
              </div>
              <div className={s.field}>
                <label className={s.label}>Okrug kodi</label>
                <input className={s.input} value={form.okrug_code} onChange={f("okrug_code")} placeholder="THO"/>
              </div>
              <div className={s.field}>
                <label className={s.label}>Harbiy qism</label>
                <input className={s.input} value={form.unit_name} onChange={f("unit_name")} placeholder="AKTHAI instituti"/>
              </div>
              <div className={s.field}>
                <label className={s.label}>Qism kodi</label>
                <input className={s.input} value={form.unit_code} onChange={f("unit_code")} placeholder="AKTHAI"/>
              </div>
              <div className={s.field}>
                <label className={s.label}>Bo'linma</label>
                <input className={s.input} value={form.division_name} onChange={f("division_name")} placeholder="Kursantlar bat. 1-vzvod"/>
              </div>
              <div className={s.field}>
                <label className={s.label}>Bo'linma kodi</label>
                <input className={s.input} value={form.division_code} onChange={f("division_code")} placeholder="KursBat1"/>
              </div>
            </div>
          </fieldset>

          {err && <p className={s.formError}>{err}</p>}
          <div className={s.modalFoot}>
            <button type="button" className={s.btnSecondary} onClick={onClose}>Bekor qilish</button>
            <button type="submit" className={s.btnPrimary} disabled={busy || creating}>
              {busy ? "Saqlanmoqda…" : isNew ? "Yaratish" : "Saqlash"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Password Result Modal ────────────────────────────────────────────────────
function PasswordModal({ username, pass, onClose }: { username: string; pass: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(pass).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };
  return (
    <div className={s.overlay} onClick={onClose}>
      <div className={s.modal} style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
        <div className={s.modalHead}>
          <h2 className={s.modalTitle}>Vaqtinchalik parol</h2>
          <button className={s.modalClose} onClick={onClose} aria-label="Yopish">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
        <div className={s.passBox}>
          <div className={s.passUser}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
            @{username}
          </div>
          <div className={s.passRow}>
            <code className={s.passCode}>{pass}</code>
            <button className={s.copyBtn} onClick={copy} title="Nusxa olish">
              {copied
                ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5"><path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
              }
            </button>
          </div>
          <p className={s.passNote}>
            Foydalanuvchiga xavfsiz kanal orqali yetkazing.<br/>
            Birinchi kirishda parolni o&apos;zgartirish taklif qilinadi.
          </p>
        </div>
        <div className={s.modalFoot}>
          <button className={s.btnPrimary} onClick={onClose}>Yopish</button>
        </div>
      </div>
    </div>
  );
}

// ─── SECTION: Overview ────────────────────────────────────────────────────────
function OverviewSection({ token }: { token: string }) {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [st, au] = await Promise.all([
        adminApi.stats(token),
        adminApi.auditLog(token, { limit: 8 }),
      ]);
      setStats(st);
      setAudit(au);
    } finally { setLoading(false); }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <Spinner />;

  return (
    <div className={s.sectionWrap}>
      <div className={s.sectionHeader}>
        <h2 className={s.sectionTitle}>Boshqaruv paneli</h2>
        <button className={s.iconBtn} onClick={load} title="Yangilash">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
        </button>
      </div>

      <div className={s.statsGrid}>
        <StatCard icon="👥" label="Jami foydalanuvchi" value={stats?.total_users ?? 0} sub={`${stats?.admin_count ?? 0} admin`} accent="#3b82f6"/>
        <StatCard icon="✅" label="Faol hisoblar" value={stats?.active_users ?? 0} accent="#22c55e"/>
        <StatCard icon="🟢" label="Onlayn hozir" value={stats?.online_now ?? 0} accent="#00d4ff"/>
        <StatCard icon="🔒" label="Qulflangan" value={stats?.locked_users ?? 0} accent="#f59e0b"/>
        <StatCard icon="💬" label="Jami suhbatlar" value={stats?.total_chats ?? 0} sub={`${stats?.private_chats ?? 0} shaxsiy · ${stats?.group_chats ?? 0} guruh`} accent="#8b5cf6"/>
        <StatCard icon="📨" label="Jami xabarlar" value={stats?.total_messages ?? 0} accent="#ec4899"/>
      </div>

      <div className={s.card}>
        <h3 className={s.cardTitle}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          So'nggi faoliyat
        </h3>
        <div className={s.auditMini}>
          {audit.map(e => (
            <div key={e.id} className={s.auditRow}>
              <div className={s.auditAction}>{ACTION_LABELS[e.action] ?? e.action}</div>
              <div className={s.auditMeta}>
                {e.username && <span className={s.auditActor}>@{e.username}</span>}
                <span className={s.auditTime}>{ago(e.created_at)}</span>
              </div>
            </div>
          ))}
          {audit.length === 0 && <p className={s.emptySmall}>Faoliyat yo'q</p>}
        </div>
      </div>
    </div>
  );
}

// ─── SECTION: Users ───────────────────────────────────────────────────────────
function UsersSection({ token }: { token: string }) {
  const currentUserId = useAuthStore(s => s.userId);
  const [users, setUsers]         = useState<User[]>([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState("");
  const [filterRole, setFilterRole] = useState<"" | "admin" | "user">("");
  const [filterStatus, setFilterStatus] = useState<"" | "active" | "blocked">("");
  const [modal, setModal]         = useState<"" | "create" | "edit">(""); 
  const [editUser, setEditUser]   = useState<User | null>(null);
  const [passInfo, setPassInfo]   = useState<{ username: string; pass: string } | null>(null);
  const [creating, setCreating]   = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [deleting, setDeleting]   = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setUsers(await adminApi.listUsers(token)); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const filtered = users.filter(u => {
    const q = search.toLowerCase();
    const matchSearch = !q ||
      u.display_name.toLowerCase().includes(q) ||
      u.username.toLowerCase().includes(q) ||
      (u.rank_title ?? "").toLowerCase().includes(q) ||
      (u.unit_code ?? "").toLowerCase().includes(q) ||
      (u.okrug_code ?? "").toLowerCase().includes(q) ||
      (u.division_code ?? "").toLowerCase().includes(q);
    const matchRole   = !filterRole   || u.role === filterRole;
    const matchStatus = !filterStatus || (filterStatus === "active" ? u.is_active !== false : u.is_active === false);
    return matchSearch && matchRole && matchStatus;
  });

  const openCreate = () => { setEditUser(null); setModal("create"); };
  const openEdit   = (u: User) => { setEditUser(u); setModal("edit"); };
  const closeModal = () => { setModal(""); setEditUser(null); };

  const handleSave = async (form: UserForm) => {
    setCreating(true);
    try {
      const { password, ...rest } = form;
      const payload = {
        ...rest,
        ...(password.trim() ? { password: password.trim() } : {}),
      };
      if (modal === "create") {
        const r = await adminApi.createUser(token, payload);
        if (!password.trim()) {
          setPassInfo({ username: form.username, pass: r.temporary_password });
        }
      } else if (editUser) {
        await adminApi.updateUser(token, editUser.id, payload);
      }
      await load();
      closeModal();
    } finally { setCreating(false); }
  };

  const toggleActive = async (u: User) => {
    await adminApi.setActive(token, u.id, !u.is_active);
    setUsers(p => p.map(x => x.id === u.id ? { ...x, is_active: !u.is_active } : x));
  };

  const resetPass = async (u: User) => {
    if (!confirm(`@${u.username} uchun yangi vaqtinchalik parol yaratilsinmi?`)) return;
    const r = await adminApi.resetPassword(token, u.id);
    setPassInfo({ username: u.username, pass: r.temporary_password });
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await adminApi.deleteUser(token, deleteTarget.id);
      setUsers((p) => p.filter((x) => x.id !== deleteTarget.id));
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  const toForm = (u: User): UserForm => ({
    username: u.username, display_name: u.display_name,
    role: u.role, password: "",
    rank_title: u.rank_title ?? "",
    unit_code: u.unit_code ?? "", okrug_name: u.okrug_name ?? "",
    okrug_code: u.okrug_code ?? "", unit_name: u.unit_name ?? "",
    division_name: u.division_name ?? "", division_code: u.division_code ?? "",
    display_short: u.display_short ?? "",
    can_create_channel: u.can_create_channel !== false,
    can_create_group:   u.can_create_group !== false,
  });

  return (
    <div className={s.sectionWrap}>
      <div className={s.sectionHeader}>
        <h2 className={s.sectionTitle}>Foydalanuvchilar</h2>
        <div className={s.headerActions}>
          <button className={s.iconBtn} onClick={load} title="Yangilash">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
          </button>
          <button className={s.btnPrimary} onClick={openCreate}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14" strokeLinecap="round"/></svg>
            Yangi foydalanuvchi
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className={s.filterBar}>
        <div className={s.searchBox}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={s.searchIco}><circle cx="11" cy="11" r="7"/><path d="M17 17l4 4" strokeLinecap="round"/></svg>
          <input className={s.searchInput} value={search} onChange={e => setSearch(e.target.value)} placeholder="Qidirish (ism, login, birlik…)"/>
          {search && <button className={s.clearBtn} onClick={() => setSearch("")}>✕</button>}
        </div>
        <select className={s.filterSelect} value={filterRole} onChange={e => setFilterRole(e.target.value as typeof filterRole)}>
          <option value="">Barcha rollar</option>
          <option value="admin">Admin</option>
          <option value="user">Foydalanuvchi</option>
        </select>
        <select className={s.filterSelect} value={filterStatus} onChange={e => setFilterStatus(e.target.value as typeof filterStatus)}>
          <option value="">Barcha holat</option>
          <option value="active">Faol</option>
          <option value="blocked">Bloklangan</option>
        </select>
        <span className={s.countBadge}>{filtered.length} / {users.length}</span>
      </div>

      {loading ? <Spinner /> : (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th style={{ width: 36 }}></th>
                <th>Login</th>
                <th>To'liq ism</th>
                <th>Rol</th>
                <th>Unvon · Bo'linma</th>
                <th>Okrug / Qism</th>
                <th>Holat</th>
                <th style={{ width: 160 }}>Amallar</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(u => (
                <tr key={u.id} className={u.is_active === false ? s.rowDisabled : ""}>
                  <td>
                    <div className={s.avatarCell} style={{ background: gradientCssFor(u.display_name) }}>
                      {u.display_name.charAt(0).toUpperCase()}
                    </div>
                  </td>
                  <td>
                    <span className={s.username}>@{u.username}</span>
                    {u.id === currentUserId && <span className={s.meBadge}>sen</span>}
                  </td>
                  <td className={s.displayName}>{u.display_name}</td>
                  <td><Badge variant={u.role === "admin" ? "admin" : "default"}>{u.role === "admin" ? "Admin" : "User"}</Badge></td>
                  <td className={s.cellSm}>
                    {u.rank_title && <span className={s.rankTag}>{u.rank_title}</span>}
                    {u.division_code && <span className={s.unitTag}>{u.division_code}</span>}
                  </td>
                  <td className={s.cellSm}>
                    {u.okrug_code && <span>{u.okrug_code}</span>}
                    {u.unit_code && <span className={s.dot}>·</span>}
                    {u.unit_code && <span>{u.unit_code}</span>}
                  </td>
                  <td>
                    <Badge variant={u.is_active !== false ? "active" : "blocked"}>
                      {u.is_active !== false ? "Faol" : "Bloklangan"}
                    </Badge>
                  </td>
                  <td>
                    <div className={s.actions}>
                      <button className={s.actionBtn} title="Tahrirlash" onClick={() => openEdit(u)}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                      </button>
                      <button className={s.actionBtn} title="Parolni tiklash" onClick={() => resetPass(u)}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
                      </button>
                      <button
                        className={`${s.actionBtn} ${u.is_active !== false ? s.actionDanger : s.actionSuccess}`}
                        title={u.is_active !== false ? "Bloklash" : "Faollashtirish"}
                        onClick={() => toggleActive(u)}
                        disabled={u.id === currentUserId}
                      >
                        {u.is_active !== false
                          ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="12" cy="12" r="10"/><path d="M10 15l-3-3m0 0l3-3m-3 3h10" strokeLinecap="round"/></svg>
                          : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                        }
                      </button>
                      <button
                        className={`${s.actionBtn} ${s.actionDanger}`}
                        title="O'chirish"
                        onClick={() => setDeleteTarget(u)}
                        disabled={u.id === currentUserId}
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                          <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <p className={s.emptyTable}>Foydalanuvchilar topilmadi</p>}
        </div>
      )}

      {modal !== "" && (
        <UserModal
          initial={modal === "edit" && editUser ? toForm(editUser) : null}
          onClose={closeModal}
          onSave={handleSave}
          creating={creating}
        />
      )}
      {passInfo && (
        <PasswordModal username={passInfo.username} pass={passInfo.pass} onClose={() => setPassInfo(null)} />
      )}
      {deleteTarget && (
        <DeleteUserConfirmModal
          user={deleteTarget}
          avatarBg={gradientCssFor(deleteTarget.display_name)}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={confirmDelete}
          loading={deleting}
        />
      )}
    </div>
  );
}

// ─── SECTION: Chats ───────────────────────────────────────────────────────────
function adminMsgTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(String(iso)).toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "—";
  }
}

function adminMsgPreview(msg: AdminChatMessage): string {
  if (msg.msg_type === 2) return "📎 Shifrlangan fayl";
  return "🔒 Shifrlangan xabar";
}

function AdminChatMessageBubble({
  msg,
  chatType,
  leftMemberId,
  showSenderName,
}: {
  msg: AdminChatMessage;
  chatType: string;
  leftMemberId?: string;
  showSenderName: boolean;
}) {
  const isPrivate = chatType === "private" && leftMemberId;
  const isOwn = isPrivate && msg.sender_id !== leftMemberId;

  return (
    <div className={`${bubbleS.wrap} ${isOwn ? bubbleS.own : bubbleS.incoming}`}>
      <div className={`${bubbleS.bubble} ${isOwn ? bubbleS.bubbleOwn : bubbleS.bubbleIn}`}>
        {showSenderName && (
          <div className={s.adminBubbleSender}>@{msg.sender_username}</div>
        )}
        <div className={bubbleS.textPending}>{adminMsgPreview(msg)}</div>
        <div className={bubbleS.meta}>
          <span className={bubbleS.time}>{adminMsgTime(msg.created_at)}</span>
          {isOwn && (
            <span className={msg.read ? bubbleS.ticksRead : bubbleS.ticks} aria-hidden="true">
              {msg.read ? "✓✓" : "✓"}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function ChatViewerModal({
  chat, token, onClose,
}: {
  chat: AdminChat;
  token: string;
  onClose: () => void;
}) {
  const [detail, setDetail]       = useState<AdminChatDetail | null>(null);
  const [loading, setLoading]     = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [err, setErr]             = useState("");
  const listRef                   = useRef<HTMLDivElement>(null);

  const load = useCallback(async (offset = 0, append = false) => {
    if (offset === 0) setLoading(true);
    else setLoadingMore(true);
    setErr("");
    try {
      const data = await adminApi.chatMessages(token, chat.id, { limit: 100, offset });
      setDetail((prev) =>
        append && prev
          ? { ...data, messages: [...prev.messages, ...data.messages] }
          : data
      );
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Xabarlar yuklanmadi");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [token, chat.id]);

  useEffect(() => { void load(0); }, [load]);

  useEffect(() => {
    if (!loading && detail?.messages.length && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [loading, detail?.messages.length]);

  const title = detail?.chat.title || chat.title || `Suhbat ${chat.id.slice(0, 8)}`;
  const hasMore = detail != null && detail.messages.length < detail.total;
  const leftMemberId = detail?.chat.members[0]?.id;
  const isGroup = (detail?.chat.type ?? chat.type) === "group";

  return (
    <div className={s.overlay} onClick={onClose}>
      <div className={s.chatViewer} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className={s.chatViewerHead}>
          <div>
            <h2 className={s.modalTitle}>{title}</h2>
            <p className={s.chatViewerSub}>
              {chat.type === "group" ? "Guruh" : "Shaxsiy"} · {detail?.total ?? chat.message_count} xabar
            </p>
          </div>
          <button className={s.modalClose} onClick={onClose} aria-label="Yopish">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {detail && detail.chat.members.length > 0 && (
          <div className={s.chatMembers}>
            {detail.chat.members.map((m) => (
              <span key={m.id} className={s.memberChip}>@{m.username}</span>
            ))}
          </div>
        )}

        <div className={s.e2eeBanner}>
          🔒 Xabarlar E2EE bilan shifrlangan — faqat metadata ko&apos;rinadi.
        </div>

        <div className={s.chatMsgArea} ref={listRef}>
          {loading ? (
            <Spinner />
          ) : err ? (
            <p className={s.formError}>{err}</p>
          ) : detail && detail.messages.length === 0 ? (
            <p className={s.emptySmall}>Xabarlar yo&apos;q</p>
          ) : (
            detail?.messages.map((msg) => (
              <AdminChatMessageBubble
                key={msg.msg_id}
                msg={msg}
                chatType={detail.chat.type}
                leftMemberId={leftMemberId}
                showSenderName={isGroup}
              />
            ))
          )}
        </div>

        {hasMore && (
          <div className={s.chatViewerFoot}>
            <button
              type="button"
              className={s.btnSecondary}
              disabled={loadingMore}
              onClick={() => void load(detail!.messages.length, true)}
            >
              {loadingMore ? "Yuklanmoqda…" : `Yana yuklash (${detail!.messages.length}/${detail!.total})`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ChatsSection({ token }: { token: string }) {
  const [chats, setChats] = useState<AdminChat[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState("");
  const [viewChat, setViewChat] = useState<AdminChat | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setChats(await adminApi.listChats(token)); }
    finally { setLoading(false); }
  }, [token]);
  useEffect(() => { void load(); }, [load]);

  const filtered = chats.filter(c =>
    !search || c.title.toLowerCase().includes(search.toLowerCase()) || c.id.includes(search)
  );

  return (
    <div className={s.sectionWrap}>
      <div className={s.sectionHeader}>
        <h2 className={s.sectionTitle}>Suhbatlar</h2>
        <button className={s.iconBtn} onClick={load} title="Yangilash">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
        </button>
      </div>
      <div className={s.filterBar}>
        <div className={s.searchBox}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={s.searchIco}><circle cx="11" cy="11" r="7"/><path d="M17 17l4 4" strokeLinecap="round"/></svg>
          <input className={s.searchInput} value={search} onChange={e => setSearch(e.target.value)} placeholder="Nomi yoki ID bo'yicha qidirish"/>
          {search && <button className={s.clearBtn} onClick={() => setSearch("")}>✕</button>}
        </div>
        <span className={s.countBadge}>{filtered.length}</span>
      </div>
      {loading ? <Spinner /> : (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead><tr>
              <th>Nomi</th>
              <th>Tur</th>
              <th>A'zolar</th>
              <th>Xabarlar</th>
              <th>So'nggi faollik</th>
              <th>Yaratilgan</th>
              <th style={{ width: 90 }}>Amal</th>
            </tr></thead>
            <tbody>
              {filtered.map(c => (
                <tr
                  key={c.id}
                  className={c.message_count > 0 ? s.clickableRow : undefined}
                  onClick={() => c.message_count > 0 && setViewChat(c)}
                >
                  <td>
                    <div className={s.chatTitleCell}>
                      <div className={s.chatAvatar} style={{ background: gradientCssFor(c.title || c.id) }}>
                        {(c.title || "S").charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className={s.chatName}>{c.title || `Suhbat ${c.id.slice(0,8)}`}</div>
                        <div className={s.chatId}>{c.id.slice(0,8)}…</div>
                      </div>
                    </div>
                  </td>
                  <td><Badge variant={c.type === "group" ? "admin" : "default"}>{c.type === "group" ? "Guruh" : "Shaxsiy"}</Badge></td>
                  <td className={s.numCell}>{c.member_count}</td>
                  <td className={s.numCell}>{c.message_count}</td>
                  <td className={s.cellSm}>{ago(c.last_activity)}</td>
                  <td className={s.cellSm}>{fmtDate(c.created_at)}</td>
                  <td>
                    <button
                      type="button"
                      className={s.actionBtn}
                      title="Xabarlarni ko'rish"
                      disabled={c.message_count === 0}
                      onClick={(e) => { e.stopPropagation(); setViewChat(c); }}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                        <circle cx="12" cy="12" r="3"/>
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <p className={s.emptyTable}>Suhbatlar topilmadi</p>}
        </div>
      )}
      {viewChat && (
        <ChatViewerModal chat={viewChat} token={token} onClose={() => setViewChat(null)} />
      )}
    </div>
  );
}

// ─── SECTION: Audit Log ───────────────────────────────────────────────────────
const AUDIT_ACTIONS = [
  "admin.user.create", "admin.user.update",
  "admin.user.set_active", "admin.user.reset_password",
  "admin.chat.read",
  "auth.login", "auth.logout", "auth.failed_login", "auth.locked",
];

function AuditSection({ token }: { token: string }) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset]   = useState(0);
  const [filterAction, setFilterAction] = useState("");
  const LIMIT = 50;

  const load = useCallback(async (off = 0, action = filterAction) => {
    setLoading(true);
    try {
      const data = await adminApi.auditLog(token, { limit: LIMIT, offset: off, action });
      setEntries(data);
    } finally { setLoading(false); }
  }, [token, filterAction]);

  useEffect(() => { void load(0, filterAction); }, [filterAction]);

  const prev = () => { const o = Math.max(0, offset - LIMIT); setOffset(o); void load(o); };
  const next = () => { const o = offset + LIMIT; setOffset(o); void load(o); };

  const actionColor = (a: string): string => {
    if (a.includes("create")) return "var(--success)";
    if (a.includes("reset") || a.includes("update")) return "var(--accent)";
    if (a.includes("locked") || a.includes("failed")) return "var(--danger)";
    if (a.includes("set_active")) return "var(--warning)";
    return "var(--text-3)";
  };

  return (
    <div className={s.sectionWrap}>
      <div className={s.sectionHeader}>
        <h2 className={s.sectionTitle}>Audit jurnali</h2>
        <button className={s.iconBtn} onClick={() => load(offset)} title="Yangilash">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
        </button>
      </div>
      <div className={s.filterBar}>
        <select className={s.filterSelect} value={filterAction} onChange={e => { setOffset(0); setFilterAction(e.target.value); }}>
          <option value="">Barcha amallar</option>
          {AUDIT_ACTIONS.map(a => <option key={a} value={a}>{ACTION_LABELS[a] ?? a}</option>)}
        </select>
        <div className={s.pagination}>
          <button className={s.pageBtn} onClick={prev} disabled={offset === 0 || loading}>‹ Oldingi</button>
          <span className={s.pageInfo}>{offset + 1}–{offset + entries.length}</span>
          <button className={s.pageBtn} onClick={next} disabled={entries.length < LIMIT || loading}>Keyingi ›</button>
        </div>
      </div>
      {loading ? <Spinner /> : (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead><tr>
              <th>Amal</th>
              <th>Foydalanuvchi</th>
              <th>IP manzil</th>
              <th>Sana</th>
            </tr></thead>
            <tbody>
              {entries.map(e => (
                <tr key={e.id}>
                  <td>
                    <span className={s.auditActionTag} style={{ color: actionColor(e.action) }}>
                      {ACTION_LABELS[e.action] ?? e.action}
                    </span>
                  </td>
                  <td className={s.username}>{e.username ? `@${e.username}` : e.actor_id.slice(0,8) + "…"}</td>
                  <td className={s.ipCell}>{e.ip || "—"}</td>
                  <td className={s.cellSm}>{fmtDateShort(e.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {entries.length === 0 && <p className={s.emptyTable}>Yozuvlar topilmadi</p>}
        </div>
      )}
    </div>
  );
}

// ─── SECTION: Security ────────────────────────────────────────────────────────
const POLICY_LABELS: Record<ProfileFieldKey, string> = {
  display_name:  "To'liq ism",
  display_short: "Qisqa ism",
  rank_title:    "Unvon",
  unit_code:     "Qism kodi",
  unit_name:     "Qism nomi",
  okrug_name:    "Okrug nomi",
  okrug_code:    "Okrug kodi",
  division_name: "Bo'linma nomi",
  division_code: "Bo'linma kodi",
  avatar:        "Profil surati",
};

function ProfilePolicyCard({ token }: { token: string }) {
  const [policy, setPolicy] = useState<ProfileEditPolicy | null>(null);
  const [fields, setFields] = useState<ProfileFieldKey[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg]       = useState("");

  const load = useCallback(async () => {
    const data = await adminApi.getProfilePolicy(token);
    setPolicy(data.policy);
    setFields(data.fields as ProfileFieldKey[]);
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const toggle = (key: ProfileFieldKey) => {
    if (!policy) return;
    setPolicy({ ...policy, [key]: !policy[key] });
  };

  const save = async () => {
    if (!policy) return;
    setSaving(true);
    setMsg("");
    try {
      await adminApi.setProfilePolicy(token, policy);
      setMsg("Saqlandi");
    } catch (ex) {
      setMsg(ex instanceof Error ? ex.message : "Xatolik");
    } finally {
      setSaving(false);
    }
  };

  if (!policy) return <Spinner />;

  return (
    <div className={s.card}>
      <h3 className={s.cardTitle}>Profil tahrirlash ruxsatlari</h3>
      <p className={s.emptySmall} style={{ marginBottom: 12 }}>
        Foydalanuvchilar qaysi maydonlarni o&apos;zlari tahrirlashi mumkinligini belgilang.
      </p>
      <div className={s.policyGrid}>
        {fields.map((key) => (
          <label key={key} className={s.policyRow}>
            <span>{POLICY_LABELS[key] ?? key}</span>
            <button
              type="button"
              className={`${s.toggle} ${policy[key] ? s.toggleOn : ""}`}
              onClick={() => toggle(key)}
              aria-pressed={policy[key]}
            >
              <span className={s.toggleKnob} />
            </button>
          </label>
        ))}
      </div>
      {msg && <p className={s.emptySmall}>{msg}</p>}
      <button type="button" className={s.btnPrimary} style={{ marginTop: 12 }} disabled={saving} onClick={() => void save()}>
        {saving ? "Saqlanmoqda…" : "Ruxsatlarni saqlash"}
      </button>
    </div>
  );
}

function SecuritySection({ token }: { token: string }) {
  const [users, setUsers]   = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { setUsers(await adminApi.listUsers(token)); }
    finally { setLoading(false); }
  }, [token]);
  useEffect(() => { void load(); }, [load]);

  const blocked  = users.filter(u => u.is_active === false);
  const inactive = users.filter(u => u.is_active !== false);

  const unblock = async (u: User) => {
    await adminApi.setActive(token, u.id, true);
    setUsers(p => p.map(x => x.id === u.id ? { ...x, is_active: true } : x));
  };

  return (
    <div className={s.sectionWrap}>
      <div className={s.sectionHeader}>
        <h2 className={s.sectionTitle}>Xavfsizlik</h2>
        <button className={s.iconBtn} onClick={load} title="Yangilash">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
        </button>
      </div>

      <div className={s.secGrid}>
        <div className={s.card}>
          <h3 className={s.cardTitle}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="2.2"><circle cx="12" cy="12" r="10"/><path d="M10 15l-3-3m0 0l3-3m-3 3h10" strokeLinecap="round"/></svg>
            Bloklangan hisoblar ({blocked.length})
          </h3>
          {loading ? <Spinner /> : blocked.length === 0
            ? <p className={s.emptySmall}>Bloklangan foydalanuvchi yo'q</p>
            : (
              <div className={s.secList}>
                {blocked.map(u => (
                  <div key={u.id} className={s.secRow}>
                    <div className={s.secAvatar} style={{ background: gradientCssFor(u.display_name) }}>
                      {u.display_name.charAt(0).toUpperCase()}
                    </div>
                    <div className={s.secInfo}>
                      <span className={s.username}>@{u.username}</span>
                      <span className={s.secName}>{u.display_name}</span>
                    </div>
                    <button className={`${s.actionBtn} ${s.actionSuccess}`} onClick={() => unblock(u)} title="Faollashtirish">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                      Faollashtirish
                    </button>
                  </div>
                ))}
              </div>
            )}
        </div>

        <div className={s.card}>
          <h3 className={s.cardTitle}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            Faol hisoblar ({inactive.length})
          </h3>
          {loading ? <Spinner /> : (
            <div className={s.secList} style={{ maxHeight: 300 }}>
              {inactive.slice(0, 20).map(u => (
                <div key={u.id} className={s.secRow}>
                  <div className={s.secAvatar} style={{ background: gradientCssFor(u.display_name) }}>
                    {u.display_name.charAt(0).toUpperCase()}
                  </div>
                  <div className={s.secInfo}>
                    <span className={s.username}>@{u.username}</span>
                    <span className={s.secName}>{u.rank_title ? `${u.rank_title} · ` : ""}{u.display_name}</span>
                  </div>
                  <Badge variant="active">Faol</Badge>
                </div>
              ))}
              {inactive.length > 20 && <p className={s.emptySmall}>va yana {inactive.length - 20} ta…</p>}
            </div>
          )}
        </div>
      </div>

      <ProfilePolicyCard token={token} />

      {/* E2EE info card */}
      <div className={s.card}>
        <h3 className={s.cardTitle}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
          End-to-End Shifrlash (E2EE)
        </h3>
        <div className={s.e2eeInfo}>
          <div className={s.e2eeRow}>
            <span className={s.e2eeLabel}>Protokol</span>
            <span className={s.e2eeVal}>Signal Protocol (X3DH + Double Ratchet)</span>
          </div>
          <div className={s.e2eeRow}>
            <span className={s.e2eeLabel}>Shifrlash</span>
            <span className={s.e2eeVal}>AES-256-GCM (xabarlar), AES-256-GCM (media)</span>
          </div>
          <div className={s.e2eeRow}>
            <span className={s.e2eeLabel}>Kalit almashinuv</span>
            <span className={s.e2eeVal}>X25519 ECDH (X3DH), Ed25519 imzo</span>
          </div>
          <div className={s.e2eeRow}>
            <span className={s.e2eeLabel}>Server ko'rmaydi</span>
            <span className={s.e2eeVal}>Xabarlar faqat shifrlangan shaklda saqlanadi</span>
          </div>
          <div className={s.e2eeRow}>
            <span className={s.e2eeLabel}>Parol xeshlash</span>
            <span className={s.e2eeVal}>Argon2id (memory-hard)</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── NAV items ────────────────────────────────────────────────────────────────
const NAV_ITEMS: { id: Section; label: string; icon: ReactNode }[] = [
  {
    id: "overview", label: "Umumiy ko'rinish",
    icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
  },
  {
    id: "users", label: "Foydalanuvchilar",
    icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>
  },
  {
    id: "chats", label: "Suhbatlar",
    icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
  },
  {
    id: "audit", label: "Audit jurnali",
    icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>
  },
  {
    id: "security", label: "Xavfsizlik",
    icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
  },
];

// ─── ROOT ─────────────────────────────────────────────────────────────────────
export default function AdminDashboard({ onBack }: Props) {
  const { username } = useAuthStore();
  const token = useAuthStore(s => s.token)!;
  const [section, setSection] = useState<Section>("overview");
  const [sideCollapsed, setSideCollapsed] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useRegisterBackHandler(
    useCallback(() => { onBack(); return true; }, [onBack]),
    true,
    BACK_PRIORITY.settings,
  );

  const avatarBg = gradientCssFor(username ?? "A");

  const changeSection = (id: Section) => {
    setSection(id);
    contentRef.current?.scrollTo({ top: 0 });
  };

  return (
    <div className={s.shell}>
      {/* ─── Left sidebar ─── */}
      <aside className={`${s.sidebar} ${sideCollapsed ? s.sideCollapsed : ""}`}>
        <div className={s.sideTop}>
          <button className={s.backBtn} onClick={onBack} title="Asosiy ekranga qaytish">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M19 12H5M12 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round"/></svg>
            {!sideCollapsed && <span>Orqaga</span>}
          </button>
          <button className={s.collapseBtn} onClick={() => setSideCollapsed(p => !p)} title={sideCollapsed ? "Kengaytirish" : "Kichraytirish"}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              {sideCollapsed
                ? <path d="M9 18l6-6-6-6" strokeLinecap="round"/>
                : <path d="M15 18l-6-6 6-6" strokeLinecap="round"/>}
            </svg>
          </button>
        </div>

        {!sideCollapsed && (
          <div className={s.sideProfile}>
            <div className={s.sideAvatar} style={{ background: avatarBg }}>{(username ?? "A").charAt(0).toUpperCase()}</div>
            <div className={s.sideProfileInfo}>
              <div className={s.sideProfileName}>{username}</div>
              <div className={s.sideProfileRole}>Administrator</div>
            </div>
          </div>
        )}

        <nav className={s.nav}>
          {NAV_ITEMS.map(item => (
            <button
              key={item.id}
              className={`${s.navItem} ${section === item.id ? s.navActive : ""}`}
              onClick={() => changeSection(item.id)}
              title={sideCollapsed ? item.label : ""}
            >
              <span className={s.navIcon}>{item.icon}</span>
              {!sideCollapsed && <span className={s.navLabel}>{item.label}</span>}
            </button>
          ))}
        </nav>

        {!sideCollapsed && (
          <div className={s.sideFooter}>
            <div className={s.sideFooterBadge}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
              E2EE · Signal Protocol
            </div>
          </div>
        )}
      </aside>

      {/* ─── Main content ─── */}
      <main className={s.main} ref={contentRef}>
        <div className={s.topBar}>
          <div className={s.topBarLeft}>
            <span className={s.topBarTitle}>
              {NAV_ITEMS.find(n => n.id === section)?.label}
            </span>
          </div>
          <div className={s.topBarRight}>
            <div className={s.onlineIndicator}>
              <span className={s.onlineDot} />
              <span className={s.onlineText}>Tizim ishlayapti</span>
            </div>
            <div className={s.topAvatar} style={{ background: avatarBg }}>
              {(username ?? "A").charAt(0).toUpperCase()}
            </div>
          </div>
        </div>

        <div className={s.content}>
          {section === "overview"  && <OverviewSection  token={token} />}
          {section === "users"     && <UsersSection     token={token} />}
          {section === "chats"     && <ChatsSection     token={token} />}
          {section === "audit"     && <AuditSection     token={token} />}
          {section === "security"  && <SecuritySection  token={token} />}
        </div>
      </main>
    </div>
  );
}
