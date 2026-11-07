"use client";

import { select } from "d3-selection";
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from "d3-zoom";
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from "react";
import { CATEGORY_BY_ID } from "@/lib/categories";
import { formatCompact, formatGrowth } from "@/lib/format";
import type { Planet, UniverseLayout } from "@/lib/layout";
import type { Period } from "@/lib/types";

export interface SpaceApi {
  zoomBy(factor: number): void;
  reset(): void;
  flyTo(id: string): void;
}

interface Props {
  layout: UniverseLayout;
  period: Period;
  isMatch: (id: string) => boolean;
  filterActive: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  reducedMotion: boolean;
  /** Pixels on the right covered by the detail panel (fly-to keeps planets visible). */
  rightInset: number;
  apiRef?: Ref<SpaceApi>;
}

interface Tip {
  planet: Planet;
  x: number;
  y: number;
  maxX: number;
}

function mix(hex: string, target: number, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.round(c + (target - c) * amount));
  return `rgb(${ch[0]},${ch[1]},${ch[2]})`;
}

function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a.toFixed(3)})`;
}

const SHADES = Object.fromEntries(
  Object.values(CATEGORY_BY_ID).map((c) => [c.id, { light: mix(c.color, 255, 0.6), dark: mix(c.color, 0, 0.55) }]),
) as Record<string, { light: string; dark: string }>;

function makeStarTile(dpr: number): HTMLCanvasElement {
  const size = 420;
  const c = document.createElement("canvas");
  c.width = size * dpr;
  c.height = size * dpr;
  const g = c.getContext("2d")!;
  g.scale(dpr, dpr);
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 140; i++) {
    const r = rand() < 0.92 ? rand() * 0.8 + 0.2 : rand() * 1.3 + 0.8;
    g.fillStyle = `rgba(${200 + rand() * 55},${210 + rand() * 45},255,${0.25 + rand() * 0.6})`;
    g.beginPath();
    g.arc(rand() * size, rand() * size, r, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export default function SpaceCanvas({ layout, period, isMatch, filterActive, selectedId, onSelect, reducedMotion, rightInset, apiRef }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const zoomRef = useRef<ZoomBehavior<HTMLCanvasElement, unknown> | null>(null);
  const transformRef = useRef<ZoomTransform>(zoomIdentity);
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  const starRef = useRef<{ tile: HTMLCanvasElement; dpr: number } | null>(null);
  const hoverRef = useRef<string | null>(null);
  const dirtyRef = useRef(true);
  const animRef = useRef<number | null>(null);
  const [tip, setTip] = useState<Tip | null>(null);

  // Latest props for the render loop without re-subscribing.
  const propsRef = useRef({ layout, isMatch, filterActive, selectedId, reducedMotion });
  useLayoutEffect(() => {
    propsRef.current = { layout, isMatch, filterActive, selectedId, reducedMotion };
    dirtyRef.current = true;
  }, [layout, isMatch, filterActive, selectedId, reducedMotion]);

  const draw = useCallback((time: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { w, h, dpr } = sizeRef.current;
    const t = transformRef.current;
    const { layout, isMatch, filterActive, selectedId, reducedMotion } = propsRef.current;
    const animate = !reducedMotion;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // starfield with subtle parallax
    if (!starRef.current || starRef.current.dpr !== dpr) starRef.current = { tile: makeStarTile(dpr), dpr };
    const pattern = ctx.createPattern(starRef.current.tile, "repeat");
    if (pattern) {
      pattern.setTransform(new DOMMatrix().translate(t.x * 0.06, t.y * 0.06).scale(1 / dpr));
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, w, h);
    }

    ctx.setTransform(dpr * t.k, 0, 0, dpr * t.k, dpr * t.x, dpr * t.y);
    const view = { x0: -t.x / t.k, y0: -t.y / t.k, x1: (w - t.x) / t.k, y1: (h - t.y) / t.k };
    const visible = (x: number, y: number, r: number) => x + r > view.x0 && x - r < view.x1 && y + r > view.y0 && y - r < view.y1;

    // nebulae
    for (const g of layout.galaxies) {
      if (!visible(g.x, g.y, g.radius * 1.3)) continue;
      const color = CATEGORY_BY_ID[g.id].color;
      const dim = filterActive && !g.planets.some((p) => isMatch(p.repo.id));
      const grad = ctx.createRadialGradient(g.x, g.y, 0, g.x, g.y, g.radius * 1.25);
      grad.addColorStop(0, rgba(color, dim ? 0.04 : 0.16));
      grad.addColorStop(0.55, rgba(color, dim ? 0.02 : 0.06));
      grad.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(g.x, g.y, g.radius * 1.25, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = rgba(color, dim ? 0.05 : 0.14);
      ctx.lineWidth = 1 / t.k;
      ctx.setLineDash([4 / t.k, 6 / t.k]);
      ctx.beginPath();
      ctx.arc(g.x, g.y, g.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // glow pass (additive)
    ctx.globalCompositeOperation = "lighter";
    for (const p of layout.planets) {
      if (p.momentum < 0.02 || (filterActive && !isMatch(p.repo.id))) continue;
      const R = p.r * (1.5 + 2.9 * p.momentum);
      if (!visible(p.x, p.y, R)) continue;
      let a = 0.1 + 0.55 * p.momentum;
      if (animate && p.momentum > 0.5) a *= 0.8 + 0.2 * Math.sin(time / 650 + p.phase);
      const color = CATEGORY_BY_ID[p.repo.category].color;
      const grad = ctx.createRadialGradient(p.x, p.y, p.r * 0.6, p.x, p.y, R);
      grad.addColorStop(0, rgba(color, a));
      grad.addColorStop(0.4, rgba(color, a * 0.4));
      grad.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, R, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";

    // planet bodies
    const hover = hoverRef.current;
    for (const p of layout.planets) {
      if (!visible(p.x, p.y, p.r + 8)) continue;
      const match = !filterActive || isMatch(p.repo.id);
      const color = CATEGORY_BY_ID[p.repo.category].color;
      const shade = SHADES[p.repo.category];
      ctx.globalAlpha = match ? 1 : 0.13;
      const grad = ctx.createRadialGradient(p.x - p.r * 0.35, p.y - p.r * 0.4, p.r * 0.1, p.x, p.y, p.r);
      grad.addColorStop(0, shade.light);
      grad.addColorStop(0.55, color);
      grad.addColorStop(1, shade.dark);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      if (p.repo.id === selectedId || p.repo.id === hover) {
        ctx.strokeStyle = p.repo.id === selectedId ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.6)";
        ctx.lineWidth = 2 / t.k;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r + 4 / t.k, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // screen-space labels
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.lineJoin = "round";
    for (const g of layout.galaxies) {
      const sx = g.x * t.k + t.x;
      const sy = (g.y - g.radius) * t.k + t.y - 10;
      if (sx < -200 || sx > w + 200 || sy < -40 || sy > h + 40) continue;
      const cat = CATEGORY_BY_ID[g.id];
      ctx.font = '600 13px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(5,7,20,0.85)";
      const label = `${cat.label.toUpperCase()}  ·  ${g.planets.length}`;
      ctx.strokeText(label, sx, sy);
      ctx.fillStyle = cat.color;
      ctx.fillText(label, sx, sy);
    }

    const placed: Array<[number, number, number, number]> = [];
    const candidates = layout.planets
      .filter((p) => (!filterActive || isMatch(p.repo.id)) && (p.r * t.k >= 10 || p.repo.id === selectedId || p.repo.id === hover))
      .sort((a, b) => Number(b.repo.id === selectedId) - Number(a.repo.id === selectedId) || b.r - a.r);
    ctx.font = '500 12px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    for (const p of candidates) {
      const sx = p.x * t.k + t.x;
      const sy = (p.y + p.r) * t.k + t.y + 14;
      if (sx < -100 || sx > w + 100 || sy < -20 || sy > h + 20) continue;
      const text = p.repo.name;
      const tw = ctx.measureText(text).width;
      const box: [number, number, number, number] = [sx - tw / 2 - 3, sy - 12, sx + tw / 2 + 3, sy + 4];
      if (placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
      placed.push(box);
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(5,7,20,0.9)";
      ctx.strokeText(text, sx, sy);
      ctx.fillStyle = "rgba(235,240,255,0.92)";
      ctx.fillText(text, sx, sy);
    }
    dirtyRef.current = false;
  }, []);

  // render loop
  useEffect(() => {
    let running = true;
    const loop = (time: number) => {
      if (!running) return;
      if (!document.hidden && (dirtyRef.current || !propsRef.current.reducedMotion)) draw(time);
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
    return () => {
      running = false;
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [draw]);

  const fitTransform = useCallback(() => {
    const { w, h } = sizeRef.current;
    const b = propsRef.current.layout.bounds;
    const bw = b.maxX - b.minX || 1;
    const bh = b.maxY - b.minY || 1;
    const pad = w < 600 ? 0.98 : 0.9;
    const k = Math.min(w / bw, h / bh) * pad;
    return zoomIdentity.translate(w / 2 - ((b.minX + b.maxX) / 2) * k, h / 2 - ((b.minY + b.maxY) / 2) * k).scale(k);
  }, []);

  const animateTo = useCallback(
    (target: ZoomTransform, duration = 650) => {
      const canvas = canvasRef.current;
      const z = zoomRef.current;
      if (!canvas || !z) return;
      const sel = select(canvas);
      if (propsRef.current.reducedMotion || duration <= 0) {
        sel.call(z.transform, target);
        return;
      }
      const from = transformRef.current;
      const start = performance.now();
      const step = (now: number) => {
        const e = easeInOut(Math.min(1, (now - start) / duration));
        const k = Math.exp(Math.log(from.k) + (Math.log(target.k) - Math.log(from.k)) * e);
        // interpolate the world point at screen centre so zooming feels anchored
        const x = from.x + (target.x - from.x) * e;
        const y = from.y + (target.y - from.y) * e;
        sel.call(z.transform, zoomIdentity.translate(x, y).scale(k));
        if (e < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    },
    [],
  );

  // d3-zoom: mouse wheel, trackpad pinch, touch pinch & drag
  useEffect(() => {
    const canvas = canvasRef.current!;
    const z = zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.05, 12])
      .clickDistance(6)
      .on("zoom", (e: { transform: ZoomTransform }) => {
        transformRef.current = e.transform;
        dirtyRef.current = true;
        setTip(null);
      });
    zoomRef.current = z;
    select(canvas).call(z);
    return () => {
      select(canvas).on(".zoom", null);
    };
  }, []);

  // canvas sizing
  useEffect(() => {
    const wrap = wrapRef.current!;
    const canvas = canvasRef.current!;
    let first = true;
    const ro = new ResizeObserver(() => {
      const rect = wrap.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      sizeRef.current = { w: rect.width, h: rect.height, dpr };
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      dirtyRef.current = true;
      if (first && zoomRef.current) {
        first = false;
        select(canvas).call(zoomRef.current.transform, fitTransform());
      }
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [fitTransform]);

  // re-fit when the dataset (period) changes
  const layoutKey = layout.planets.length + ":" + layout.galaxies.map((g) => g.id).join(",");
  const lastKey = useRef(layoutKey);
  useEffect(() => {
    if (lastKey.current === layoutKey) return;
    lastKey.current = layoutKey;
    if (sizeRef.current.w) animateTo(fitTransform(), 500);
  }, [layoutKey, animateTo, fitTransform]);

  useImperativeHandle(
    apiRef,
    () => ({
      zoomBy(factor) {
        const { w, h } = sizeRef.current;
        const t = transformRef.current;
        const k = Math.min(12, Math.max(0.05, t.k * factor));
        const cx = (w - rightInset) / 2;
        const cy = h / 2;
        const wx = (cx - t.x) / t.k;
        const wy = (cy - t.y) / t.k;
        animateTo(zoomIdentity.translate(cx - wx * k, cy - wy * k).scale(k), 250);
      },
      reset() {
        animateTo(fitTransform(), 500);
      },
      flyTo(id) {
        const p = propsRef.current.layout.planets.find((pl) => pl.repo.id === id);
        if (!p) return;
        const { w, h } = sizeRef.current;
        const k = Math.max(transformRef.current.k, Math.min(2.4, 30 / p.r));
        const cx = (w - rightInset) / 2;
        animateTo(zoomIdentity.translate(cx - p.x * k, h / 2 - p.y * k).scale(k));
      },
    }),
    [animateTo, fitTransform, rightInset],
  );

  const hitTest = (clientX: number, clientY: number): Planet | null => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const t = transformRef.current;
    const wx = (clientX - rect.left - t.x) / t.k;
    const wy = (clientY - rect.top - t.y) / t.k;
    const tol = 6 / t.k;
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
    setTip(p ? { planet: p, x: e.clientX - rect.left, y: e.clientY - rect.top, maxX: rect.width - 300 } : null);
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
      "0": () => animateTo(fitTransform(), 400),
      ArrowLeft: () => z.translateBy(select(canvas), step / transformRef.current.k, 0),
      ArrowRight: () => z.translateBy(select(canvas), -step / transformRef.current.k, 0),
      ArrowUp: () => z.translateBy(select(canvas), 0, step / transformRef.current.k),
      ArrowDown: () => z.translateBy(select(canvas), 0, -step / transformRef.current.k),
    };
    if (map[e.key]) {
      e.preventDefault();
      map[e.key]();
    }
  };

  const tipRepo = tip?.planet.repo;

  return (
    <div ref={wrapRef} className="space">
      <canvas
        ref={canvasRef}
        className="space-canvas"
        tabIndex={0}
        role="img"
        aria-label={`Weltall-Ansicht mit ${layout.planets.length} Repositories in ${layout.galaxies.length} Galaxien. Mit Plus und Minus zoomen, mit Pfeiltasten verschieben. Für eine Tastatur-Bedienung der einzelnen Repositories wechsle zur Listen-Ansicht.`}
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
        <div
          className="tooltip"
          style={{
            left: Math.min(tip.x + 16, Math.max(8, tip.maxX)),
            top: tip.y + 18,
          }}
          role="presentation"
        >
          <div className="tooltip-title">
            <span className="dot" style={{ background: CATEGORY_BY_ID[tipRepo.category].color }} />
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
