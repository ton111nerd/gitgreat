"use client";

import { select } from "d3-selection";
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from "d3-zoom";
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from "react";
import { CATEGORY_BY_ID } from "@/lib/categories";
import { formatCompact, formatGrowth } from "@/lib/format";
import type { Galaxy, Planet, UniverseLayout } from "@/lib/layout";
import { PLANET_PAD, VARIANTS, nebulaSprite, planetSprite, warmSprites } from "@/lib/sprites";
import type { CategoryId, Period } from "@/lib/types";

export interface SpaceApi {
  zoomBy(factor: number): void;
  /** Fly back to the overview (or the focused galaxy). */
  reset(): void;
  flyTo(id: string): void;
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

interface Props {
  layout: UniverseLayout;
  period: Period;
  isMatch: (id: string) => boolean;
  filterActive: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  reducedMotion: boolean;
  /** Screen areas covered by HUD elements; the camera frames content inside the rest. */
  insets: Insets;
  /** Galaxy the camera should frame; null = whole universe. */
  focusCategory: CategoryId | null;
  /** Play the cinematic fly-in on first render. */
  intro: boolean;
  apiRef?: Ref<SpaceApi>;
  /** Pan offset and ln(zoom relative to the overview) – drives the WebGL backdrop. */
  onCamera?: (x: number, y: number, zoom: number) => void;
  /** Galaxy currently in the middle of the view (when zoomed in), else null. */
  onGalaxyChange?: (id: CategoryId | null) => void;
  /** Sprites are rendered and the first frame is on screen. */
  onReady?: () => void;
}

interface Tip {
  planet: Planet;
  x: number;
  y: number;
  maxX: number;
}

function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a.toFixed(3)})`;
}

/** Category colour lifted towards white – reads as light rather than paint. */
function glowColor(hex: string, a: number, lift = 0.35): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.round(c + (255 - c) * lift));
  return `rgba(${ch[0]},${ch[1]},${ch[2]},${a.toFixed(3)})`;
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3.2);
const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

const MIN_K = 0.004;
const MAX_K = 40;
const INTRO_START = 0.03; // fraction of the overview scale the fly-in starts at
const INTRO_MS = 3400;

export default function SpaceCanvas({
  layout,
  period,
  isMatch,
  filterActive,
  selectedId,
  onSelect,
  reducedMotion,
  insets,
  focusCategory,
  intro,
  apiRef,
  onCamera,
  onGalaxyChange,
  onReady,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const zoomRef = useRef<ZoomBehavior<HTMLCanvasElement, unknown> | null>(null);
  const transformRef = useRef<ZoomTransform>(zoomIdentity);
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  const hoverRef = useRef<string | null>(null);
  const dirtyRef = useRef(true);
  const readyRef = useRef(false);
  const animTokenRef = useRef(0);
  const fitKRef = useRef(1);
  const galaxyRef = useRef<CategoryId | null>(null);
  const fontRef = useRef('system-ui, -apple-system, "Segoe UI", Roboto, sans-serif');
  const displayFontRef = useRef('Georgia, "Times New Roman", serif');
  const [tip, setTip] = useState<Tip | null>(null);
  const [ready, setReady] = useState(false);

  // Latest props for the render loop and event handlers without re-subscribing.
  const propsRef = useRef({ layout, isMatch, filterActive, selectedId, reducedMotion, insets, focusCategory, onCamera, onGalaxyChange, onReady });
  useLayoutEffect(() => {
    propsRef.current = { layout, isMatch, filterActive, selectedId, reducedMotion, insets, focusCategory, onCamera, onGalaxyChange, onReady };
    dirtyRef.current = true;
  }, [layout, isMatch, filterActive, selectedId, reducedMotion, insets, focusCategory, onCamera, onGalaxyChange, onReady]);

  const draw = useCallback((time: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { w, h, dpr } = sizeRef.current;
    const t = transformRef.current;
    const { layout, isMatch, filterActive, selectedId, reducedMotion } = propsRef.current;
    const animate = !reducedMotion;
    const rel = t.k / fitKRef.current; // 1 = overview

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    ctx.setTransform(dpr * t.k, 0, 0, dpr * t.k, dpr * t.x, dpr * t.y);
    const view = { x0: -t.x / t.k, y0: -t.y / t.k, x1: (w - t.x) / t.k, y1: (h - t.y) / t.k };
    const visible = (x: number, y: number, r: number) => x + r > view.x0 && x - r < view.x1 && y + r > view.y0 && y - r < view.y1;

    // galaxies: procedural dust clouds, additive
    ctx.globalCompositeOperation = "lighter";
    for (const g of layout.galaxies) {
      const R = g.radius * 1.5;
      if (!visible(g.x, g.y, R)) continue;
      const dim = filterActive && !g.planets.some((p) => isMatch(p.repo.id));
      ctx.globalAlpha = dim ? 0.1 : 0.46;
      ctx.drawImage(nebulaSprite(g.id), g.x - R, g.y - R, R * 2, R * 2);
    }
    ctx.globalAlpha = 1;

    // momentum glow (additive corona). The radius has a fixed part so that small
    // but fast-growing repos still shine.
    for (const p of layout.planets) {
      if (p.momentum < 0.02 || (filterActive && !isMatch(p.repo.id))) continue;
      const R = p.r * 1.45 + 6 + 44 * p.momentum * p.momentum;
      if (!visible(p.x, p.y, R)) continue;
      let a = 0.1 + 0.6 * p.momentum;
      if (animate && p.momentum > 0.5) a *= 0.8 + 0.2 * Math.sin(time / 700 + p.phase);
      const color = CATEGORY_BY_ID[p.repo.category].color;
      const grad = ctx.createRadialGradient(p.x, p.y, p.r * 0.85, p.x, p.y, R);
      grad.addColorStop(0, glowColor(color, a));
      grad.addColorStop(0.3, glowColor(color, a * 0.38));
      grad.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, R, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";

    // planet bodies (pre-shaded sprites)
    const hover = hoverRef.current;
    for (const p of layout.planets) {
      const S = p.r * (1 + PLANET_PAD);
      if (!visible(p.x, p.y, S + 14 / t.k)) continue;
      const match = !filterActive || isMatch(p.repo.id);
      ctx.globalAlpha = match ? 1 : 0.1;
      if (p.r * t.k < 1.4) {
        ctx.fillStyle = glowColor(CATEGORY_BY_ID[p.repo.category].color, 1, 0.25);
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(p.r, 1.1 / t.k), 0, Math.PI * 2);
        ctx.fill();
      } else {
        const variant = Math.floor((p.phase / (Math.PI * 2)) * VARIANTS);
        ctx.drawImage(planetSprite(p.repo.category, variant), p.x - S, p.y - S, S * 2, S * 2);
      }
      ctx.globalAlpha = 1;
      if (p.repo.id === selectedId || p.repo.id === hover) {
        const sel = p.repo.id === selectedId;
        ctx.strokeStyle = sel ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.5)";
        ctx.lineWidth = (sel ? 1.5 : 1) / t.k;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r + 6 / t.k, 0, Math.PI * 2);
        ctx.stroke();
        if (sel) {
          ctx.strokeStyle = "rgba(255,255,255,0.2)";
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r + 12 / t.k, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }

    // ---- screen-space labels ----
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.lineJoin = "round";
    const font = fontRef.current;
    const display = displayFontRef.current;
    const spacing = (v: string) => {
      if ("letterSpacing" in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = v;
    };
    const placed: Array<[number, number, number, number]> = [];
    const collides = (b: [number, number, number, number]) => placed.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]);

    // galaxy titles: fade in while approaching, fade out once you are deep inside one
    for (const g of layout.galaxies) {
      const screenR = g.radius * t.k;
      const alpha = smoothstep(0.3, 0.85, rel) * (1 - smoothstep(Math.min(w, h) * 0.55, Math.min(w, h) * 0.95, screenR));
      if (alpha < 0.02) continue;
      const sx = g.x * t.k + t.x;
      const sy = (g.y - g.radius) * t.k + t.y + 2;
      if (sx < -200 || sx > w + 200 || sy < -60 || sy > h + 40) continue;
      const cat = CATEGORY_BY_ID[g.id];
      const dim = filterActive && !g.planets.some((p) => isMatch(p.repo.id));
      ctx.globalAlpha = alpha * (dim ? 0.3 : 1);
      const size = Math.max(17, Math.min(26, screenR / 6));
      ctx.font = `italic 400 ${size}px ${display}`;
      spacing("0px");
      const title = cat.label;
      const tw = ctx.measureText(title).width;
      ctx.shadowColor = "rgba(2,3,10,0.9)";
      ctx.shadowBlur = 10;
      ctx.fillStyle = glowColor(cat.color, 1, 0.62);
      ctx.fillText(title, sx, sy - 18);
      ctx.font = `500 11px ${font}`;
      spacing("0.02em");
      const sub = `${g.planets.length} Repos`;
      ctx.fillStyle = "rgba(237,235,228,0.55)";
      ctx.fillText(sub, sx, sy - 2);
      spacing("0px");
      ctx.shadowBlur = 0;
      ctx.shadowColor = "transparent";
      placed.push([sx - tw / 2 - 6, sy - 18 - size, sx + tw / 2 + 6, sy + 4]);
    }
    ctx.globalAlpha = 1;

    // planet names: inside big planets, below smaller ones; hot movers always get one
    const candidates = layout.planets
      .filter(
        (p) =>
          (!filterActive || isMatch(p.repo.id)) &&
          (p.r * t.k >= 13 || p.momentum > 0.85 || p.repo.id === selectedId || p.repo.id === hover) &&
          rel > 0.45,
      )
      .sort(
        (a, b) =>
          Number(b.repo.id === selectedId) - Number(a.repo.id === selectedId) ||
          Number(b.repo.id === hover) - Number(a.repo.id === hover) ||
          b.r - a.r,
      );
    const labelAlpha = smoothstep(0.45, 0.9, rel);
    for (const p of candidates) {
      const sx = p.x * t.k + t.x;
      const cy = p.y * t.k + t.y;
      const sr = p.r * t.k;
      if (sx < -120 || sx > w + 120 || cy + sr < -30 || cy - sr > h + 30) continue;
      const text = p.repo.name;
      const inside = sr >= 36;
      const size = inside ? Math.max(12, Math.min(22, sr / 4.2)) : 12;
      ctx.font = `${inside ? 600 : 500} ${size}px ${font}`;
      let tw = ctx.measureText(text).width;
      const fits = inside && tw < sr * 1.75;
      if (!fits && inside) {
        ctx.font = `500 12px ${font}`;
        tw = ctx.measureText(text).width;
      }
      const ty = fits ? cy + size * 0.1 : cy + sr + 15;
      const box: [number, number, number, number] = [sx - tw / 2 - 4, ty - (fits ? size : 12), sx + tw / 2 + 4, ty + (fits ? size * 0.9 : 5)];
      if (collides(box)) continue;
      placed.push(box);
      ctx.globalAlpha = labelAlpha;
      ctx.lineWidth = fits ? 3.5 : 3;
      ctx.strokeStyle = fits ? "rgba(2,3,10,0.55)" : "rgba(2,3,10,0.85)";
      ctx.strokeText(text, sx, ty);
      ctx.fillStyle = "rgba(240,238,231,0.96)";
      ctx.fillText(text, sx, ty);
      if (fits) {
        const s2 = Math.max(10.5, size * 0.62);
        ctx.font = `500 ${s2}px ${font}`;
        const stars = `★ ${formatCompact(p.repo.stars)}`;
        ctx.strokeText(stars, sx, ty + s2 * 1.45);
        ctx.fillStyle = "rgba(243,214,150,0.9)";
        ctx.fillText(stars, sx, ty + s2 * 1.45);
      }
    }
    ctx.globalAlpha = 1;
    dirtyRef.current = false;
  }, []);

  // render loop
  useEffect(() => {
    let raf = 0;
    const loop = (time: number) => {
      raf = requestAnimationFrame(loop);
      if (!readyRef.current || document.hidden) return;
      if (dirtyRef.current || !propsRef.current.reducedMotion) draw(time);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [draw]);

  /** Centre and size of the screen area not covered by HUD elements. */
  const frame = useCallback(() => {
    const { w, h } = sizeRef.current;
    const i = propsRef.current.insets;
    const aw = Math.max(120, w - i.left - i.right);
    const ah = Math.max(120, h - i.top - i.bottom);
    return { cx: i.left + aw / 2, cy: i.top + ah / 2, aw, ah };
  }, []);

  const fitCircle = useCallback(
    (x: number, y: number, r: number, pad = 0.94) => {
      const { cx, cy, aw, ah } = frame();
      const k = (Math.min(aw, ah) / (2 * r)) * pad;
      return zoomIdentity.translate(cx - x * k, cy - y * k).scale(k);
    },
    [frame],
  );

  const fitAll = useCallback(() => {
    const { cx, cy, aw, ah } = frame();
    const b = propsRef.current.layout.bounds;
    const bw = b.maxX - b.minX || 1;
    const bh = b.maxY - b.minY || 1;
    const k = Math.min(aw / bw, ah / bh) * 0.94;
    return zoomIdentity.translate(cx - ((b.minX + b.maxX) / 2) * k, cy - ((b.minY + b.maxY) / 2) * k).scale(k);
  }, [frame]);

  /** Camera target for the current focus: a galaxy or the whole universe. */
  const focusTransform = useCallback(() => {
    const { layout, focusCategory } = propsRef.current;
    const g = focusCategory ? layout.galaxies.find((x) => x.id === focusCategory) : null;
    return g ? fitCircle(g.x, g.y, g.radius, 0.9) : fitAll();
  }, [fitAll, fitCircle]);

  const planetTransform = useCallback(
    (p: Planet) => {
      const { cx, cy, aw, ah } = frame();
      // show the planet at a comfortable size, whatever its real radius
      const target = Math.min(76, Math.min(aw, ah) * 0.2);
      const k = Math.min(MAX_K, target / p.r);
      return zoomIdentity.translate(cx - p.x * k, cy - p.y * k).scale(k);
    },
    [frame],
  );

  const applyTransform = useCallback((t: ZoomTransform) => {
    const canvas = canvasRef.current;
    if (canvas && zoomRef.current) select(canvas).call(zoomRef.current.transform, t);
  }, []);

  const animateTo = useCallback(
    (target: ZoomTransform, duration = 900, ease: (t: number) => number = easeInOut) => {
      const token = ++animTokenRef.current;
      if (propsRef.current.reducedMotion || duration <= 0) {
        applyTransform(target);
        return;
      }
      const from = transformRef.current;
      const { cx, cy } = frame();
      // interpolate the world point under the frame centre and the zoom (log scale)
      const c0 = { x: (cx - from.x) / from.k, y: (cy - from.y) / from.k };
      const c1 = { x: (cx - target.x) / target.k, y: (cy - target.y) / target.k };
      const start = performance.now();
      const step = (now: number) => {
        if (token !== animTokenRef.current) return;
        const raw = Math.min(1, (now - start) / duration);
        const e = ease(raw);
        const k = Math.exp(Math.log(from.k) + (Math.log(target.k) - Math.log(from.k)) * e);
        const x = c0.x + (c1.x - c0.x) * e;
        const y = c0.y + (c1.y - c0.y) * e;
        applyTransform(zoomIdentity.translate(cx - x * k, cy - y * k).scale(k));
        if (raw < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    },
    [applyTransform, frame],
  );

  // d3-zoom: mouse wheel, trackpad pinch, touch pinch & drag
  useEffect(() => {
    const canvas = canvasRef.current!;
    const z = zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([MIN_K, MAX_K])
      .clickDistance(6)
      .on("zoom", (e: { transform: ZoomTransform; sourceEvent: Event | null }) => {
        if (e.sourceEvent) animTokenRef.current++; // user input cancels camera flights
        const t = e.transform;
        transformRef.current = t;
        dirtyRef.current = true;
        const p = propsRef.current;
        p.onCamera?.(t.x, t.y, Math.log(t.k / fitKRef.current));

        // which galaxy are we in? (centre of the frame inside it, and zoomed in enough)
        const { w, h } = sizeRef.current;
        const i = p.insets;
        const cx = i.left + (w - i.left - i.right) / 2;
        const cy = i.top + (h - i.top - i.bottom) / 2;
        const wx = (cx - t.x) / t.k;
        const wy = (cy - t.y) / t.k;
        let current: Galaxy | null = null;
        if (t.k / fitKRef.current > 1.35) {
          for (const g of p.layout.galaxies) {
            if (Math.hypot(g.x - wx, g.y - wy) < g.radius) current = g;
          }
        }
        const id = current?.id ?? null;
        if (id !== galaxyRef.current) {
          galaxyRef.current = id;
          p.onGalaxyChange?.(id);
        }
        setTip(null);
      });
    zoomRef.current = z;
    select(canvas).call(z).on("dblclick.zoom", null);
    return () => {
      select(canvas).on(".zoom", null);
    };
  }, []);

  // canvas sizing
  useEffect(() => {
    const wrap = wrapRef.current!;
    const canvas = canvasRef.current!;
    const ro = new ResizeObserver(() => {
      const rect = wrap.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const first = sizeRef.current.w === 0;
      sizeRef.current = { w: rect.width, h: rect.height, dpr };
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      dirtyRef.current = true;
      if (!first && readyRef.current) fitKRef.current = fitAll().k;
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [fitAll]);

  // start-up: render sprites, then place the camera (with the fly-in when requested)
  useEffect(() => {
    let cancelled = false;
    const cats = propsRef.current.layout.galaxies.map((g) => g.id);
    const sized = new Promise<void>((resolve) => {
      const check = () => {
        if (cancelled || sizeRef.current.w) resolve();
        else requestAnimationFrame(check);
      };
      check();
    });
    Promise.all([warmSprites(cats), sized, document.fonts?.ready]).then(() => {
      if (cancelled || readyRef.current) return;
      fontRef.current = getComputedStyle(canvasRef.current!).fontFamily || fontRef.current;
      const disp = getComputedStyle(document.documentElement).getPropertyValue("--font-display").trim();
      if (disp) {
        displayFontRef.current = `${disp}, ${displayFontRef.current}`;
        // the italic cut is only used on canvas, so the browser won't fetch it on its own
        document.fonts?.load(`italic 20px ${disp}`).then(() => (dirtyRef.current = true), () => {});
      }
      fitKRef.current = fitAll().k;
      const { layout, selectedId, reducedMotion } = propsRef.current;
      const planet = selectedId ? layout.planets.find((p) => p.repo.id === selectedId) : null;
      const target = planet ? planetTransform(planet) : focusTransform();
      readyRef.current = true;
      if (intro && !planet && !reducedMotion) {
        // start far outside: the whole universe is a small glowing cluster ahead
        const { cx, cy } = frame();
        const k = target.k * INTRO_START;
        const wx = (cx - target.x) / target.k;
        const wy = (cy - target.y) / target.k;
        applyTransform(zoomIdentity.translate(cx - wx * k, cy - wy * k).scale(k));
        animateTo(target, INTRO_MS, easeOut);
      } else {
        applyTransform(target);
      }
      setReady(true);
      propsRef.current.onReady?.();
    });
    return () => {
      cancelled = true;
    };
  }, [animateTo, applyTransform, fitAll, focusTransform, frame, intro, planetTransform]);

  // re-frame when the focused galaxy or the dataset (period) changes
  const focusKey = `${focusCategory ?? "all"}|${layout.planets.length}|${layout.galaxies.map((g) => `${g.id}${Math.round(g.radius)}`).join(",")}`;
  const lastFocusKey = useRef(focusKey);
  useEffect(() => {
    if (lastFocusKey.current === focusKey) return;
    lastFocusKey.current = focusKey;
    if (!readyRef.current) return;
    fitKRef.current = fitAll().k;
    animateTo(focusTransform(), 1100);
  }, [focusKey, animateTo, focusTransform, fitAll]);

  useImperativeHandle(
    apiRef,
    () => ({
      zoomBy(factor) {
        const t = transformRef.current;
        const { cx, cy } = frame();
        const k = Math.min(MAX_K, Math.max(MIN_K, t.k * factor));
        const wx = (cx - t.x) / t.k;
        const wy = (cy - t.y) / t.k;
        animateTo(zoomIdentity.translate(cx - wx * k, cy - wy * k).scale(k), 260);
      },
      reset() {
        animateTo(focusTransform(), 900);
      },
      flyTo(id) {
        // next frame: the detail panel opening changes the insets first
        requestAnimationFrame(() => {
          const p = propsRef.current.layout.planets.find((pl) => pl.repo.id === id);
          if (p) animateTo(planetTransform(p), 1000);
        });
      },
    }),
    [animateTo, focusTransform, frame, planetTransform],
  );

  const hitTest = (clientX: number, clientY: number): Planet | null => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const t = transformRef.current;
    const wx = (clientX - rect.left - t.x) / t.k;
    const wy = (clientY - rect.top - t.y) / t.k;
    const tol = 7 / t.k;
    let best: Planet | null = null;
    let bestD = Infinity;
    for (const p of propsRef.current.layout.planets) {
      if (propsRef.current.filterActive && !propsRef.current.isMatch(p.repo.id)) continue;
      const d = Math.hypot(p.x - wx, p.y - wy) - p.r;
      if (d < tol && d < bestD) {
        best = p;
        bestD = d;
      }
    }
    return best;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (e.pointerType === "touch" || e.buttons) return;
    const p = hitTest(e.clientX, e.clientY);
    const id = p?.repo.id ?? null;
    if (id !== hoverRef.current) {
      hoverRef.current = id;
      dirtyRef.current = true;
    }
    const rect = wrapRef.current!.getBoundingClientRect();
    setTip(p ? { planet: p, x: e.clientX - rect.left, y: e.clientY - rect.top, maxX: rect.width - 310 } : null);
    canvasRef.current!.style.cursor = p ? "pointer" : "grab";
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const canvas = canvasRef.current!;
    const z = zoomRef.current!;
    const step = 80;
    const map: Record<string, () => void> = {
      "+": () => z.scaleBy(select(canvas), 1.3),
      "=": () => z.scaleBy(select(canvas), 1.3),
      "-": () => z.scaleBy(select(canvas), 1 / 1.3),
      "0": () => animateTo(focusTransform(), 500),
      ArrowLeft: () => z.translateBy(select(canvas), step / transformRef.current.k, 0),
      ArrowRight: () => z.translateBy(select(canvas), -step / transformRef.current.k, 0),
      ArrowUp: () => z.translateBy(select(canvas), 0, step / transformRef.current.k),
      ArrowDown: () => z.translateBy(select(canvas), 0, -step / transformRef.current.k),
    };
    if (map[e.key]) {
      e.preventDefault();
      animTokenRef.current++;
      map[e.key]();
    }
  };

  const tipRepo = tip?.planet.repo;

  return (
    <div ref={wrapRef} className={`space${ready ? " is-ready" : ""}`}>
      <canvas
        ref={canvasRef}
        className="space-canvas"
        tabIndex={0}
        role="img"
        aria-label={`Weltall-Ansicht mit ${layout.planets.length} Repositories in ${layout.galaxies.length} Bereichen. Mit Plus und Minus zoomen, mit Pfeiltasten verschieben. Für eine Tastatur-Bedienung der einzelnen Repositories wechsle zur Listen-Ansicht.`}
        onPointerMove={onPointerMove}
        onPointerLeave={() => {
          hoverRef.current = null;
          dirtyRef.current = true;
          setTip(null);
        }}
        onClick={(e) => onSelect(hitTest(e.clientX, e.clientY)?.repo.id ?? null)}
        onKeyDown={onKeyDown}
      />
      {tip && tipRepo && (
        <div className="tooltip" style={{ left: Math.min(tip.x + 16, Math.max(8, tip.maxX)), top: tip.y + 18 }} role="presentation">
          <div className="tooltip-title">
            <span className="dot" style={{ ["--c" as string]: CATEGORY_BY_ID[tipRepo.category].color }} />
            {tipRepo.id}
          </div>
          <div className="tooltip-meta">
            ★ {formatCompact(tipRepo.stars)}
            {tipRepo.growth !== null ? ` · ${formatGrowth(tipRepo.growth, tipRepo.growthMethod, period)}` : ""}
            {tipRepo.language ? ` · ${tipRepo.language}` : ""}
          </div>
          <p className="tooltip-text">{tipRepo.explanation.length > 140 ? tipRepo.explanation.slice(0, 137) + "…" : tipRepo.explanation}</p>
          <div className="tooltip-hint">Klicken für Details</div>
        </div>
      )}
    </div>
  );
}
