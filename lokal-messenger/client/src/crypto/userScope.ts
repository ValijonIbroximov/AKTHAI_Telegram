// Faol foydalanuvchi — IndexedDB / SQLite izolyatsiyasi uchun.

let activeUserId: string | null = null;

export function setActiveCryptoUserId(userId: string | null): void {
  activeUserId = userId;
}

export function getActiveCryptoUserId(): string | null {
  return activeUserId;
}

export function scopedIdbName(base = "harbiy-signal"): string {
  return activeUserId ? `${base}-${activeUserId}` : base;
}
