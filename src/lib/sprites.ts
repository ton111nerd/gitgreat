"use client";

/**
 * Procedural planet and nebula sprites for the 2D explorer canvas.
 * Rendered once per category/variant into offscreen canvases (pixel-level shading:
 * banded surfaces, lambert lighting with a soft terminator, fresnel atmosphere),
 * then drawn scaled with drawImage – cheap per frame, realistic look.
 */

import { CATEGORIES } from "./categories";
import type { CategoryId } from "./types";

const PLANET_PX = 232; // sphere diameter in the sprite
export const PLANET_PAD = 0.32; // halo margin relative to radius
export const VARIANTS = 4;

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function makeNoise(seed: number) {
  const perm = new Uint8Array(512);
  const p = new Uint8Array(256).map((_, i) => i);
  let s = seed * 9301 + 49297;
  for (let i = 255; i > 0; i--) {
    s = (s * 9301 + 49297) % 233280;
    const j = Math.floor((s / 233280) * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const grad = (h: number, x: number, y: number) => ((h & 1 ? -x : x) + (h & 2 ? -y : y));
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const noise = (x: number, y: number) => {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    x -= Math.floor(x);
    y -= Math.floor(y);
    const u = fade(x);
    const v = fade(y);
    const a = perm[X] + Y;
    const b = perm[X + 1] + Y;
    const l1 = grad(perm[a], x, y) + u * (grad(perm[b], x - 1, y) - grad(perm[a], x, y));
    const l2 = grad(perm[a + 1], x, y - 1) + u * (grad(perm[b + 1], x - 1, y - 1) - grad(perm[a + 1], x, y - 1));
    return l1 + v * (l2 - l1); // ~[-1,1]
  };
  return (x: number, y: number, oct = 5) => {
    let v = 0;
    let a = 0.5;
    let f = 1;
    for (let i = 0; i < oct; i++) {
      v += a * noise(x * f, y * f);
      f *= 2.03;
      a *= 0.5;
    }
    return v * 0.5 + 0.5;
  };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

function renderPlanet(color: string, variant: number): HTMLCanvasElement {
  const R = PLANET_PX / 2;
  const side = Math.ceil(PLANET_PX * (1 + PLANET_PAD));
  const c = document.createElement("canvas");
  c.width = side;
  c.height = side;
  const g = c.getContext("2d")!;
  const img = g.createImageData(side, side);
  const data = img.data;
  const fbm = makeNoise(variant * 31 + color.length * 7 + parseInt(color.slice(1, 3), 16));
  const [cr, cg, cb] = hexToRgb(color);
  const base: [number, number, number] = [cr / 255, cg / 255, cb / 255];
  const dark: [number, number, number] = base.map((v) => v * 0.32 + 0.02) as [number, number, number];
  const mid: [number, number, number] = base.map((v) => v * 0.9 + 0.04) as [number, number, number];
  const light: [number, number, number] = base.map((v) => lerp(v, 1, 0.55)) as [number, number, number];
  const L = [-0.42, -0.4, 0.81]; // light from the front top-left (screen y down)
  const Ln = Math.hypot(L[0], L[1], L[2]);
  const lx = L[0] / Ln;
  const ly = L[1] / Ln;
  const lz = L[2] / Ln;
  const kind = variant % 2 === 0 ? "gas" : "rock";
  const tilt = (variant * 0.37) % 0.6 - 0.3;
  const rot = variant * 1.7;
  const cx = side / 2;
  const cy = side / 2;

  for (let py = 0; py < side; py++) {
    for (let px = 0; px < side; px++) {
      const dx = (px + 0.5 - cx) / R;
      const dy = (py + 0.5 - cy) / R;
      const r2 = dx * dx + dy * dy;
      const dist = Math.sqrt(r2);
      const i = (py * side + px) * 4;
      let rr = 0;
      let gg = 0;
      let bb = 0;
      let aa = 0;
      if (dist < 1) {
        const nz = Math.sqrt(1 - r2);
        // tilted texture coordinates
        const ty = dy * Math.cos(tilt) + dx * Math.sin(tilt);
        const tx = dx * Math.cos(tilt) - dy * Math.sin(tilt);
        const lon = Math.atan2(tx, nz) + rot;
        const lat = Math.asin(Math.max(-1, Math.min(1, ty)));
        let f: number;
        if (kind === "gas") {
          const warp = fbm(lon * 1.2, lat * 2.0, 4);
          f = fbm(lon * 0.45, lat * 3.4 + warp * 1.8, 5);
        } else {
          f = fbm(lon * 1.6 + 10, lat * 1.6 + 4, 6);
          f = smooth(0.35, 0.75, f) * 0.85 + fbm(lon * 6, lat * 6, 3) * 0.15;
        }
        let sr = lerp(dark[0], mid[0], f);
        let sg = lerp(dark[1], mid[1], f);
        let sb = lerp(dark[2], mid[2], f);
        const hi = smooth(0.58, 0.82, f) * 0.6;
        sr = lerp(sr, light[0], hi);
        sg = lerp(sg, light[1], hi);
        sb = lerp(sb, light[2], hi);
        const ndl = dx * lx + dy * ly + nz * lz;
        const diff = smooth(-0.15, 1, ndl);
        const shade = 0.1 + 1.05 * diff;
        const fres = Math.pow(1 - nz, 2.4) * smooth(-0.3, 0.6, ndl);
        rr = sr * shade + light[0] * fres * 0.65;
        gg = sg * shade + light[1] * fres * 0.65;
        bb = sb * shade + light[2] * fres * 0.65;
        aa = 1 - smooth(1 - 1.6 / R, 1, dist); // anti-aliased limb
        // soft halo under the limb anti-aliasing
        const halo = 0.55 * smooth(-0.4, 0.9, (dx * lx + dy * ly) / Math.max(dist, 1e-3));
        rr = rr * aa + light[0] * halo * (1 - aa);
        gg = gg * aa + light[1] * halo * (1 - aa);
        bb = bb * aa + light[2] * halo * (1 - aa);
        aa = Math.max(aa, halo * 0.6 * (1 - aa));
      } else {
        const d = dist - 1;
        const side2 = smooth(-0.5, 0.9, (dx * lx + dy * ly) / dist);
        const halo = (Math.exp(-d * 16) * 0.65 + Math.exp(-d * 5) * 0.12) * (0.18 + side2);
        rr = light[0];
        gg = light[1];
        bb = light[2];
        aa = clamp01(halo);
      }
      // tone map + premultiply-free output
      data[i] = Math.round(255 * (1 - Math.exp(-rr * 1.6)));
      data[i + 1] = Math.round(255 * (1 - Math.exp(-gg * 1.6)));
      data[i + 2] = Math.round(255 * (1 - Math.exp(-bb * 1.6)));
      data[i + 3] = Math.round(255 * clamp01(aa));
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

function renderNebula(color: string, seed: number): HTMLCanvasElement {
  const side = 200;
  const c = document.createElement("canvas");
  c.width = side;
  c.height = side;
  const g = c.getContext("2d")!;
  const img = g.createImageData(side, side);
  const fbm = makeNoise(seed);
  const [cr, cg, cb] = hexToRgb(color);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const nx = x / side - 0.5;
      const ny = y / side - 0.5;
      const r = Math.hypot(nx, ny) * 2;
      const warp = fbm(nx * 3 + 5, ny * 3 + 1, 4);
      const n = fbm(nx * 4 + warp * 2.2, ny * 4 - warp * 1.4, 6);
      const falloff = Math.pow(clamp01(1 - r), 1.6);
      const density = clamp01((n - 0.32) * 1.9) * falloff;
      const core = Math.exp(-r * r * 9) * 0.35;
      const a = clamp01(density * 0.85 + core);
      const i = (y * side + x) * 4;
      const white = core * 0.6;
      img.data[i] = Math.round(lerp(cr, 255, white));
      img.data[i + 1] = Math.round(lerp(cg, 255, white));
      img.data[i + 2] = Math.round(lerp(cb, 255, white));
      img.data[i + 3] = Math.round(255 * a);
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

const planetCache = new Map<string, HTMLCanvasElement>();
const nebulaCache = new Map<CategoryId, HTMLCanvasElement>();

export function planetSprite(category: CategoryId, variant: number): HTMLCanvasElement {
  const key = `${category}:${variant % VARIANTS}`;
  let s = planetCache.get(key);
  if (!s) {
    const color = CATEGORIES.find((c) => c.id === category)!.color;
    s = renderPlanet(color, variant % VARIANTS);
    planetCache.set(key, s);
  }
  return s;
}

export function nebulaSprite(category: CategoryId): HTMLCanvasElement {
  let s = nebulaCache.get(category);
  if (!s) {
    const idx = CATEGORIES.findIndex((c) => c.id === category);
    s = renderNebula(CATEGORIES[idx].color, idx * 13 + 5);
    nebulaCache.set(category, s);
  }
  return s;
}

/**
 * Pre-renders all sprites in small chunks (one per macrotask) so the first frame
 * of the fly-in does not stall. Resolves when everything is cached.
 */
export function warmSprites(categories: CategoryId[]): Promise<void> {
  const jobs: Array<() => void> = [];
  for (const c of categories) {
    jobs.push(() => nebulaSprite(c));
    for (let v = 0; v < VARIANTS; v++) jobs.push(() => planetSprite(c, v));
  }
  return new Promise((resolve) => {
    const next = () => {
      const job = jobs.shift();
      if (!job) return resolve();
      job();
      setTimeout(next, 0);
    };
    next();
  });
}
