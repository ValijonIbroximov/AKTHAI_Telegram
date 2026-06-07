import type { User } from "@/types";

export interface OrgGroupNode {
  key:   string;
  name:  string;
  code:  string;
  level: "okrug" | "unit" | "division";
  children: OrgGroupNode[];
  users:    User[];
}

const UNKNOWN_OKRUG  = "Aniqlanmagan okrug";
const UNKNOWN_UNIT   = "Aniqlanmagan qism";
const UNKNOWN_DIV    = "Aniqlanmagan bo'linma";

const RANK_ABBR: Record<string, string> = {
  kursant:   "k-nt",
  serzhant:  "srj",
  leytenant: "lt",
  kapitan:   "k-pt",
  mayor:     "may",
  polkovnik: "polk",
};

function str(v: string | null | undefined, fallback: string): string {
  const t = v?.trim();
  return t || fallback;
}

function code(v: string | null | undefined, fallback: string): string {
  const t = v?.trim();
  return t || fallback;
}

/** Unvon qisqartmasi: kursant → k-nt */
export function abbrevRank(rank: string | null | undefined): string {
  if (!rank?.trim()) return "";
  const key = rank.trim().toLowerCase();
  if (RANK_ABBR[key]) return RANK_ABBR[key]!;
  if (key.length <= 4) return key;
  return key.slice(0, 2) + "-" + key.slice(-2);
}

/** Familiya + bosh harflar: Ibroximov Valijon → Ibroximov V. */
export function formatNameShort(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return displayName;
  const surname = parts[0]!;
  const initials = parts.slice(1, 3).map((p) => p.charAt(0).toUpperCase()).join(".");
  return initials ? `${surname} ${initials}.` : surname;
}

/** Qisqa yorliq: k-nt Ibroximov V.A. */
export function userShortLabel(user: User): string {
  if (user.display_short?.trim()) return user.display_short.trim();
  const rankAbbr = abbrevRank(user.rank_title);
  const nameShort = formatNameShort(user.display_name);
  return rankAbbr ? `${rankAbbr} ${nameShort}` : nameShort;
}

/** To'liq yorliq: kursant Ibroximov V.A. (k-nt Ibroximov V.A.) */
export function userFullLabel(user: User): string {
  const rank = user.rank_title?.trim();
  const full = rank ? `${rank} ${user.display_name}` : user.display_name;
  const short = userShortLabel(user);
  return `${full} (${short})`;
}

/** Guruh sarlavhasi: Toshkent harbiy okrugi (THO) */
export function groupLabel(name: string, groupCode: string): string {
  if (groupCode && groupCode !== "—" && !name.includes(`(${groupCode})`)) {
    return `${name} (${groupCode})`;
  }
  return name;
}

function findOrCreateGroup(
  list: OrgGroupNode[],
  key: string,
  name: string,
  groupCode: string,
  level: OrgGroupNode["level"],
): OrgGroupNode {
  let node = list.find((n) => n.key === key);
  if (!node) {
    node = { key, name, code: groupCode, level, children: [], users: [] };
    list.push(node);
  }
  return node;
}

export function buildUserTree(users: User[]): OrgGroupNode[] {
  const okrugs: OrgGroupNode[] = [];

  for (const user of users) {
    const okrugName = str(user.okrug_name, UNKNOWN_OKRUG);
    const okrugCode = code(user.okrug_code, "—");
    const unitName  = str(user.unit_name, UNKNOWN_UNIT);
    const unitCode  = code(user.unit_code, "—");
    const divName   = str(user.division_name, UNKNOWN_DIV);
    const divCode   = code(user.division_code, "—");

    const okrugKey = `okrug:${okrugCode}:${okrugName}`;
    const unitKey  = `unit:${okrugKey}:${unitCode}:${unitName}`;
    const divKey   = `div:${unitKey}:${divCode}:${divName}`;

    const okrug = findOrCreateGroup(okrugs, okrugKey, okrugName, okrugCode, "okrug");
    const unit  = findOrCreateGroup(okrug.children, unitKey, unitName, unitCode, "unit");
    const div   = findOrCreateGroup(unit.children, divKey, divName, divCode, "division");
    div.users.push(user);
  }

  const sortGroups = (nodes: OrgGroupNode[]): OrgGroupNode[] =>
    nodes
      .map((n) => ({
        ...n,
        children: sortGroups(n.children),
        users: [...n.users].sort((a, b) => a.display_name.localeCompare(b.display_name, "uz")),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "uz"));

  return sortGroups(okrugs);
}

/** Qidiruv — foydalanuvchi mos kelsa butun tarmoq saqlanadi */
export function filterUserTree(nodes: OrgGroupNode[], query: string): OrgGroupNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return nodes;

  const matchUser = (u: User): boolean => {
    const hay = [
      u.display_name, u.username, u.rank_title,
      u.okrug_name, u.okrug_code, u.unit_name, u.unit_code,
      u.division_name, u.division_code, u.display_short,
      userFullLabel(u), userShortLabel(u),
    ].filter(Boolean).join(" ").toLowerCase();
    return hay.includes(q);
  };

  const walk = (list: OrgGroupNode[]): OrgGroupNode[] => {
    const out: OrgGroupNode[] = [];
    for (const node of list) {
      const users = node.users.filter(matchUser);
      const children = walk(node.children);
      const nameHit = `${node.name} ${node.code}`.toLowerCase().includes(q);
      if (users.length > 0 || children.length > 0 || nameHit) {
        out.push({
          ...node,
          users,
          children: nameHit ? node.children : children,
        });
      }
    }
    return out;
  };

  return walk(nodes);
}

/** Barcha tugun kalitlari — qidiruvda avtomatik ochish uchun */
export function collectNodeKeys(nodes: OrgGroupNode[]): string[] {
  const keys: string[] = [];
  const walk = (list: OrgGroupNode[]) => {
    for (const n of list) {
      keys.push(n.key);
      walk(n.children);
    }
  };
  walk(nodes);
  return keys;
}
