import { describe, expect, it } from "vitest";
import { computeLayout, packCircles, planetRadius } from "@/lib/layout";
import fallback from "../../data/fallback.json";
import { buildPayload } from "@/lib/select";
import type { Snapshot } from "@/lib/types";

describe("planetRadius", () => {
  it("makes the planet area proportional to stars", () => {
    const area = (stars: number) => Math.PI * planetRadius(stars) ** 2;
    expect(area(40_000) / area(10_000)).toBeCloseTo(4, 5);
    expect(area(500_000) / area(5_000)).toBeCloseTo(100, 5);
  });
  it("keeps tiny repos visible", () => {
    expect(planetRadius(3)).toBeGreaterThan(2);
  });
});

describe("packing", () => {
  it("packs circles of very different sizes without overlap", () => {
    const circles = Array.from({ length: 120 }, (_, i) => ({ x: 0, y: 0, r: planetRadius(100 + ((i * 7919) % 400) ** 2.2) }));
    const extent = packCircles(circles, 4);
    for (let i = 0; i < circles.length; i++) {
      for (let j = i + 1; j < circles.length; j++) {
        const d = Math.hypot(circles[i].x - circles[j].x, circles[i].y - circles[j].y);
        expect(d).toBeGreaterThanOrEqual(circles[i].r + circles[j].r + 4 - 1e-6);
      }
    }
    // reasonably dense: enclosing area at most ~3.5× the summed circle area
    const sum = circles.reduce((s, c) => s + c.r * c.r, 0);
    expect(extent * extent).toBeLessThan(sum * 3.5);
  });

  it("lays out the fallback universe with separated galaxies, deterministically", () => {
    const repos = buildPayload(fallback as unknown as Snapshot, "7d", null).repos;
    const a = computeLayout(repos);
    const b = computeLayout(repos);
    expect(a.planets.map((p) => [p.x, p.y])).toEqual(b.planets.map((p) => [p.x, p.y]));
    expect(a.galaxies.length).toBe(9);
    for (let i = 0; i < a.galaxies.length; i++) {
      for (let j = i + 1; j < a.galaxies.length; j++) {
        const g = a.galaxies[i];
        const h = a.galaxies[j];
        expect(Math.hypot(g.x - h.x, g.y - h.y)).toBeGreaterThanOrEqual(g.radius + h.radius);
      }
    }
  });
});
