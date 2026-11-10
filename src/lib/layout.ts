import { CATEGORIES } from "./categories";
import type { CategoryId, UniverseRepo } from "./types";

export interface Planet {
  repo: UniverseRepo;
  x: number;
  y: number;
  r: number;
  /** 0..1 momentum (glow intensity), relative to the strongest mover in the dataset. */
  momentum: number;
  /** Stable pseudo-random phase for the pulse animation. */
  phase: number;
}

export interface Galaxy {
  id: CategoryId;
  x: number;
  y: number;
  radius: number;
  planets: Planet[];
}

export interface UniverseLayout {
  galaxies: Galaxy[];
  planets: Planet[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  hasGrowth: boolean;
}

/** World units per sqrt(star): the planet's AREA is proportional to its stars. */
export const STAR_SCALE = 0.155;
/** Floor so that very small repos stay visible and clickable. */
export const MIN_RADIUS = 2.2;

/**
 * Planet size: area proportional to total stars (radius ∝ √stars) – a repo with
 * 4× the stars covers 4× the area. Only repos below ~200 stars hit the floor.
 */
export function planetRadius(stars: number): number {
  return Math.max(MIN_RADIUS, STAR_SCALE * Math.sqrt(Math.max(0, stars)));
}

/** Glow: log-scaled growth relative to the dataset maximum. */
export function momentumOf(growth: number | null, maxGrowth: number): number {
  if (growth === null || maxGrowth <= 0) return 0;
  return Math.min(1, Math.log1p(Math.max(0, growth)) / Math.log1p(maxGrowth));
}

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

export interface Circle {
  x: number;
  y: number;
  r: number;
}

/**
 * Greedy circle packing for very different sizes: biggest first in the centre, every
 * following circle takes the free spot closest to the centre (searched on rings).
 * Deterministic. Mutates x/y and returns the radius of the enclosing circle.
 */
export function packCircles<T extends Circle>(items: T[], gap: number): number {
  const sorted = [...items].sort((a, b) => b.r - a.r);
  const placed: T[] = [];
  let startD = 0;
  let extent = 0;
  sorted.forEach((c, index) => {
    if (index === 0) {
      c.x = 0;
      c.y = 0;
    } else {
      const step = Math.max(1.5, c.r * 0.3);
      const offset = index * 2.399963;
      let found = false;
      for (let d = Math.max(0, startD); !found; d += step) {
        const n = Math.max(8, Math.ceil((2 * Math.PI * d) / step));
        for (let i = 0; i < n && !found; i++) {
          const a = offset + (i / n) * Math.PI * 2;
          const x = Math.cos(a) * d;
          const y = Math.sin(a) * d;
          let free = true;
          for (const p of placed) {
            const min = p.r + c.r + gap;
            const dx = p.x - x;
            const dy = p.y - y;
            if (dx * dx + dy * dy < min * min) {
              free = false;
              break;
            }
          }
          if (free) {
            c.x = x;
            c.y = y;
            found = true;
            // the next (smaller or equal) circle cannot fit much closer than this one did
            startD = d - c.r * 2 - gap - step;
          }
        }
      }
    }
    placed.push(c);
    extent = Math.max(extent, Math.hypot(c.x, c.y) + c.r);
  });
  return extent;
}

/**
 * Deterministic layout: one galaxy per category, planets packed inside,
 * galaxies packed around the biggest one.
 */
export function computeLayout(repos: UniverseRepo[]): UniverseLayout {
  const maxGrowth = repos.reduce((m, r) => Math.max(m, r.growth ?? 0), 0);
  const hasGrowth = repos.some((r) => r.growth !== null);
  const byCat = new Map<CategoryId, Planet[]>();
  for (const repo of repos) {
    const planet: Planet = {
      repo,
      x: 0,
      y: 0,
      r: planetRadius(repo.stars),
      momentum: hasGrowth ? momentumOf(repo.growth, maxGrowth) : 0.2,
      phase: hash(repo.id) * Math.PI * 2,
    };
    if (!byCat.has(repo.category)) byCat.set(repo.category, []);
    byCat.get(repo.category)!.push(planet);
  }

  const galaxies: Galaxy[] = CATEGORIES.filter((c) => byCat.get(c.id)?.length).map((c) => {
    const planets = byCat.get(c.id)!;
    return { id: c.id, x: 0, y: 0, radius: packCircles(planets, 5) + 34, planets };
  });

  // pack galaxies as circles; `r` aliases radius for the packer
  const proxies = galaxies.map((g) => ({ g, x: 0, y: 0, r: g.radius }));
  packCircles(proxies, 46);
  for (const p of proxies) {
    p.g.x = p.x;
    p.g.y = p.y;
  }

  const planets: Planet[] = [];
  for (const g of galaxies) {
    for (const p of g.planets) {
      p.x += g.x;
      p.y += g.y;
      planets.push(p);
    }
  }
  const bounds = galaxies.reduce(
    (b, g) => ({
      minX: Math.min(b.minX, g.x - g.radius),
      minY: Math.min(b.minY, g.y - g.radius),
      maxX: Math.max(b.maxX, g.x + g.radius),
      maxY: Math.max(b.maxY, g.y + g.radius),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
  if (!galaxies.length) Object.assign(bounds, { minX: -100, minY: -100, maxX: 100, maxY: 100 });
  return { galaxies, planets, bounds, hasGrowth };
}

export function matchesFilter(
  repo: UniverseRepo,
  f: { query: string; category: CategoryId | null; language: string },
): boolean {
  if (f.category && repo.category !== f.category) return false;
  if (f.language && repo.language !== f.language) return false;
  const q = f.query.trim().toLowerCase();
  if (!q) return true;
  return [repo.id, repo.description ?? "", repo.explanation, repo.topics.join(" ")].some((s) => s.toLowerCase().includes(q));
}
