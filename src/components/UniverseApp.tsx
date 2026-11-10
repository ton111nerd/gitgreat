"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { CATEGORIES } from "@/lib/categories";
import { formatCompact, formatDate, formatRelative } from "@/lib/format";
import { computeLayout, matchesFilter } from "@/lib/layout";
import { PERIODS, PERIOD_LABELS, type CategoryId, type Period, type UniversePayload } from "@/lib/types";
import DetailPanel from "./DetailPanel";
import Legend from "./Legend";
import Logo, { LogoMark } from "./Logo";
import RepoList from "./RepoList";
import SpaceCanvas, { type Insets, type SpaceApi } from "./SpaceCanvas";
import SpaceBackdrop, { type BackdropApi } from "./space/SpaceBackdrop";

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
  category?: CategoryId | null;
  view?: View;
  query?: string;
  repo?: string | null;
}

const DESKTOP_INSETS = { top: 92, left: 280, bottom: 30 };
const MOBILE_INSETS: Insets = { top: 176, left: 10, right: 10, bottom: 104 };

export default function UniverseApp({ initial, initialState = {} }: { initial: UniversePayload; initialState?: InitialState }) {
  const [period, setPeriod] = useState<Period>(initial.period);
  const [data, setData] = useState<Partial<Record<Period, UniversePayload>>>({ [initial.period]: initial });
  const [lastLoaded, setLastLoaded] = useState<Period>(initial.period);
  const [failed, setFailed] = useState<Period | null>(null);
  const [view, setView] = useState<View>(initialState.view ?? "space");
  const [query, setQuery] = useState(initialState.query ?? "");
  const [searchOpen, setSearchOpen] = useState(false);
  const [category, setCategory] = useState<CategoryId | null>(initialState.category ?? null);
  const [language, setLanguage] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(initialState.repo ?? null);
  const [hereGalaxy, setHereGalaxy] = useState<CategoryId | null>(null);
  const [spaceReady, setSpaceReady] = useState(false);
  // fly in only on a plain visit – deep links go straight to their target
  const [playIntro] = useState(() => !initialState.repo && !initialState.category && !initialState.query);
  const now = useNow();
  const spaceRef = useRef<SpaceApi>(null);
  const backdropRef = useRef<BackdropApi>(null);
  const onCamera = useCallback((x: number, y: number, zoom: number) => backdropRef.current?.setCamera(x, y, zoom), []);
  // the HUD stays hidden during the fly-in and fades in as the universe arrives
  const [hudVisible, setHudVisible] = useState(!playIntro || initialState.view === "list");
  const onSpaceReady = useCallback(() => {
    setSpaceReady(true);
    setTimeout(() => setHudVisible(true), 1700);
  }, []);
  const reducedMotion = useMedia("(prefers-reduced-motion: reduce)");
  const isMobile = useMedia("(max-width: 820px)");

  // keep the URL shareable
  useEffect(() => {
    const sp = new URLSearchParams();
    if (period !== "7d") sp.set("period", period);
    if (view === "list") sp.set("view", "list");
    if (query) sp.set("q", query);
    if (category) sp.set("cat", category);
    if (selectedId) sp.set("repo", selectedId);
    const qs = sp.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, [period, view, query, selectedId, category]);

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
  const filter = useMemo(() => ({ query, category, language }), [query, category, language]);
  const filterActive = Boolean(query.trim() || category || language);
  const matching = useMemo(() => shown.repos.filter((r) => matchesFilter(r, filter)), [shown, filter]);
  const matchIds = useMemo(() => new Set(matching.map((r) => r.id)), [matching]);
  const isMatch = useCallback((id: string) => matchIds.has(id), [matchIds]);

  const counts = useMemo(() => {
    const m = new Map<CategoryId, number>();
    for (const r of shown.repos) m.set(r.category, (m.get(r.category) ?? 0) + 1);
    return m;
  }, [shown]);

  const languages = useMemo(() => {
    const c = new Map<string, number>();
    for (const r of shown.repos) if (r.language) c.set(r.language, (c.get(r.language) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]).map(([l]) => l);
  }, [shown]);

  const suggestions = useMemo(
    () => (query.trim() ? [...matching].sort((a, b) => b.stars - a.stars).slice(0, 6) : []),
    [matching, query],
  );

  const selected = useMemo(() => shown.repos.find((r) => r.id === selectedId) ?? null, [shown, selectedId]);

  const select = useCallback(
    (id: string | null) => {
      setSelectedId(id);
      if (id && view === "space") spaceRef.current?.flyTo(id);
    },
    [view],
  );
  const closePanel = useCallback(() => setSelectedId(null), []);

  const pickCategory = (id: CategoryId | null) => {
    setSelectedId(null);
    if (id === category) spaceRef.current?.reset(); // same target again: fly back to it
    setCategory(id);
  };

  const pickSuggestion = (id: string) => {
    setQuery("");
    setSearchOpen(false);
    select(id);
  };

  const generated = Date.parse(shown.generatedAt);
  const stale = now !== null && now - generated > 26 * 3600_000; // daily cron on Hobby + hourly GitHub Action
  const status =
    shown.source === "fallback"
      ? `Offline-Daten · Stand ${formatDate(shown.generatedAt)}`
      : now === null
        ? "Zuletzt aktualisiert: …"
        : `Zuletzt aktualisiert: ${formatRelative(shown.generatedAt, now)}${stale ? " (verzögert)" : ""}`;

  const insets = useMemo<Insets>(
    () => (isMobile ? MOBILE_INSETS : { ...DESKTOP_INSETS, right: selectedId ? 448 : 76 }),
    [isMobile, selectedId],
  );
  const showSplash = view === "space" && !spaceReady;

  return (
    <div className={`app view-${view}${selected ? " has-panel" : ""}${hudVisible || reducedMotion ? "" : " hud-hidden"}`}>
      <SpaceBackdrop apiRef={backdropRef} animate={!reducedMotion} className="app-backdrop" />

      <main className="stage">
        {view === "space" ? (
          <SpaceCanvas
            apiRef={spaceRef}
            layout={layout}
            period={shown.period}
            isMatch={isMatch}
            filterActive={filterActive}
            selectedId={selectedId}
            onSelect={select}
            reducedMotion={reducedMotion}
            insets={insets}
            focusCategory={category}
            intro={playIntro}
            onCamera={onCamera}
            onGalaxyChange={setHereGalaxy}
            onReady={onSpaceReady}
          />
        ) : (
          <RepoList repos={matching} period={shown.period} selectedId={selectedId} onSelect={select} />
        )}
      </main>

      <header className="hud-top">
        <div className="brand">
          <Logo />
        </div>

        <form
          className={`search glass${searchOpen && suggestions.length ? " open" : ""}`}
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            if (suggestions[0]) pickSuggestion(suggestions[0].id);
          }}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) setSearchOpen(false);
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="m10.6 10.6 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <label htmlFor="q" className="sr-only">
            Repositories durchsuchen
          </label>
          <input
            id="q"
            type="search"
            placeholder="Repo oder Thema suchen …"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSearchOpen(true);
            }}
            onFocus={() => setSearchOpen(true)}
            onKeyDown={(e) => e.key === "Escape" && setSearchOpen(false)}
            autoComplete="off"
          />
          {query.trim() && <span className="search-count">{matching.length}</span>}
          {searchOpen && suggestions.length > 0 && (
            <ul className="suggest glass">
              {suggestions.map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => pickSuggestion(r.id)}>
                    <span className="dot" style={{ ["--c" as string]: CATEGORIES.find((c) => c.id === r.category)!.color }} aria-hidden="true" />
                    <span className="suggest-name">
                      <span className="owner">{r.owner}/</span>
                      {r.name}
                    </span>
                    <span className="suggest-stars">★ {formatCompact(r.stars)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </form>

        <div className="controls">
          <div className="seg glass" role="radiogroup" aria-label="Zeitraum">
            {PERIODS.map((p) => (
              <button key={p} type="button" role="radio" aria-checked={period === p} className={period === p ? "on" : ""} onClick={() => setPeriod(p)}>
                {PERIOD_LABELS[p]}
              </button>
            ))}
          </div>
          <div className="seg glass" role="radiogroup" aria-label="Ansicht">
            <button type="button" role="radio" aria-checked={view === "space"} className={view === "space" ? "on" : ""} onClick={() => setView("space")}>
              Weltall
            </button>
            <button type="button" role="radio" aria-checked={view === "list"} className={view === "list" ? "on" : ""} onClick={() => setView("list")}>
              Liste
            </button>
          </div>
        </div>
      </header>

      <nav className="rail glass" aria-label="Bereiche">
        <p className="rail-title">Bereiche</p>
        <ul>
          <li>
            <button type="button" className={`rail-item${category === null ? " on" : ""}`} aria-pressed={category === null} onClick={() => pickCategory(null)}>
              <span className="rail-all" aria-hidden="true" />
              <span className="rail-label">Ganzes Universum</span>
              <span className="rail-count">{shown.repos.length}</span>
            </button>
          </li>
          {CATEGORIES.filter((c) => counts.get(c.id)).map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className={`rail-item${category === c.id ? " on" : ""}${hereGalaxy === c.id && view === "space" ? " here" : ""}`}
                style={{ ["--c" as string]: c.color }}
                aria-pressed={category === c.id}
                title={c.plain}
                onClick={() => pickCategory(category === c.id && view === "list" ? null : c.id)}
              >
                <span className="rail-orb" aria-hidden="true" />
                <span className="rail-label">{c.label}</span>
                <span className="rail-count">{counts.get(c.id)}</span>
              </button>
            </li>
          ))}
        </ul>
        <label className="rail-lang">
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
      </nav>

      {(shown.notice || error || loading) && (
        <div className="notice glass" role="status">
          {error ?? (loading ? "Zeitraum wird geladen …" : shown.notice)}
        </div>
      )}

      <Legend period={shown.period} hasGrowth={layout.hasGrowth} status={status} live={shown.source === "live"} stale={stale} />

      {view === "space" && (
        <div className="zoom-ctrl glass" style={{ right: selected && !isMobile ? 448 : undefined }}>
          <button type="button" onClick={() => spaceRef.current?.zoomBy(1.5)} aria-label="Hineinzoomen">
            +
          </button>
          <button type="button" onClick={() => spaceRef.current?.zoomBy(1 / 1.5)} aria-label="Herauszoomen">
            −
          </button>
          <button type="button" onClick={() => spaceRef.current?.reset()} aria-label="Ansicht zurücksetzen">
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="M1 5V1h4M13 5V1H9M1 9v4h4M13 9v4H9" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      )}

      {selected && <DetailPanel repo={selected} period={shown.period} now={now ?? generated} onClose={closePanel} />}

      <div className={`splash${showSplash ? "" : " gone"}`} aria-hidden={!showSplash}>
        <div className="splash-inner">
          <LogoMark size={44} />
          <p className="splash-title">GitHub Universe</p>
          <p className="splash-sub">Was auf GitHub gerade abhebt</p>
        </div>
      </div>
    </div>
  );
}
