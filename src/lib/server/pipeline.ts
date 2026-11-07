import { CATEGORIES } from "../categories";
import { appendHistory, growthFromHistory, growthFromStargazers, mergeGrowth, type History } from "../growth";
import { deriveInstall } from "../install";
import { isValidSnapshot } from "../select";
import type { Enrichment, Period, RepoRecord, Snapshot, SnapshotRepo } from "../types";
import { enrichMany, enrichWithKeywords, llmEnabled, type EnrichInput } from "./enrich";
import { GitHubClient, GitHubError, type FetchLike, type RepoWithStars, type StargazerPage } from "./github";
import { verifyRegistries } from "./registry";
import { readJSON, writeJSON } from "./store";

const DAY = 24 * 3600 * 1000;

export const POOL_LIMIT = 320;
export const MAX_STARGAZER_PAGES = 4; // 400 most recent stars per repo
export const MAX_NEW_ENRICHMENTS = 40; // per hourly run
export const SOFT_DEADLINE_MS = 200_000; // stay well below maxDuration=300s

export type EnrichedCache = Record<string, Enrichment>;

export interface RefreshDeps {
  github?: GitHubClient;
  fetchImpl?: FetchLike;
  now?: number;
  useLLM?: boolean;
  enrich?: typeof enrichMany;
}

export interface RefreshResult {
  ok: boolean;
  repos: number;
  newlyEnriched: number;
  githubRequests: number;
  durationMs: number;
  warnings: string[];
}

export function buildSearchQueries(now: number): Array<{ q: string; first: number }> {
  const d = (days: number) => new Date(now - days * DAY).toISOString().slice(0, 10);
  const queries = [
    { q: `created:>${d(30)} stars:>100 sort:stars-desc`, first: 100 },
    { q: `created:>${d(7)} stars:>20 sort:stars-desc`, first: 50 },
    { q: `created:>${d(365)} pushed:>${d(7)} stars:>2000 sort:stars-desc`, first: 60 },
  ];
  for (const cat of CATEGORIES) {
    cat.searchTopics.slice(0, 2).forEach((topic) => {
      queries.push({ q: `topic:${topic} created:>${d(365)} pushed:>${d(14)} stars:>200 sort:stars-desc`, first: 8 });
    });
    if (cat.searchTopics[0]) {
      queries.push({ q: `topic:${cat.searchTopics[0]} pushed:>${d(7)} stars:>1000 sort:stars-desc`, first: 5 });
    }
  }
  return queries;
}

function toRecord(r: RepoWithStars, growth: RepoRecord["growth"]): RepoRecord {
  const spdx = r.licenseInfo?.spdxId ?? null;
  return {
    id: r.nameWithOwner,
    url: r.url,
    homepage: r.homepageUrl?.trim() ? r.homepageUrl.trim() : null,
    description: r.description,
    language: r.primaryLanguage?.name ?? null,
    license: spdx && spdx !== "NOASSERTION" ? spdx : r.licenseInfo ? "NOASSERTION" : null,
    stars: r.stargazerCount,
    forks: r.forkCount,
    createdAt: r.createdAt,
    pushedAt: r.pushedAt,
    topics: r.repositoryTopics.nodes.map((n) => n.topic.name),
    archived: r.isArchived,
    growth,
  };
}

