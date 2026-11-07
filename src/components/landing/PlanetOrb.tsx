"use client";

import { useEffect, useRef } from "react";
import { planetSprite, PLANET_PAD } from "@/lib/sprites";
import type { CategoryId } from "@/lib/types";

/** A single procedurally shaded planet (same renderer as the explorer). */
export default function PlanetOrb({ category, variant = 0, size, glow = 0 }: { category: CategoryId; variant?: number; size: number; glow?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const box = Math.round(size * (1 + PLANET_PAD));
  useEffect(() => {
    const c = ref.current!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = box * dpr;
    c.height = box * dpr;
    const g = c.getContext("2d")!;
    g.clearRect(0, 0, c.width, c.height);
    g.drawImage(planetSprite(category, variant), 0, 0, c.width, c.height);
  }, [category, variant, box]);
  return (
    <span className="orb" style={{ width: box, height: box, ["--glow" as string]: glow }} data-cat={category}>
      <canvas ref={ref} style={{ width: box, height: box }} aria-hidden="true" />
    </span>
  );
}
