export function getYesterdayISO(nowTs: number = Date.now()): string {
  // Subtract 24 hours, then format using the user's *local* timezone.
  const d = new Date(nowTs - 24 * 60 * 60 * 1000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

