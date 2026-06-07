// Ierarxik foydalanuvchilar katalogi: Okrug → Qism → Bo'linma → Foydalanuvchi
import { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "@/types";
import { userApi } from "@/api/http";
import { gradientCssFor } from "@/utils/avatarGradient";
import {
  buildUserTree,
  collectNodeKeys,
  filterUserTree,
  groupLabel,
  userFullLabel,
  type OrgGroupNode,
} from "@/utils/userDirectory";
import s from "./UserDirectory.module.css";

interface Props {
  token:      string;
  search:     string;
  onSelectUser: (user: User) => void;
}

function countUsers(node: OrgGroupNode): number {
  return node.users.length + node.children.reduce((n, c) => n + countUsers(c), 0);
}

function GroupBlock({
  node,
  expanded,
  onToggle,
  onSelectUser,
}: {
  node:         OrgGroupNode;
  expanded:     Set<string>;
  onToggle:     (key: string) => void;
  onSelectUser: (user: User) => void;
}) {
  const open = expanded.has(node.key);
  const total = countUsers(node);

  return (
    <div className={s.group}>
      <button
        type="button"
        className={s.groupHeader}
        data-level={node.level}
        onClick={() => onToggle(node.key)}
        aria-expanded={open}
      >
        <svg
          className={`${s.chevron} ${open ? s.chevronOpen : ""}`}
          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
        >
          <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <span className={s.groupTitle}>{groupLabel(node.name, node.code)}</span>
        <span className={s.count}>{total}</span>
      </button>

      {open && (
        <div className={s.groupBody}>
          {node.children.map((child) => (
            <GroupBlock
              key={child.key}
              node={child}
              expanded={expanded}
              onToggle={onToggle}
              onSelectUser={onSelectUser}
            />
          ))}
          {node.users.map((user) => (
            <button
              key={user.id}
              type="button"
              className={s.userRow}
              onClick={() => onSelectUser(user)}
              title={userFullLabel(user)}
            >
              <span
                className={s.userAvatar}
                style={{ background: gradientCssFor(user.display_name) }}
              >
                {user.display_name.charAt(0).toUpperCase()}
              </span>
              <span className={s.userText}>
                <span className={s.userLabel}>{userFullLabel(user)}</span>
                <span className={s.userSub}>@{user.username}</span>
              </span>
              <span className={s.chatIcon} aria-hidden>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
                </svg>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function UserDirectory({ token, search, onSelectUser }: Props) {
  const [users, setUsers]       = useState<User[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    userApi.directory(token)
      .then((list) => {
        if (cancelled) return;
        setUsers(list ?? []);
        const tree = buildUserTree(list ?? []);
        const keys = new Set<string>();
        for (const o of tree) {
          keys.add(o.key);
          for (const u of o.children) keys.add(u.key);
        }
        setExpanded(keys);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [token]);

  const tree = useMemo(() => {
    const built = buildUserTree(users);
    return filterUserTree(built, search);
  }, [users, search]);

  useEffect(() => {
    if (!search.trim()) return;
    setExpanded(new Set(collectNodeKeys(tree)));
  }, [search, tree]);

  const toggle = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  if (loading) return <p className={s.loading}>Foydalanuvchilar yuklanmoqda…</p>;
  if (error)   return <p className={s.error}>{error}</p>;
  if (tree.length === 0) {
    return (
      <p className={s.empty}>
        {search.trim() ? "Qidiruv bo'yicha topilmadi" : "Foydalanuvchilar yo'q"}
      </p>
    );
  }

  return (
    <div className={s.org} role="tree" aria-label="Foydalanuvchilar katalogi">
      {tree.map((node) => (
        <GroupBlock
          key={node.key}
          node={node}
          expanded={expanded}
          onToggle={toggle}
          onSelectUser={onSelectUser}
        />
      ))}
    </div>
  );
}
