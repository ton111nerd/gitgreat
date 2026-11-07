"use client";

import { useSyncExternalStore } from "react";
import SpaceBackdrop from "@/components/space/SpaceBackdrop";

function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

const PLANET = { x: 0.8, y: 1.06, r: 0.66 };
const PLANET_MOBILE = { x: 0.62, y: 1.2, r: 0.62 };

export default function HeroBackdrop() {
  const reduced = useReducedMotion();
  return <SpaceBackdrop planet={PLANET} planetMobile={PLANET_MOBILE} pointerParallax={!reduced} animate={!reduced} className="hero-backdrop" />;
}
