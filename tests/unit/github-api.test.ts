import { describe, expect, it, vi } from "vitest";
import { GitHubClient, GitHubError } from "@/lib/server/github";

vi.mock("next/cache", () => ({ revalidateTag: vi.fn(), cacheLife: vi.fn(), cacheTag: vi.fn() }));

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

describe("GitHubClient", () => {
  it("batches searches with aliases and de-duplicates ids", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init!.body));
      expect(body.query).toContain("s0: search(");
      expect(body.variables.q0).toBe("stars:>1");
      expect(init!.headers).toMatchObject({ Authorization: "Bearer t0k" });
      return jsonResponse(
        { data: { s0: { nodes: [{ nameWithOwner: "a/b" }, { nameWithOwner: "c/d" }] }, s1: { nodes: [{ nameWithOwner: "a/b" }, null] } } },
        200,
        { "x-ratelimit-remaining": "4999" },
      );
    });
    const gh = new GitHubClient({ token: "t0k", fetchImpl: fetchImpl as unknown as typeof fetch });
    const ids = await gh.searchRepoIds([{ q: "stars:>1", first: 10 }, { q: "x", first: 5 }]);
    expect(ids).toEqual(["a/b", "c/d"]);
    expect(gh.remaining).toBe(4999);
  });

  it("skips repositories that GraphQL reports as NOT_FOUND", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ data: { r0: null, r1: { nameWithOwner: "x/y", stargazers: { pageInfo: {}, edges: [] } } }, errors: [{ type: "NOT_FOUND", message: "gone" }] }),
    );
    const gh = new GitHubClient({ token: "t", fetchImpl: fetchImpl as unknown as typeof fetch });
    const repos = await gh.fetchReposWithStars(["gone/repo", "x/y"]);
    expect(repos.map((r) => r.nameWithOwner)).toEqual(["x/y"]);
  });

  it("raises a rate-limit error on 403 and stops when the budget is low", async () => {
    const gh = new GitHubClient({ token: "t", fetchImpl: (async () => jsonResponse({}, 403)) as unknown as typeof fetch });
    await expect(gh.searchRepoIds([{ q: "x", first: 1 }])).rejects.toMatchObject({ rateLimited: true });

    const low = new GitHubClient({ token: "t", fetchImpl: vi.fn() as unknown as typeof fetch, minRemaining: 100 });
    low.remaining = 10;
    await expect(low.graphql("query{viewer{login}}")).rejects.toBeInstanceOf(GitHubError);
  });
});

describe("cron route", () => {
  it("rejects requests without the CRON_SECRET bearer token", async () => {
    process.env.CRON_SECRET = "s3cret";
    const { GET } = await import("@/app/api/cron/refresh/route");
    const { NextRequest } = await import("next/server");
    const res = await GET(new NextRequest("http://localhost/api/cron/refresh", { headers: { authorization: "Bearer wrong" } }));
    expect(res.status).toBe(401);
    delete process.env.CRON_SECRET;
    const res2 = await GET(new NextRequest("http://localhost/api/cron/refresh", { headers: { authorization: "Bearer " } }));
    expect(res2.status).toBe(401);
  });
});
