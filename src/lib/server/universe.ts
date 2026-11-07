import { cacheLife, cacheTag } from "next/cache";
import fallbackData from "../../../data/fallback.json";
import { buildPayload, isValidSnapshot } from "../select";
import type { Period, Snapshot, UniversePayload } from "../types";
import { readJSON } from "./store";

export const UNIVERSE_TAG = "universe";

const FALLBACK = fallbackData as unknown as Snapshot;
const FALLBACK_NOTICE =
  "Live-Daten sind gerade nicht verfügbar – du siehst einen gespeicherten Stand bekannter Repositories (ohne Wachstumsdaten).";

/** Last snapshot that loaded successfully in this server instance. */
let lastGood: Snapshot | null = null;

/**
 * Loads the newest snapshot written by the hourly cron job.
 * Order: persisted snapshot → last good in-memory copy → bundled fallback.json.
 * User requests NEVER reach GitHub or Anthropic – only our own store.
 */
export async function loadSnapshot(): Promise<{ snapshot: Snapshot; notice: string | null }> {
  try {
    const snap = await readJSON<Snapshot>("snapshot.json");
    if (isValidSnapshot(snap)) {
      lastGood = snap;
      return { snapshot: snap, notice: null };
    }
  } catch (err) {
    console.error("[universe] reading snapshot failed:", err instanceof Error ? err.message : err);
  }
  if (lastGood) return { snapshot: lastGood, notice: null };
  return { snapshot: FALLBACK, notice: FALLBACK_NOTICE };
}

/** Cached read model – revalidated every 5 minutes or when the cron job tags it stale. */
export async function getUniverse(period: Period): Promise<UniversePayload> {
  "use cache";
  cacheLife({ stale: 300, revalidate: 300, expire: 86_400 });
  cacheTag(UNIVERSE_TAG);
  const { snapshot, notice } = await loadSnapshot();
  return buildPayload(snapshot, period, notice);
}
