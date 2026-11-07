"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { CATEGORIES } from "@/lib/categories";
import { formatDate, formatRelative } from "@/lib/format";
import { computeLayout, matchesFilter } from "@/lib/layout";
import { PERIODS, PERIOD_LABELS, type CategoryId, type Period, type UniversePayload } from "@/lib/types";
import DetailPanel from "./DetailPanel";
import Legend from "./Legend";
import RepoList from "./RepoList";
import SpaceCanvas, { type SpaceApi } from "./SpaceCanvas";

export type View = "space" | "list";

function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

const TICK = 30_000;
/** Current time, rounded to 30 s; null during SSR/hydration so markup matches. */
function useNow(): number | null {
  return useSyncExternalStore(
    (onChange) => {
      const id = setInterval(onChange, TICK);
      return () => clearInterval(id);
    },
    () => Math.floor(Date.now() / TICK) * TICK,
    () => null,
  );
}

export interface InitialState {
  view?: View;
  query?: string;
  repo?: string | null;
}

export default function UniverseApp({ initial, initialState = {} }: { initial: UniversePayload; initialState?: InitialState }) {
  const [period, setPeriod] = useState<Period>(initial.period);
  const [data, setData] = useState<Partial<Record<Period, UniversePayload>>>({ [initial.period]: initial });
  const [lastLoaded, setLastLoaded] = useState<Period>(initial.period);
  const [failed, setFailed] = useState<Period | null>(null);
  const [view, setView] = useState<View>(initialState.view ?? "space");
  const [query, setQuery] = useState(initialState.query ?? "");
  const [categories, setCategories] = useState<Set<CategoryId>>(new Set());
  const [language, setLanguage] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(initialState.repo ?? null);
  const now = useNow();
  const spaceRef = useRef<SpaceApi>(null);
  const reducedMotion = useMedia("(prefers-reduced-motion: reduce)");
  const isMobile = useMedia("(max-width: 760px)");

  // keep the URL shareable
  useEffect(() => {
    const sp = new URLSearchParams();
    if (period !== "7d") sp.set("period", period);
    if (view === "list") sp.set("view", "list");
    if (query) sp.set("q", query);
    if (selectedId) sp.set("repo", selectedId);
    const qs = sp.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, [period, view, query, selectedId]);

  // load period data from our cached API (never from GitHub directly)
  const needsFetch = !data[period] && failed !== period;
  useEffect(() => {
    if (!needsFetch) return;
    let cancelled = false;
    fetch(`/api/universe?period=${period}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<UniversePayload>;
      })
      .then((payload) => {
        if (cancelled) return;
        setData((d) => ({ ...d, [period]: payload }));
        setLastLoaded(period);
      })
      .catch(() => !cancelled && setFailed(period));
    return () => {
      cancelled = true;
    };
  }, [period, needsFetch]);

  const shown = data[period] ?? data[lastLoaded] ?? initial;
  const loading = needsFetch;
  const error = failed === period ? "Daten für diesen Zeitraum konnten nicht geladen werden. Du siehst weiter den vorherigen Stand." : null;

  const layout = useMemo(() => computeLayout(shown.repos), [shown]);
  const filter = useMemo(() => ({ query, categories, language }), [query, categories, language]);
  const filterActive = Boolean(query.trim() || categories.size || language);
  const matching = useMemo(() => shown.repos.filter((r) => matchesFilter(r, filter)), [shown, filter]);
  const matchIds = useMemo(() => new Set(matching.map((r) => r.id)), [matching]);
  const isMatch = useCallback((id: string) => matchIds.has(id), [matchIds]);

  const languages = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of shown.repos) if (r.language) counts.set(r.language, (counts.get(r.language) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([l]) => l);
  }, [shown]);

  const selected = useMemo(() => shown.repos.find((r) => r.id === selectedId) ?? null, [shown, selectedId]);

  const select = useCallback(
    (id: string | null) => {
      setSelectedId(id);
      if (id && view === "space") spaceRef.current?.flyTo(id);
    },
    [view],
  );
  const closePanel = useCallback(() => setSelectedId(null), []);

  const toggleCategory = (id: CategoryId) =>
    setCategories((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const onSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const top = [...matching].sort((a, b) => (b.growth ?? 0) - (a.growth ?? 0))[0];
    if (top) select(top.id);
  };

  const generated = Date.parse(shown.generatedAt);
  const stale = now !== null && now - generated > 3 * 3600_000;
  const updatedLabel =
    shown.source === "fallback"
      ? `Offline-Daten · Stand ${formatDate(shown.generatedAt)}`
      : now === null
        ? "Zuletzt aktualisiert: …"
        : `Zuletzt aktualisiert: ${formatRelative(shown.generatedAt, now)}`;

  const panelInset = selected && !isMobile ? 420 : 0;

  return (
    <div className={`app view-${view}${selected ? " has-panel" : ""}`}>
      <header className="topbar">
        <div className="brand">
          <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
            <circle cx="14" cy="14" r="6" fill="#b28cff" />
            <ellipse cx="14" cy="14" rx="12.5" ry="4.5" fill="none" stroke="#5ea8ff" strokeWidth="1.6" transform="rotate(-20 14 14)" />
            <circle cx="24" cy="8" r="1.6" fill="#ffe066" />
          </svg>
          <div>
            <h1>GitHub Universe</h1>
            <p className="tagline">Was auf GitHub gerade abhebt – live erkundbar</p>
          </div>
        </div>

        <div className="controls">
          <div className="seg" role="radiogroup" aria-label="Zeitraum">
            {PERIODS.map((p) => (
              <button key={p} type="button" role="radio" aria-checked={period === p} className={period === p ? "on" : ""} onClick={() => setPeriod(p)}>
                {PERIOD_LABELS[p]}
              </button>
            ))}
          </div>
          <div className="seg" role="radiogroup" aria-label="Ansicht">
            <button type="button" role="radio" aria-checked={view === "space"} className={view === "space" ? "on" : ""} onClick={() => setView("space")}>
              Weltall
            </button>
            <button type="button" role="radio" aria-checked={view === "list"} className={view === "list" ? "on" : ""} onClick={() => setView("list")}>
              Liste
            </button>
          </div>
          <p className={`updated${stale ? " stale" : ""}`} aria-live="polite">
            <span className={`pulse${shown.source === "live" && !stale ? " live" : ""}`} aria-hidden="true" />
            {updatedLabel}
            {stale && shown.source === "live" ? " (Aktualisierung verzögert)" : ""}
            {loading ? " · lädt …" : ""}
          </p>
        </div>
      </header>

      <div className="filters">
        <form className="search" role="search" onSubmit={onSearchSubmit}>
          <label htmlFor="q" className="sr-only">
            Repositories durchsuchen
          </label>
          <input
            id="q"
            type="search"
            placeholder="Repo oder Thema suchen …"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
          />
        </form>
        <div className="chips" role="group" aria-label="Nach Kategorie filtern">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`chip${categories.has(c.id) ? " on" : ""}`}
              style={{ ["--c" as string]: c.color }}
              aria-pressed={categories.has(c.id)}
              title={c.plain}
              onClick={() => toggleCategory(c.id)}
            >
              <span className="dot" aria-hidden="true" />
              {c.label}
            </button>
          ))}
        </div>
        <label className="lang">
          <span className="sr-only">Nach Sprache filtern</span>
          <select value={language} onChange={(e) => setLanguage(e.target.value)}>
            <option value="">Alle Sprachen</option>
            {languages.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
        {filterActive && (
          <button
            type="button"
            className="btn btn-small btn-ghost"
            onClick={() => {
              setQuery("");
              setCategories(new Set());
              setLanguage("");
            }}
          >
            Filter zurücksetzen
          </button>
        )}
        <span className="count" aria-live="polite">
          {filterActive ? `${matching.length} von ${shown.repos.length}` : `${shown.repos.length} Repos`}
        </span>
      </div>

      {(shown.notice || error) && (
        <div className="notice" role="status">
          {error ?? shown.notice}
        </div>
      )}

      <main className="stage">
        {view === "space" ? (
          <>
            <SpaceCanvas
              apiRef={spaceRef}
              layout={layout}
              period={shown.period}
              isMatch={isMatch}
              filterActive={filterActive}
              selectedId={selectedId}
              onSelect={select}
              reducedMotion={reducedMotion}
              rightInset={panelInset}
            />
            <div className="zoom-ctrl" style={{ right: panelInset + 16 }}>
              <button type="button" className="icon-btn" onClick={() => spaceRef.current?.zoomBy(1.4)} aria-label="Hineinzoomen">
                +
              </button>
              <button type="button" className="icon-btn" onClick={() => spaceRef.current?.zoomBy(1 / 1.4)} aria-label="Herauszoomen">
                −
              </button>
              <button type="button" className="icon-btn" onClick={() => spaceRef.current?.reset()} aria-label="Ansicht zurücksetzen">
                ⤢
              </button>
            </div>
          </>
        ) : (
          <RepoList repos={matching} period={shown.period} selectedId={selectedId} onSelect={select} />
        )}
        <Legend period={shown.period} hasGrowth={layout.hasGrowth} />
        {selected && <DetailPanel repo={selected} period={shown.period} now={now ?? generated} onClose={closePanel} />}
      </main>
    </div>
  );
}
