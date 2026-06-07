/** Chat sarlavhasi uchun onlayn / so'nggi faollik matni (o'zbekcha). */
export function formatPeerStatus(
  isOnline: boolean,
  lastSeenAt: string | null | undefined,
  lastSeenHidden = false,
): string {
  if (isOnline) return "onlayn";
  if (lastSeenHidden) return "So'nggi faolligi yashirilgan";
  if (!lastSeenAt) return "offline";

  const seen = new Date(lastSeenAt);
  if (Number.isNaN(seen.getTime())) return "offline";

  const now     = new Date();
  const diffMs  = now.getTime() - seen.getTime();
  const diffMin = Math.floor(diffMs / 60_000);

  if (diffMin < 1) return "So'nggi faollik hozirgina";
  if (diffMin < 60) return `So'nggi faollik ${diffMin} daqiqa oldin`;

  const timeStr = seen.toLocaleTimeString("uz-UZ", {
    hour:   "2-digit",
    minute: "2-digit",
  });

  if (seen.toDateString() === now.toDateString()) {
    return `So'nggi faollik bugun ${timeStr} da`;
  }

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (seen.toDateString() === yesterday.toDateString()) {
    return `So'nggi faollik kecha ${timeStr} da`;
  }

  const days = Math.floor(diffMs / 86_400_000);
  if (days < 7) {
    const weekday = seen.toLocaleDateString("uz-UZ", { weekday: "long" });
    return `So'nggi faollik ${weekday} ${timeStr} da`;
  }

  const dateStr = seen.toLocaleDateString("uz-UZ", {
    day:   "2-digit",
    month: "2-digit",
    year:  "numeric",
  });
  return `So'nggi faollik ${dateStr} da`;
}
