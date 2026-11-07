"use client";

import { useSyncExternalStore } from "react";
import { formatDate, formatRelative } from "@/lib/format";

const TICK = 30_000;

/** "vor 12 Minuten" – rendered on the client only, so server and client markup match. */
export default function LiveSince({ iso, source }: { iso: string; source: "live" | "fallback" }) {
  const now = useSyncExternalStore(
    (cb) => {
      const id = setInterval(cb, TICK);
      return () => clearInterval(id);
    },
    () => Math.floor(Date.now() / TICK) * TICK,
    () => null,
  );
  if (source === "fallback") return <>Stand {formatDate(iso)}</>;
  return <>{now === null ? "aktualisiert" : `aktualisiert ${formatRelative(iso, now)}`}</>;
}
