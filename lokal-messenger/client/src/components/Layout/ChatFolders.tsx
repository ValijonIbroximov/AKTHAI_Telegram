import s from "./ChatFolders.module.css";

export type FolderId = "all" | "unread" | "groups" | "channels";

interface Folder {
  id:    FolderId;
  icon:  React.ReactNode;
  label: string;
}

const FOLDERS: Folder[] = [
  {
    id:    "all",
    label: "Barcha chatlar",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    id:    "unread",
    label: "O'qilmagan",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    id:    "groups",
    label: "Guruhlar",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" strokeLinecap="round"/>
        <circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    id:    "channels",
    label: "Kanallar",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M22 16.92v3a2 2 0 01-2.18 2A19.79 19.79 0 0112 18.43a19.5 19.5 0 01-5-5 19.79 19.79 0 01-3.49-7.84 2 2 0 011.99-2.18h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L9.09 11a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.34 1.85.573 2.81.7A2 2 0 0122 16.92z" strokeLinecap="round"/>
        <path d="M14.5 2C16.4 2.8 18 4.4 18.5 6.5M14.5 6c1 .5 1.8 1.3 2 2.5" strokeLinecap="round"/>
      </svg>
    ),
  },
];

interface Props {
  activeFolder:   FolderId;
  onFolderChange: (id: FolderId) => void;
}

export default function ChatFolders({ activeFolder, onFolderChange }: Props) {
  return (
    <aside className={s.panel} aria-label="Chat papkalari">
      {FOLDERS.map((f) => (
        <button
          key={f.id}
          type="button"
          className={`${s.item} ${activeFolder === f.id ? s.active : ""}`}
          onClick={() => onFolderChange(f.id)}
          title={f.label}
          aria-label={f.label}
          aria-pressed={activeFolder === f.id}
        >
          <span className={s.icon}>{f.icon}</span>
          <span className={s.label}>{f.label}</span>
        </button>
      ))}
    </aside>
  );
}
