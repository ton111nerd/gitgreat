import { CATEGORY_IDS, type Period, type Snapshot, type SnapshotRepo, type UniversePayload, type UniverseRepo } from "./types";
import { computeTrust } from "./trust";

export const MAX_REPOS_PER_PERIOD = 150;
export const MIN_PER_CATEGORY = 3;

/**
 * Picks the repos shown for a period: the strongest movers, plus a few per category
 * so every galaxy has something to explore.
 */
export function selectForPeriod(repos: SnapshotRepo[], period: Period, limit = MAX_REPOS_PER_PERIOD): SnapshotRepo[] {
  const usable = repos.filter((r) => !r.archived);
  const score = (r: SnapshotRepo) => r.growth[period]?.value ?? -1;
  const sorted = [...usable].sort((a, b) => score(b) - score(a) || b.stars - a.stars);
  const chosen = new Set(sorted.slice(0, limit));
  for (const cat of CATEGORY_IDS) {
    const have = [...chosen].filter((r) => r.enrichment.category === cat).length;
    if (have >= MIN_PER_CATEGORY) continue;
    const extra = sorted.filter((r) => r.enrichment.category === cat && !chosen.has(r)).slice(0, MIN_PER_CATEGORY - have);
    extra.forEach((r) => chosen.add(r));
  }
  return sorted.filter((r) => chosen.has(r));
}

export function toUniverseRepo(r: SnapshotRepo, period: Period, now: number): UniverseRepo {
  const [owner, name] = r.id.split("/");
  const g = r.growth[period];
  return {
    id: r.id,
    owner,
    name,
    url: r.url,
    homepage: r.homepage,
    description: r.description,
    explanation: r.enrichment.explanation || r.description || "Keine Beschreibung vorhanden.",
    explanationSource: r.enrichment.source,
    category: r.enrichment.category,
    language: r.language,
    license: r.license,
    stars: r.stars,
    forks: r.forks,
    createdAt: r.createdAt,
    pushedAt: r.pushedAt,
    topics: r.topics,
    growth: g?.value ?? null,
    growthMethod: g?.method ?? null,
    install: r.enrichment.install,
    trust: computeTrust(r, now),
  };
}

export function buildPayload(snapshot: Snapshot, period: Period, notice: string | null): UniversePayload {
  const now = Date.parse(snapshot.generatedAt) || 0;
  return {
    period,
    generatedAt: snapshot.generatedAt,
    source: snapshot.source,
    notice,
    repos: selectForPeriod(snapshot.repos, period).map((r) => toUniverseRepo(r, period, now)),
  };
}

/** Minimal structural validation before a snapshot is trusted or written. */
export function isValidSnapshot(value: unknown, minRepos = 10): value is Snapshot {
  if (!value || typeof value !== "object") return false;
  const s = value as Partial<Snapshot>;
  return (
    s.version === 1 &&
    typeof s.generatedAt === "string" &&
    !Number.isNaN(Date.parse(s.generatedAt)) &&
    Array.isArray(s.repos) &&
    s.repos.length >= minRepos &&
    s.repos.every((r) => typeof r?.id === "string" && typeof r?.stars === "number" && r?.enrichment && r?.growth)
  );
}
