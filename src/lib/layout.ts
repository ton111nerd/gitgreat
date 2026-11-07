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

const MIN_R = 3;
const MAX_R = 26;
const LOG_MIN = 2; // 100 stars
const LOG_MAX = Math.log10(600_000);

/** Planet size: logarithmic in total stars, fixed bounds so sizes compare across periods. */
export function planetRadius(stars: number): number {
  const t = (Math.log10(Math.max(stars, 1)) - LOG_MIN) / (LOG_MAX - LOG_MIN);
  return MIN_R + (MAX_R - MIN_R) * Math.min(1, Math.max(0, t));
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

/** Packs planets of one galaxy on a golden-angle spiral, then relaxes overlaps. */
function packGalaxy(planets: Planet[]): number {
  const sorted = planets.sort((a, b) => b.repo.stars - a.repo.stars);
  const avgD = sorted.reduce((s, p) => s + p.r * 2, 0) / Math.max(1, sorted.length);
  const spacing = avgD * 1.05 + 6;
  sorted.forEach((p, i) => {
    const angle = i * 2.399963 + hash(p.repo.id) * 0.4;
    const dist = spacing * Math.sqrt(i) * 0.95;
    p.x = Math.cos(angle) * dist;
    p.y = Math.sin(angle) * dist;
  });
  const gap = 5;
  for (let iter = 0; iter < 80; iter++) {
    let moved = false;
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const a = sorted[i];
        const b = sorted[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 0.01;
        const min = a.r + b.r + gap;
        if (d < min) {
          const push = (min - d) / 2;
          const ux = dx / d;
          const uy = dy / d;
          a.x -= ux * push;
          a.y -= uy * push;
          b.x += ux * push;
          b.y += uy * push;
          moved = true;
        }
      }
    }
    // gentle gravity keeps the cluster round
    for (const p of sorted) {
      p.x *= 0.995;
      p.y *= 0.995;
    }
    if (!moved && iter > 10) break;
  }
  return sorted.reduce((m, p) => Math.max(m, Math.hypot(p.x, p.y) + p.r), 30) + 36;
}

/**
 * Deterministic layout: one galaxy per category. The biggest galaxy sits in the centre,
 * the others orbit it on a ring (angular share proportional to their size).
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
    return { id: c.id, x: 0, y: 0, radius: packGalaxy(planets), planets };
  });

  if (galaxies.length > 1) {
    const [center, ...ring] = [...galaxies].sort((a, b) => b.planets.length - a.planets.length);
    const gap = 70;
    const maxRing = Math.max(...ring.map((g) => g.radius));
    const circumference = ring.reduce((s, g) => s + g.radius * 2 + gap, 0);
    const R = Math.max(center.radius + maxRing + gap, circumference / (2 * Math.PI));
    // keep the category order of CATEGORIES around the ring
    const ordered = CATEGORIES.map((c) => ring.find((g) => g.id === c.id)).filter((g): g is Galaxy => Boolean(g));
    let angle = -Math.PI / 2;
    const total = ordered.reduce((s, g) => s + g.radius * 2 + gap, 0);
    for (const g of ordered) {
      const share = ((g.radius * 2 + gap) / total) * Math.PI * 2;
      angle += share / 2;
      g.x = Math.cos(angle) * R;
      g.y = Math.sin(angle) * R * 0.82; // slight ellipse – reads better on wide screens
      angle += share / 2;
    }
    center.x = 0;
    center.y = 0;
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
      minY: Math.min(b.minY, g.y - g.radius - 30),
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
  f: { query: string; categories: Set<CategoryId>; language: string },
): boolean {
  if (f.categories.size && !f.categories.has(repo.category)) return false;
  if (f.language && repo.language !== f.language) return false;
  const q = f.query.trim().toLowerCase();
  if (!q) return true;
  return [repo.id, repo.description ?? "", repo.explanation, repo.topics.join(" ")].some((s) => s.toLowerCase().includes(q));
}
