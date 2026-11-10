import { PERIOD_LABELS, type Period } from "@/lib/types";

interface Props {
  period: Period;
  hasGrowth: boolean;
  status: string;
  live: boolean;
  stale: boolean;
}

/** Always-visible key for the visual encoding, plus the data freshness line. */
export default function Legend({ period, hasGrowth, status, live, stale }: Props) {
  return (
    <aside className="legend glass" aria-label="Legende">
      <ul>
        <li>
          <svg width="34" height="20" viewBox="0 0 34 20" aria-hidden="true">
            <circle cx="9" cy="10" r="7" fill="#b28cff" opacity=".85" />
            <circle cx="24" cy="10" r="7" fill="#4fd1c5" opacity=".85" />
          </svg>
          <span>
            <b>Farbe</b> Bereich
          </span>
        </li>
        <li>
          <svg width="34" height="20" viewBox="0 0 34 20" aria-hidden="true">
            <circle cx="5" cy="13" r="2.5" fill="#c3c9de" />
            <circle cx="14" cy="11" r="5" fill="#c3c9de" />
            <circle cx="27" cy="10" r="7.1" fill="#c3c9de" />
          </svg>
          <span>
            <b>Fläche</b> Stars gesamt
          </span>
        </li>
        <li>
          <svg width="34" height="20" viewBox="0 0 34 20" aria-hidden="true">
            <defs>
              <radialGradient id="lg-glow">
                <stop offset="0.3" stopColor="#ffe9b0" stopOpacity=".95" />
                <stop offset="1" stopColor="#ffb454" stopOpacity="0" />
              </radialGradient>
            </defs>
            <circle cx="8" cy="10" r="3.5" fill="#ffb454" opacity=".6" />
            <circle cx="24" cy="10" r="10" fill="url(#lg-glow)" />
            <circle cx="24" cy="10" r="3.5" fill="#ffb454" />
          </svg>
          <span>
            <b>Leuchten</b> {hasGrowth ? `Wachstum · ${PERIOD_LABELS[period]}` : "Wachstum (keine Daten)"}
          </span>
        </li>
      </ul>
      <p className={`legend-status${stale ? " stale" : ""}`} aria-live="polite">
        <span className={`pulse${live && !stale ? " live" : ""}`} aria-hidden="true" />
        {status}
      </p>
    </aside>
  );
}
