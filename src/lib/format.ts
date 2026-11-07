import type { GrowthMethod, Period } from "./types";

const nf = new Intl.NumberFormat("de-DE");
const compact = new Intl.NumberFormat("de-DE", { notation: "compact", maximumFractionDigits: 1 });

export function formatNumber(n: number): string {
  return nf.format(n);
}

export function formatCompact(n: number): string {
  return n < 10_000 ? nf.format(n) : compact.format(n);
}

const PERIOD_PHRASE: Record<Period, string> = { "24h": "in 24 h", "7d": "in 7 Tagen", "30d": "in 30 Tagen" };

export function formatGrowth(value: number | null, method: GrowthMethod | null, period: Period): string {
  if (value === null) return "keine Daten";
  return `${method === "estimated" ? "≈ " : ""}+${formatCompact(value)} ${PERIOD_PHRASE[period]}`;
}

const rtf = new Intl.RelativeTimeFormat("de", { numeric: "auto" });

/** "vor 5 Minuten", "vor 3 Stunden", "vor 2 Tagen" … */
export function formatRelative(iso: string | null, now: number): string {
  if (!iso) return "unbekannt";
  const diff = (Date.parse(iso) - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return "gerade eben";
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86_400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86_400 * 60) return rtf.format(Math.round(diff / 86_400), "day");
  if (abs < 86_400 * 730) return rtf.format(Math.round(diff / (86_400 * 30)), "month");
  return rtf.format(Math.round(diff / (86_400 * 365)), "year");
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "long", year: "numeric" });
}

/** Only allow http(s) links from untrusted repo metadata. */
export function safeExternalUrl(url: string | null): string | null {
  if (!url) return null;
  const withProto = /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`;
  try {
    const u = new URL(withProto);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}
