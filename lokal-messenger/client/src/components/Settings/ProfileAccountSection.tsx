// Foydalanuvchi o'z profilini tahrirlash (admin ruxsat bergan maydonlar).
import { useCallback, useEffect, useRef, useState } from "react";
import { profileApi } from "@/api/http";
import { useAuthStore } from "@/store/authStore";
import UserAvatar from "@/components/Common/UserAvatar";
import type { ProfileFieldKey, UserProfile } from "@/types";
import s from "./ProfileAccountSection.module.css";

const FIELD_LABELS: Record<ProfileFieldKey, string> = {
  display_name:  "To'liq ism",
  display_short:   "Qisqa ism",
  rank_title:      "Unvon",
  unit_code:       "Qism kodi",
  unit_name:       "Qism nomi",
  okrug_name:      "Okrug nomi",
  okrug_code:      "Okrug kodi",
  division_name:   "Bo'linma nomi",
  division_code:   "Bo'linma kodi",
  avatar:          "Profil surati",
};

const TEXT_FIELDS: ProfileFieldKey[] = [
  "display_name", "display_short", "rank_title",
  "unit_code", "unit_name", "okrug_name", "okrug_code",
  "division_name", "division_code",
];

interface Props {
  token: string;
}

export default function ProfileAccountSection({ token }: Props) {
  const userId = useAuthStore((st) => st.userId);
  const syncActiveProfile = useAuthStore((st) => st.syncActiveProfile);
  const [profile, setProfile]       = useState<UserProfile | null>(null);
  const [form, setForm]             = useState<Record<string, string>>({});
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [err, setErr]               = useState("");
  const [ok, setOk]                 = useState("");
  const [avatarVer, setAvatarVer]   = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const p = await profileApi.get(token);
      setProfile(p);
      setForm({
        display_name:  p.display_name ?? "",
        display_short: p.display_short ?? "",
        rank_title:    p.rank_title ?? "",
        unit_code:     p.unit_code ?? "",
        unit_name:     p.unit_name ?? "",
        okrug_name:    p.okrug_name ?? "",
        okrug_code:    p.okrug_code ?? "",
        division_name: p.division_name ?? "",
        division_code: p.division_code ?? "",
      });
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Profil yuklanmadi");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    if (!profile) return;
    setSaving(true);
    setErr("");
    setOk("");
    try {
      const payload: Record<string, string> = {};
      for (const key of TEXT_FIELDS) {
        if (profile.editable[key]) {
          payload[key] = form[key] ?? "";
        }
      }
      await profileApi.update(token, payload);
      setOk("Saqlandi");
      await load();
      await syncActiveProfile();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Saqlash xatoligi");
    } finally {
      setSaving(false);
    }
  };

  const onPickAvatar = () => fileRef.current?.click();

  const onAvatarFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !profile?.editable.avatar) return;
    if (file.size > 2 * 1024 * 1024) {
      setErr("Surat 2MB dan katta bo'lmasligi kerak");
      return;
    }
    setAvatarBusy(true);
    setErr("");
    try {
      await profileApi.uploadAvatar(token, file);
      setAvatarVer(String(Date.now()));
      setOk("Surat yangilandi");
      await load();
      await syncActiveProfile();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Surat yuklanmadi");
    } finally {
      setAvatarBusy(false);
    }
  };

  const removeAvatar = async () => {
    if (!profile?.editable.avatar) return;
    setAvatarBusy(true);
    setErr("");
    try {
      await profileApi.deleteAvatar(token);
      setAvatarVer(String(Date.now()));
      setOk("Surat o'chirildi");
      await load();
      await syncActiveProfile();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "O'chirish xatoligi");
    } finally {
      setAvatarBusy(false);
    }
  };

  if (loading) return <p className={s.hint}>Yuklanmoqda…</p>;
  if (!profile) return <p className={s.error}>{err || "Profil topilmadi"}</p>;

  const canEditAny = TEXT_FIELDS.some((k) => profile.editable[k]);

  return (
    <div className={s.root}>
      <div className={s.avatarBlock}>
        <UserAvatar
          userId={userId ?? profile.id}
          name={profile.display_name || profile.username}
          token={token}
          hasAvatar={profile.has_avatar}
          size={88}
          cacheKey={avatarVer}
        />
        <div className={s.avatarMeta}>
          <div className={s.login}>@{profile.username}</div>
          <div className={s.role}>{profile.role === "admin" ? "Administrator" : "Foydalanuvchi"}</div>
          {profile.editable.avatar ? (
            <div className={s.avatarActions}>
              <button type="button" className={s.btnSecondary} onClick={onPickAvatar} disabled={avatarBusy}>
                {avatarBusy ? "…" : "Surat yuklash"}
              </button>
              {profile.has_avatar && (
                <button type="button" className={s.btnGhost} onClick={() => void removeAvatar()} disabled={avatarBusy}>
                  O&apos;chirish
                </button>
              )}
            </div>
          ) : (
            <p className={s.lockedHint}>Surat yuklash administrator tomonidan o&apos;chirilgan</p>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          hidden
          onChange={(e) => void onAvatarFile(e)}
        />
      </div>

      <div className={s.form}>
        {TEXT_FIELDS.map((key) => {
          const editable = profile.editable[key];
          return (
            <label key={key} className={s.field}>
              <span className={s.label}>
                {FIELD_LABELS[key]}
                {!editable && <span className={s.lockBadge}>🔒 Admin</span>}
              </span>
              <input
                className={`${s.input} ${!editable ? s.inputLocked : ""}`}
                value={form[key] ?? ""}
                disabled={!editable || saving}
                onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))}
              />
            </label>
          );
        })}
      </div>

      {err && <p className={s.error}>{err}</p>}
      {ok && <p className={s.ok}>{ok}</p>}

      {canEditAny ? (
        <button type="button" className={s.btnPrimary} onClick={() => void save()} disabled={saving}>
          {saving ? "Saqlanmoqda…" : "O'zgarishlarni saqlash"}
        </button>
      ) : (
        <p className={s.hint}>Tahrirlash uchun administrator ruxsati yo&apos;q.</p>
      )}
    </div>
  );
}
