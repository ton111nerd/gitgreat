import type { TrustResult, TrustSignal, TrustStatus } from "./types";

const DAY = 24 * 60 * 60 * 1000;

export interface TrustInput {
  license: string | null;
  createdAt: string;
  pushedAt: string | null;
  stars: number;
  forks: number;
  archived?: boolean;
}

/** Popularity is flagged as unusual when many stars meet almost no forks. */
export const UNUSUAL_MIN_STARS = 500;
export const UNUSUAL_MAX_FORK_RATIO = 0.01;

function daysBetween(fromIso: string | null, now: number): number | null {
  if (!fromIso) return null;
  const t = Date.parse(fromIso);
  return Number.isNaN(t) ? null : Math.max(0, (now - t) / DAY);
}

function fmtDays(days: number): string {
  if (days < 1) return "vor weniger als einem Tag";
  if (days < 2) return "vor 1 Tag";
  if (days < 60) return `vor ${Math.round(days)} Tagen`;
  if (days < 730) return `vor ${Math.round(days / 30)} Monaten`;
  return `vor ${Math.round(days / 365)} Jahren`;
}

/**
 * Traffic light from four signals: license, repo age, activity, forks/stars ratio.
 * `now` is passed in so results are deterministic (we use the snapshot time).
 */
export function computeTrust(input: TrustInput, now: number): TrustResult {
  const signals: TrustSignal[] = [];

  // 1. License
  const lic = input.license?.trim() || null;
  if (!lic) {
    signals.push({ id: "license", status: "bad", label: "Keine Lizenz", detail: "Ohne Lizenz ist die Nutzung rechtlich nicht geregelt." });
  } else if (lic === "NOASSERTION" || /^other$/i.test(lic)) {
    signals.push({ id: "license", status: "warn", label: "Lizenz unklar", detail: "Eine Lizenzdatei existiert, ist aber kein Standard – bitte selbst prüfen." });
  } else {
    signals.push({ id: "license", status: "good", label: `Lizenz: ${lic}`, detail: "Standard-Lizenz vorhanden." });
  }

  // 2. Age
  const age = daysBetween(input.createdAt, now);
  if (age === null) {
    signals.push({ id: "age", status: "warn", label: "Alter unbekannt", detail: "Erstellungsdatum fehlt." });
  } else if (age >= 180) {
    signals.push({ id: "age", status: "good", label: "Etabliert", detail: `Erstellt ${fmtDays(age)}.` });
  } else {
    signals.push({ id: "age", status: "warn", label: "Sehr neu", detail: `Erstellt ${fmtDays(age)} – neue Projekte ändern sich oft noch stark.` });
  }

  // 3. Activity
  const sincePush = daysBetween(input.pushedAt, now);
  if (input.archived) {
    signals.push({ id: "activity", status: "bad", label: "Archiviert", detail: "Das Projekt wird nicht mehr gepflegt." });
  } else if (sincePush === null) {
    signals.push({ id: "activity", status: "warn", label: "Aktivität unbekannt", detail: "Kein Datum des letzten Pushs." });
  } else if (sincePush <= 30) {
    signals.push({ id: "activity", status: "good", label: "Aktiv gepflegt", detail: `Letzte Änderung ${fmtDays(sincePush)}.` });
  } else if (sincePush <= 180) {
    signals.push({ id: "activity", status: "warn", label: "Wenig Aktivität", detail: `Letzte Änderung ${fmtDays(sincePush)}.` });
  } else {
    signals.push({ id: "activity", status: "bad", label: "Inaktiv", detail: `Letzte Änderung ${fmtDays(sincePush)}.` });
  }

  // 4. Forks/Stars ratio
  const ratio = input.stars > 0 ? input.forks / input.stars : 0;
  const unusualPopularity = input.stars >= UNUSUAL_MIN_STARS && ratio < UNUSUAL_MAX_FORK_RATIO;
  if (unusualPopularity) {
    signals.push({
      id: "ratio",
      status: "bad",
      label: "Popularität ungewöhnlich",
      detail: `Sehr viele Stars, aber kaum Forks (${(ratio * 100).toFixed(1)} %). Das kann auf gekaufte Stars hindeuten.`,
    });
  } else if (input.stars >= UNUSUAL_MIN_STARS && ratio < 0.02) {
    signals.push({ id: "ratio", status: "warn", label: "Wenige Forks", detail: `Forks/Stars = ${(ratio * 100).toFixed(1)} % – eher niedrig.` });
  } else {
    signals.push({ id: "ratio", status: "good", label: "Stimmiges Verhältnis", detail: `Forks/Stars = ${(ratio * 100).toFixed(1)} %.` });
  }

  const weight: Record<TrustStatus, number> = { good: 2, warn: 1, bad: 0 };
  const score = signals.reduce((s, x) => s + weight[x.status], 0);
  const bad = signals.filter((s) => s.status === "bad").length;

  let level: TrustResult["level"];
  if (unusualPopularity || bad >= 2 || score <= 3) level = "red";
  else if (score === signals.length * 2) level = "green"; // every signal good

  else level = "yellow";

  const summary =
    level === "green"
      ? "Solide Signale"
      : level === "yellow"
        ? "Mit Vorsicht prüfen"
        : unusualPopularity
          ? "Popularität ungewöhnlich"
          : "Auffällige Signale";

  return { level, summary, unusualPopularity, signals };
}