async function safeRead<T>(key: Parameters<typeof readJSON>[0], warnings: string[]): Promise<T | null> {
  try {
    return await readJSON<T>(key);
  } catch (err) {
    warnings.push(`read ${key} failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Hourly job: discover candidates, measure star growth, enrich new repos, write snapshot.
 * Never overwrites a good snapshot with a broken one – on failure the old one stays live.
 */
export async function refreshUniverse(deps: RefreshDeps = {}): Promise<RefreshResult> {
  const started = Date.now();
  const now = deps.now ?? started;
  const warnings: string[] = [];
  const timeLeft = () => SOFT_DEADLINE_MS - (Date.now() - started);

  const token = process.env.GITHUB_TOKEN;
  if (!deps.github && !token) throw new Error("GITHUB_TOKEN is not set");
  const gh = deps.github ?? new GitHubClient({ token: token!, fetchImpl: deps.fetchImpl });

  const [previous, enrichedCache, history] = await Promise.all([
    safeRead<Snapshot>("snapshot.json", warnings),
    safeRead<EnrichedCache>("enriched.json", warnings),
    safeRead<History>("history.json", warnings),
  ]);
  const prevLive = previous && isValidSnapshot(previous, 1) && previous.source === "live" ? previous : null;
  const enriched: EnrichedCache = enrichedCache ?? {};
  const hist: History = history ?? {};

  // 1) Candidate pool: fresh search results + what we showed last time.
  let searchIds: string[] = [];
  try {
    searchIds = await gh.searchRepoIds(buildSearchQueries(now));
  } catch (err) {
    if (!prevLive) throw err;
    warnings.push(`search failed, reusing previous pool: ${err instanceof Error ? err.message : String(err)}`);
  }
  const prevIds = (prevLive?.repos ?? [])
    .slice()
    .sort((a, b) => (b.growth["7d"]?.value ?? 0) - (a.growth["7d"]?.value ?? 0))
    .map((r) => r.id);
  const pool = [...new Set([...searchIds, ...prevIds])].slice(0, POOL_LIMIT);

  // 2) Metadata + first stargazer page.
  const fetched = (await gh.fetchReposWithStars(pool)).filter((r) => !r.isPrivate && !r.isFork);
  if (fetched.length === 0) throw new GitHubError("GitHub returned no repositories");

  // 3) Page further back where the first 100 stars don't cover 30 days.
  const stamps = new Map<string, number[]>();
  const lastPage = new Map<string, StargazerPage>();
  for (const r of fetched) {
    stamps.set(r.nameWithOwner, r.stargazers.edges.map((e) => Date.parse(e.starredAt)));
    lastPage.set(r.nameWithOwner, r.stargazers);
  }
  const monthAgo = now - 30 * DAY;
  const needsMore = (id: string) => {
    const page = lastPage.get(id)!;
    const ts = stamps.get(id)!;
    return page.pageInfo.hasNextPage && page.pageInfo.endCursor && ts.length > 0 && Math.min(...ts) > monthAgo;
  };
  const createdById = new Map(fetched.map((r) => [r.nameWithOwner, Date.parse(r.createdAt)]));
  for (let round = 1; round < MAX_STARGAZER_PAGES; round++) {
    if (timeLeft() < 90_000) {
      warnings.push("skipped deeper stargazer pages (time budget)");
      break;
    }
    const todo = fetched
      .map((r) => r.nameWithOwner)
      .filter((id) => (createdById.get(id) ?? 0) < monthAgo && needsMore(id))
      .map((id) => ({ id, after: lastPage.get(id)!.pageInfo.endCursor! }));
    if (!todo.length) break;
    try {
      const pages = await gh.fetchStargazerPages(todo);
      pages.forEach((page, id) => {
        stamps.get(id)!.push(...page.edges.map((e) => Date.parse(e.starredAt)));
        lastPage.set(id, page);
      });
    } catch (err) {
      warnings.push(`stargazer paging stopped: ${err instanceof Error ? err.message : String(err)}`);
      break;
    }
  }

  // 4) Growth = exact stargazer counts > own history > extrapolation > previous value.
  const prevById = new Map((prevLive?.repos ?? []).map((r) => [r.id, r]));
  const records: RepoRecord[] = fetched.map((r) => {
    const id = r.nameWithOwner;
    const page = lastPage.get(id)!;
    const fromStars = growthFromStargazers(
      { timestamps: stamps.get(id)!, complete: !page.pageInfo.hasNextPage },
      { now, totalStars: r.stargazerCount, createdAt: r.createdAt },
    );
    const fromHist = growthFromHistory(hist[id], now, r.stargazerCount);
    return toRecord(r, mergeGrowth(fromStars, fromHist, prevById.get(id)?.growth ?? null));
  });

  // 5) History: append current counts; forget repos that left the pool.
  const nextHist: History = {};
  for (const r of records) nextHist[r.id] = appendHistory(hist[r.id], now, r.stars);

  // 6) Enrichment for repos we have not seen yet (or only keyword-classified before a key existed).
  const useLLM = deps.useLLM ?? llmEnabled();
  const byMomentum = (p: Period) => (a: RepoRecord, b: RepoRecord) => (b.growth[p]?.value ?? 0) - (a.growth[p]?.value ?? 0);
  const todoEnrich = records
    .filter((r) => !enriched[r.id] || (useLLM && enriched[r.id].source === "keywords"))
    .sort(byMomentum("7d"))
    .slice(0, timeLeft() > 60_000 ? MAX_NEW_ENRICHMENTS : 0);

  let newlyEnriched = 0;
  if (todoEnrich.length) {
    try {
      const files = await gh.fetchRepoFiles(todoEnrich.map((r) => r.id));
      const filesById = new Map(files.map((f) => [f.id, f]));
      const inputs: EnrichInput[] = todoEnrich.map((r) => ({
        id: r.id,
        description: r.description,
        topics: r.topics,
        language: r.language,
        readme: filesById.get(r.id)?.readme ?? null,
      }));
      const results = await (deps.enrich ?? enrichMany)(inputs, { useLLM });
      await Promise.all(
        todoEnrich.map(async (r) => {
          const f = filesById.get(r.id);
          const res = results.get(r.id);
          if (!res) return;
          let install = enriched[r.id]?.install ?? null;
          if (f) {
            const manifest = { repoId: r.id, files: f.files, contents: f.contents, hasMainRs: f.hasMainRs, language: r.language };
            const verified = await verifyRegistries(manifest, deps.fetchImpl ?? fetch);
            install = deriveInstall({ ...manifest, verified });
          }
          enriched[r.id] = { ...res, install, enrichedAt: new Date(now).toISOString() };
          newlyEnriched++;
        }),
      );
    } catch (err) {
      warnings.push(`enrichment failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 7) Assemble snapshot. Repos without a cached enrichment get a temporary keyword one.
  const repos: SnapshotRepo[] = records.map((r) => ({
    ...r,
    enrichment: enriched[r.id] ?? {
      ...enrichWithKeywords({ id: r.id, description: r.description, topics: r.topics, language: r.language, readme: null }),
      install: null,
      enrichedAt: new Date(now).toISOString(),
    },
  }));
  const snapshot: Snapshot = { version: 1, generatedAt: new Date(now).toISOString(), source: "live", repos };

  if (!isValidSnapshot(snapshot, 20)) {
    throw new Error(`refusing to write snapshot with only ${repos.length} repos`);
  }

  // Enrichment cache first (expensive to recreate), snapshot last.
  await writeJSON("enriched.json", enriched);
  await writeJSON("history.json", nextHist);
  await writeJSON("snapshot.json", snapshot);

  return {
    ok: true,
    repos: repos.length,
    newlyEnriched,
    githubRequests: gh.requests,
    durationMs: Date.now() - started,
    warnings,
  };
}
