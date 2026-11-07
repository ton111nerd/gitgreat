"use client";

import { useState } from "react";
import { PERIOD_LABELS, type Period } from "@/lib/types";

export default function Legend({ period, hasGrowth }: { period: Period; hasGrowth: boolean }) {
  const [open, setOpen] = useState(true);
  return (
    <aside className={`legend${open ? "" : " collapsed"}`} aria-label="Legende">
      <button type="button" className="legend-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span>So liest du das Universum</span>
        <span aria-hidden="true">{open ? "–" : "+"}</span>
      </button>
      <ul>
        <li>
          <svg width="30" height="18" viewBox="0 0 30 18" aria-hidden="true">
            <circle cx="9" cy="9" r="7" fill="none" stroke="currentColor" strokeDasharray="2 2" opacity=".6" />
            <circle cx="22" cy="9" r="6" fill="none" stroke="currentColor" strokeDasharray="2 2" opacity=".6" />
          </svg>
          <span>
            <b>Galaxie &amp; Farbe</b> = Kategorie
          </span>
        </li>
        <li>
          <svg width="30" height="18" viewBox="0 0 30 18" aria-hidden="true">
            <circle cx="5" cy="11" r="3" fill="#a9b4c9" />
            <circle cx="20" cy="9" r="8" fill="#a9b4c9" />
          </svg>
          <span>
            <b>Größe</b> = Stars gesamt
          </span>
        </li>
        <li>
          <svg width="30" height="18" viewBox="0 0 30 18" aria-hidden="true">
            <defs>
              <radialGradient id="lg-glow">
                <stop offset="0" stopColor="#b28cff" stopOpacity=".9" />
                <stop offset="1" stopColor="#b28cff" stopOpacity="0" />
              </radialGradient>
            </defs>
            <circle cx="6" cy="9" r="4" fill="#b28cff" opacity=".7" />
            <circle cx="21" cy="9" r="9" fill="url(#lg-glow)" />
            <circle cx="21" cy="9" r="4" fill="#b28cff" />
          </svg>
          <span>
            <b>Leuchten</b> = {hasGrowth ? `neue Stars in ${PERIOD_LABELS[period]}` : "Wachstum (gerade keine Daten)"}
          </span>
        </li>
      </ul>
    </aside>
  );
}
