import { describe, expect, it } from "vitest";
import { classifyByKeywords } from "@/lib/categories";
import { appendHistory, growthFromHistory, growthFromStargazers, mergeGrowth } from "@/lib/growth";
import { computeTrust } from "@/lib/trust";

const NOW = Date.parse("2026-11-07T12:00:00Z");
const DAY = 86_400_000;
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

describe("computeTrust", () => {
  it("is green for an established, active, licensed repo", () => {
    const t = computeTrust({ license: "MIT", createdAt: iso(800 * DAY), pushedAt: iso(DAY), stars: 10_000, forks: 900 }, NOW);
    expect(t.level).toBe("green");
    expect(t.unusualPopularity).toBe(false);
  });

  it("flags unusual popularity (many stars, almost no forks)", () => {
    const t = computeTrust({ license: "MIT", createdAt: iso(400 * DAY), pushedAt: iso(DAY), stars: 20_000, forks: 50 }, NOW);
    expect(t.unusualPopularity).toBe(true);
    expect(t.level).toBe("red");
    expect(t.signals.find((s) => s.id === "ratio")?.label).toBe("Popularität ungewöhnlich");
  });

  it("is yellow for a brand-new repo without other problems", () => {
    const t = computeTrust({ license: "Apache-2.0", createdAt: iso(5 * DAY), pushedAt: iso(0), stars: 800, forks: 60 }, NOW);
    expect(t.level).toBe("yellow");
  });

  it("is red without license and inactive", () => {
    const t = computeTrust({ license: null, createdAt: iso(900 * DAY), pushedAt: iso(400 * DAY), stars: 100, forks: 10 }, NOW);
    expect(t.level).toBe("red");
  });
});

describe("growthFromStargazers", () => {
  it("counts exactly when the sample reaches past the period", () => {
    const ts = [0.5, 2, 3, 10, 20, 40].map((d) => NOW - d * DAY);
    const g = growthFromStargazers({ timestamps: ts, complete: false }, { now: NOW, totalStars: 5000, createdAt: iso(500 * DAY) });
    expect(g["24h"]).toEqual({ value: 1, method: "exact" });
    expect(g["7d"]).toEqual({ value: 3, method: "exact" });
    expect(g["30d"]).toEqual({ value: 5, method: "exact" });
  });

  it("extrapolates when only recent stars are known", () => {
    // 100 stars in the last 2 days, more pages exist
    const ts = Array.from({ length: 100 }, (_, i) => NOW - (i / 50) * DAY);
    const g = growthFromStargazers({ timestamps: ts, complete: false }, { now: NOW, totalStars: 100_000, createdAt: iso(900 * DAY) });
    expect(g["24h"]?.method).toBe("exact");
    expect(g["7d"]?.method).toBe("estimated");
    expect(g["7d"]!.value).toBeGreaterThan(300);
    expect(g["30d"]!.value).toBeGreaterThan(g["7d"]!.value);
  });

  it("treats all stars as growth for repos younger than the period", () => {
    const g = growthFromStargazers({ timestamps: [NOW - DAY / 2], complete: false }, { now: NOW, totalStars: 4000, createdAt: iso(3 * DAY) });
    expect(g["7d"]).toEqual({ value: 4000, method: "exact" });
    expect(g["30d"]).toEqual({ value: 4000, method: "exact" });
  });
});

describe("history", () => {
  it("computes deltas against points close to the period start", () => {
    const points: Array<[number, number]> = [
      [(NOW - 7 * DAY) / 1000, 900],
      [(NOW - DAY) / 1000, 980],
    ];
    const g = growthFromHistory(points, NOW, 1000);
    expect(g["24h"]).toEqual({ value: 20, method: "history" });
    expect(g["7d"]).toEqual({ value: 100, method: "history" });
    expect(g["30d"]).toBeNull();
  });

  it("prefers exact over history over estimate", () => {
    const merged = mergeGrowth(
      { "24h": { value: 5, method: "exact" }, "7d": { value: 50, method: "estimated" }, "30d": null },
      { "24h": { value: 9, method: "history" }, "7d": { value: 40, method: "history" }, "30d": null },
      { "24h": null, "7d": null, "30d": { value: 1, method: "exact" } },
    );
    expect(merged["24h"]?.value).toBe(5);
    expect(merged["7d"]?.value).toBe(40);
    expect(merged["30d"]?.value).toBe(1);
  });

  it("thins old history and drops points older than 32 days", () => {
    let pts: Array<[number, number]> = [];
    for (let h = 40 * 24; h >= 0; h--) pts = appendHistory(pts, NOW - h * 3600_000, 1000 - h);
    expect(pts.length).toBeLessThan(200);
    expect(Math.min(...pts.map((p) => p[0]))).toBeGreaterThanOrEqual((NOW - 32 * DAY) / 1000);
  });
});

describe("classifyByKeywords", () => {
  it("maps topics to galaxies", () => {
    expect(classifyByKeywords({ name: "x", description: null, topics: ["llm", "rag"] })).toBe("ai");
    expect(classifyByKeywords({ name: "godot", description: "Multi-platform 2D and 3D game engine", topics: ["game-engine"] })).toBe("games");
    expect(classifyByKeywords({ name: "thing", description: "A collection", topics: [] })).toBe("other");
  });
});
