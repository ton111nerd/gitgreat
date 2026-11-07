import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitHubClient, GitHubError, type RepoFiles, type RepoWithStars } from "@/lib/server/github";
import { refreshUniverse } from "@/lib/server/pipeline";
import { readJSON, writeJSON } from "@/lib/server/store";
import { buildPayload } from "@/lib/select";
import type { Snapshot } from "@/lib/types";

const NOW = Date.parse("2026-11-07T12:00:00Z");
const DAY = 86_400_000;

function fakeRepo(i: number, opts: Partial<RepoWithStars> = {}): RepoWithStars {
  const starsPerDay = 50 + i;
  return {
    nameWithOwner: `org${i}/repo${i}`,
    url: `https://github.com/org${i}/repo${i}`,
    homepageUrl: i % 2 ? `https://repo${i}.dev` : "",
    description: i % 3 === 0 ? "An LLM agent framework" : "A fast web framework for react apps",
    stargazerCount: 5000 + i,
    forkCount: 400,
    createdAt: new Date(NOW - 400 * DAY).toISOString(),
    pushedAt: new Date(NOW - DAY).toISOString(),
    isArchived: false,
    isFork: false,
    isPrivate: false,
    primaryLanguage: { name: i % 2 ? "TypeScript" : "Go" },
    licenseInfo: { spdxId: "MIT", name: "MIT License" },
    repositoryTopics: { nodes: [{ topic: { name: i % 3 === 0 ? "llm" : "react" } }] },
    stargazers: {
      pageInfo: { hasNextPage: true, endCursor: `c${i}` },
      edges: Array.from({ length: 100 }, (_, k) => ({ starredAt: new Date(NOW - (k / starsPerDay) * DAY).toISOString() })),
    },
    ...opts,
  };
}

function fakeGitHub(repos: RepoWithStars[], overrides: Partial<Record<keyof GitHubClient, unknown>> = {}): GitHubClient {
  return {
    requests: 0,
    remaining: 5000,
    searchRepoIds: vi.fn(async () => repos.map((r) => r.nameWithOwner)),
    fetchReposWithStars: vi.fn(async (ids: string[]) => repos.filter((r) => ids.includes(r.nameWithOwner))),
    fetchStargazerPages: vi.fn(async (reqs: Array<{ id: string }>) => {
      const m = new Map();
      for (const r of reqs) {
        m.set(r.id, {
          pageInfo: { hasNextPage: false, endCursor: null },
          edges: Array.from({ length: 50 }, (_, k) => ({ starredAt: new Date(NOW - (3 + k) * DAY).toISOString() })),
        });
      }
      return m;
    }),
    fetchRepoFiles: vi.fn(async (ids: string[]): Promise<RepoFiles[]> =>
      ids.map((id) => ({ id, files: ["go.mod", "main.go"], contents: { "go.mod": `module github.com/${id}\n` }, hasMainRs: false, readme: "# Hi" })),
    ),
    ...overrides,
  } as unknown as GitHubClient;
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "universe-"));
  process.env.DATA_DIR = dir;
  delete process.env.BLOB_READ_WRITE_TOKEN;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

describe("refreshUniverse", () => {
  it("writes a snapshot with growth, enrichment and install commands", async () => {
    const repos = Array.from({ length: 30 }, (_, i) => fakeRepo(i));
    const gh = fakeGitHub(repos);
    const res = await refreshUniverse({ github: gh, now: NOW, useLLM: false, fetchImpl: vi.fn() as never });
    expect(res.ok).toBe(true);
    expect(res.repos).toBe(30);

    const snap = (await readJSON<Snapshot>("snapshot.json"))!;
    expect(snap.source).toBe("live");
    const r0 = snap.repos.find((r) => r.id === "org0/repo0")!;
    expect(r0.growth["24h"]?.method).toBe("exact");
    expect(r0.growth["24h"]?.value).toBe(50);
    expect(r0.enrichment.category).toBe("ai");
    expect(r0.enrichment.source).toBe("keywords");
    expect(r0.enrichment.install?.command).toBe("go install github.com/org0/repo0@latest");
    expect(r0.homepage).toBeNull();

    const hist = await readJSON<Record<string, unknown[]>>("history.json");
    expect(Object.keys(hist!)).toHaveLength(30);

    const payload = buildPayload(snap, "7d", null);
    expect(payload.repos.length).toBe(30);
    expect(payload.repos[0].growth).toBeGreaterThanOrEqual(payload.repos[1].growth!);
  });

  it("reuses cached enrichments instead of enriching again", async () => {
    const repos = Array.from({ length: 25 }, (_, i) => fakeRepo(i));
    await refreshUniverse({ github: fakeGitHub(repos), now: NOW, useLLM: false, fetchImpl: vi.fn() as never });
    const enrich = vi.fn(async () => new Map());
    const gh2 = fakeGitHub(repos);
    const res = await refreshUniverse({ github: gh2, now: NOW + 3600_000, useLLM: false, enrich, fetchImpl: vi.fn() as never });
    expect(res.newlyEnriched).toBe(0);
    expect(gh2.fetchRepoFiles).not.toHaveBeenCalled();
  });

  it("keeps the previous snapshot when GitHub fails", async () => {
    const repos = Array.from({ length: 25 }, (_, i) => fakeRepo(i));
    await refreshUniverse({ github: fakeGitHub(repos), now: NOW, useLLM: false, fetchImpl: vi.fn() as never });
    const before = await readJSON<Snapshot>("snapshot.json");

    const broken = fakeGitHub(repos, {
      fetchReposWithStars: vi.fn(async () => {
        throw new GitHubError("rate limited", 403, true);
      }),
    });
    await expect(refreshUniverse({ github: broken, now: NOW + 3600_000, useLLM: false })).rejects.toThrow(/rate limited/);
    expect(await readJSON<Snapshot>("snapshot.json")).toEqual(before);
  });

  it("refuses to overwrite with a tiny snapshot", async () => {
    await writeJSON("snapshot.json", { marker: true });
    const gh = fakeGitHub([fakeRepo(1), fakeRepo(2)]);
    await expect(refreshUniverse({ github: gh, now: NOW, useLLM: false, fetchImpl: vi.fn() as never })).rejects.toThrow(/refusing/);
    expect(await readJSON("snapshot.json")).toEqual({ marker: true });
  });

  it("falls back to the previous pool when search fails", async () => {
    const repos = Array.from({ length: 25 }, (_, i) => fakeRepo(i));
    await refreshUniverse({ github: fakeGitHub(repos), now: NOW, useLLM: false, fetchImpl: vi.fn() as never });
    const gh = fakeGitHub(repos, { searchRepoIds: vi.fn(async () => { throw new Error("search down"); }) });
    const res = await refreshUniverse({ github: gh, now: NOW + 3600_000, useLLM: false, fetchImpl: vi.fn() as never });
    expect(res.ok).toBe(true);
    expect(res.repos).toBe(25);
    expect(res.warnings.join(" ")).toMatch(/search failed/);
  });
});
