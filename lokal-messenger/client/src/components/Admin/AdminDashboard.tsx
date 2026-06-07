import { useState, useEffect, useCallback } from "react";
import { useAuthStore } from "@/store/authStore";
import { userApi }      from "@/api/http";
import { useRegisterBackHandler, BACK_PRIORITY } from "@/contexts/BackNavigationContext";
import type { User }    from "@/types";
import styles           from "./AdminDashboard.module.css";

interface Props {
  onBack: () => void;
}

interface NewUserForm {
  username:      string;
  display_name:  string;
  role:          "user" | "admin";
  rank_title:    string;
  unit_code:     string;
  okrug_name:    string;
  okrug_code:    string;
  unit_name:     string;
  division_name: string;
  division_code: string;
  display_short: string;
}

const EMPTY_FORM: NewUserForm = {
  username:      "",
  display_name:  "",
  role:          "user",
  rank_title:    "",
  unit_code:     "",
  okrug_name:    "",
  okrug_code:    "",
  unit_name:     "",
  division_name: "",
  division_code: "",
  display_short: "",
};

export default function AdminDashboard({ onBack }: Props) {
  const token = useAuthStore((s) => s.token)!;

  const [users, setUsers]       = useState<User[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState("");
  const [form, setForm]         = useState<NewUserForm>(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [newPass, setNewPass]   = useState<{ username: string; pass: string } | null>(null);
  const [formError, setFormError] = useState("");

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(
        (import.meta.env.PROD
          ? (await import("@/config/serverConfig")).getApiBase()
          : "/api/v1") + "/admin/users",
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as User[];
      setUsers(data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void loadUsers(); }, [loadUsers]);

  useRegisterBackHandler(
    useCallback(() => {
      onBack();
      return true;
    }, [onBack]),
    true,
    BACK_PRIORITY.settings,
  );

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.username.trim() || !form.display_name.trim()) {
      setFormError("Username va to'liq ism kiritilishi shart");
      return;
    }
    setCreating(true);
    setFormError("");
    try {
      const result = await userApi.create(token, {
        username:      form.username.trim(),
        display_name:  form.display_name.trim(),
        role:          form.role,
        rank_title:    form.rank_title || null as unknown as string,
        unit_code:     form.unit_code  || null as unknown as string,
        okrug_name:    form.okrug_name || null as unknown as string,
        okrug_code:    form.okrug_code || null as unknown as string,
        unit_name:     form.unit_name || null as unknown as string,
        division_name: form.division_name || null as unknown as string,
        division_code: form.division_code || null as unknown as string,
        display_short: form.display_short || null as unknown as string,
      });
      setNewPass({ username: form.username.trim(), pass: result.temporary_password });
      setForm(EMPTY_FORM);
      await loadUsers();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  const toggleActive = async (u: User) => {
    try {
      await userApi.setActive(token, u.id, !u.is_active);
      setUsers((prev) =>
        prev.map((x) => x.id === u.id ? { ...x, is_active: !u.is_active } : x)
      );
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <button className={styles.backBtn} onClick={onBack}>← Orqaga</button>
        <h1 className={styles.pageTitle}>Admin Panel</h1>
      </div>

      <div className={styles.content}>
        {/* ── Yangi foydalanuvchi qo'shish ── */}
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Yangi foydalanuvchi qo'shish</h2>
          <form onSubmit={handleCreate} className={styles.form}>
            <div className={styles.formGrid}>
              <div className={styles.field}>
                <label className={styles.label}>Username *</label>
                <input
                  className={styles.input}
                  value={form.username}
                  onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                  placeholder="example_user"
                  autoComplete="off"
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>To'liq ism *</label>
                <input
                  className={styles.input}
                  value={form.display_name}
                  onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
                  placeholder="Ism Familiya"
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Rol</label>
                <select
                  className={styles.select}
                  value={form.role}
                  onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as "user" | "admin" }))}
                >
                  <option value="user">Foydalanuvchi</option>
                  <option value="admin">Administrator</option>
                </select>
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Unvon</label>
                <input
                  className={styles.input}
                  value={form.rank_title}
                  onChange={(e) => setForm((f) => ({ ...f, rank_title: e.target.value }))}
                  placeholder="kursant"
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Qisqa yorliq</label>
                <input
                  className={styles.input}
                  value={form.display_short}
                  onChange={(e) => setForm((f) => ({ ...f, display_short: e.target.value }))}
                  placeholder="k-nt Ibroximov V.A."
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Harbiy okrug</label>
                <input
                  className={styles.input}
                  value={form.okrug_name}
                  onChange={(e) => setForm((f) => ({ ...f, okrug_name: e.target.value }))}
                  placeholder="Toshkent harbiy okrugi"
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Okrug kodi</label>
                <input
                  className={styles.input}
                  value={form.okrug_code}
                  onChange={(e) => setForm((f) => ({ ...f, okrug_code: e.target.value }))}
                  placeholder="THO"
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Harbiy qism</label>
                <input
                  className={styles.input}
                  value={form.unit_name}
                  onChange={(e) => setForm((f) => ({ ...f, unit_name: e.target.value }))}
                  placeholder="AKTHAI"
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Qism kodi</label>
                <input
                  className={styles.input}
                  value={form.unit_code}
                  onChange={(e) => setForm((f) => ({ ...f, unit_code: e.target.value }))}
                  placeholder="AKTHAI"
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Bo'linma</label>
                <input
                  className={styles.input}
                  value={form.division_name}
                  onChange={(e) => setForm((f) => ({ ...f, division_name: e.target.value }))}
                  placeholder="Kursantlar batalyoni 1-vzvod"
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Bo'linma kodi</label>
                <input
                  className={styles.input}
                  value={form.division_code}
                  onChange={(e) => setForm((f) => ({ ...f, division_code: e.target.value }))}
                  placeholder="KursBat1"
                />
              </div>
            </div>
            {formError && <p className={styles.error}>{formError}</p>}
            <button type="submit" className={styles.createBtn} disabled={creating}>
              {creating ? "Yaratilmoqda…" : "Foydalanuvchi yaratish"}
            </button>
          </form>

          {newPass && (
            <div className={styles.passBox}>
              <p className={styles.passTitle}>Vaqtinchalik parol yaratildi</p>
              <p className={styles.passUser}>@{newPass.username}</p>
              <code className={styles.passCode}>{newPass.pass}</code>
              <p className={styles.passNote}>
                Foydalanuvchiga xavfsiz kanal orqali yetkazing. Birinchi kirishda almashtiriladi.
              </p>
              <button className={styles.passClose} onClick={() => setNewPass(null)}>
                Yopish
              </button>
            </div>
          )}
        </section>

        {/* ── Foydalanuvchilar jadvali ── */}
        <section className={styles.card}>
          <div className={styles.tableHeader}>
            <h2 className={styles.cardTitle}>Foydalanuvchilar ({users.length})</h2>
            <button className={styles.refreshBtn} onClick={loadUsers} disabled={loading}>
              {loading ? "Yuklanmoqda…" : "Yangilash"}
            </button>
          </div>
          {error && <p className={styles.error}>{error}</p>}
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Username</th>
                  <th>To'liq ism</th>
                  <th>Rol</th>
                  <th>Unvon</th>
                  <th>Birlik</th>
                  <th>Holat</th>
                  <th>Amal</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className={u.is_active === false ? styles.rowInactive : ""}>
                    <td className={styles.cellUsername}>@{u.username}</td>
                    <td>{u.display_name}</td>
                    <td>
                      <span className={u.role === "admin" ? styles.badgeAdmin : styles.badgeUser}>
                        {u.role === "admin" ? "Admin" : "User"}
                      </span>
                    </td>
                    <td>{u.rank_title ?? "—"}</td>
                    <td>{u.unit_code ?? "—"}</td>
                    <td>
                      <span className={u.is_active !== false ? styles.active : styles.inactive}>
                        {u.is_active !== false ? "Faol" : "Bloklangan"}
                      </span>
                    </td>
                    <td>
                      <button
                        className={u.is_active !== false ? styles.blockBtn : styles.unblockBtn}
                        onClick={() => toggleActive(u)}
                      >
                        {u.is_active !== false ? "Bloklash" : "Faollashtirish"}
                      </button>
                    </td>
                  </tr>
                ))}
                {!loading && users.length === 0 && (
                  <tr>
                    <td colSpan={7} className={styles.empty}>Foydalanuvchilar topilmadi</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
