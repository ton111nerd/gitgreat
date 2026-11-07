import { PERIODS, PERIOD_HOURS, type GrowthValue, type Period } from "./types";

const HOUR = 3600 * 1000;

export interface StargazerSample {
  /** starredAt timestamps (ms), any order. */
  timestamps: number[];
  /** true when we paged back far enough (or ran out of stargazers). */
  complete: boolean;
}

/**
 * Star growth per period from the most recent stargazer timestamps.
 * - If the sample reaches back past the period start (or is complete): exact count.
 * - If the repo is younger than the period: all its stars are growth (exact).
 * - Otherwise: linear extrapolation from the covered time span (marked "estimated").
 */
export function growthFromStargazers(
  sample: StargazerSample,
  opts: { now: number; totalStars: number; createdAt: string },
): Record<Period, GrowthValue | null> {
  const out = {} as Record<Period, GrowthValue | null>;
  const ts = sample.timestamps.filter((t) => Number.isFinite(t) && t <= opts.now);
  const oldest = ts.length ? Math.min(...ts) : null;
  const created = Date.parse(opts.createdAt);

  for (const p of PERIODS) {
    const start = opts.now - PERIOD_HOURS[p] * HOUR;
    const inWindow = ts.filter((t) => t > start).length;

    if (!Number.isNaN(created) && created >= start) {
      out[p] = { value: opts.totalStars, method: "exact" };
    } else if (sample.complete || (oldest !== null && oldest <= start)) {
      out[p] = { value: inWindow, method: "exact" };
    } else if (oldest !== null && inWindow > 0) {
      const span = Math.max(opts.now - oldest, HOUR);
      const est = Math.round((inWindow * (PERIOD_HOURS[p] * HOUR)) / span);
      out[p] = { value: Math.min(est, opts.totalStars), method: "estimated" };
    } else {
      out[p] = null;
    }
  }
  return out;
}

/** history: [epochSeconds, stars][] sorted ascending */
export type HistoryPoints = Array<[number, number]>;
export type History = Record<string, HistoryPoints>;

/** Star difference against our own earlier snapshot, if one exists close to the period start. */
export function growthFromHistory(points: HistoryPoints | undefined, now: number, currentStars: number): Record<Period, GrowthValue | null> {
  const out = {} as Record<Period, GrowthValue | null>;
  for (const p of PERIODS) {
    out[p] = null;
    if (!points?.length) continue;
    const target = (now - PERIOD_HOURS[p] * HOUR) / 1000;
    const tolerance = (p === "24h" ? 2 : 8) * 3600;
    let best: [number, number] | null = null;
    for (const pt of points) {
      if (Math.abs(pt[0] - target) <= tolerance && (!best || Math.abs(pt[0] - target) < Math.abs(best[0] - target))) best = pt;
    }
    if (best) out[p] = { value: Math.max(0, currentStars - best[1]), method: "history" };
  }
  return out;
}

/** Prefer exact stargazer counts, then our own history, then extrapolation. */
export function mergeGrowth(
  fromStars: Record<Period, GrowthValue | null> | null,
  fromHistory: Record<Period, GrowthValue | null>,
  previous: Record<Period, GrowthValue | null> | null,
): Record<Period, GrowthValue | null> {
  const out = {} as Record<Period, GrowthValue | null>;
  for (const p of PERIODS) {
    const s = fromStars?.[p] ?? null;
    const h = fromHistory[p];
    if (s?.method === "exact") out[p] = s;
    else if (h) out[p] = h;
    else if (s) out[p] = s;
    else out[p] = previous?.[p] ?? null;
  }
  return out;
}

/** Appends a data point and thins old data: hourly for 48h, every 6h up to 32 days. */
export function appendHistory(points: HistoryPoints | undefined, nowMs: number, stars: number): HistoryPoints {
  const now = Math.floor(nowMs / 1000);
  const all = [...(points ?? []), [now, stars] as [number, number]].sort((a, b) => a[0] - b[0]);
  const kept: HistoryPoints = [];
  const seenBuckets = new Set<string>();
  for (let i = all.length - 1; i >= 0; i--) {
    const [t] = all[i];
    const age = now - t;
    if (age > 32 * 86400) continue;
    const bucket = age <= 48 * 3600 ? `h${Math.floor(t / 3600)}` : `q${Math.floor(t / (6 * 3600))}`;
    if (seenBuckets.has(bucket)) continue;
    seenBuckets.add(bucket);
    kept.push(all[i]);
  }
  return kept.reverse();
}
