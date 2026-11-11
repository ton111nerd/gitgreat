"use client";

import { useEffect, useRef, useState } from "react";
import { CATEGORY_BY_ID } from "@/lib/categories";
import { formatDate, formatGrowth, formatNumber, formatRelative, safeExternalUrl } from "@/lib/format";
import type { Period, TrustStatus, UniverseRepo } from "@/lib/types";

interface Props {
  repo: UniverseRepo;
  period: Period;
  now: number;
  onClose: () => void;
}

const MANAGER_LABEL: Record<string, string> = { npm: "npm", pip: "PyPI", cargo: "crates.io", go: "Go", docker: "Docker" };
const STATUS_ICON: Record<TrustStatus, string> = { good: "✓", warn: "!", bad: "✕" };

function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "ok" | "err">("idle");
  return (
    <button
      type="button"
      className="btn btn-small"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setState("ok");
        } catch {
          setState("err");
        }
        setTimeout(() => setState("idle"), 1800);
      }}
      aria-live="polite"
    >
      {state === "ok" ? "Kopiert ✓" : state === "err" ? "Bitte manuell kopieren" : "Kopieren"}
    </button>
  );
}

export default function DetailPanel({ repo, period, now, onClose }: Props) {
  const panelRef = useRef<HTMLElement>(null);
  const dragRef = useRef<{ startY: number; dy: number } | null>(null);
  const [dragY, setDragY] = useState(0);
  const cat = CATEGORY_BY_ID[repo.category];
  const homepage = safeExternalUrl(repo.homepage);
  const github = safeExternalUrl(repo.url) ?? `https://github.com/${repo.id}`;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus?.({ preventScroll: true });
    };
  }, [onClose]);

  useEffect(() => {
    panelRef.current?.scrollTo({ top: 0 });
  }, [repo.id]);

  // bottom-sheet: drag the handle down to close (mobile)
  const onHandleDown = (e: React.PointerEvent) => {
    dragRef.current = { startY: e.clientY, dy: 0 };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onHandleMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    dragRef.current.dy = Math.max(0, e.clientY - dragRef.current.startY);
    setDragY(dragRef.current.dy);
  };
  const onHandleUp = () => {
    if (dragRef.current && dragRef.current.dy > 90) onClose();
    dragRef.current = null;
    setDragY(0);
  };

  const t = repo.trust;

  return (
    <aside
      ref={panelRef}
      className="panel"
      role="dialog"
      aria-modal="false"
      aria-labelledby="panel-title"
      tabIndex={-1}
      style={dragY ? { transform: `translateY(${dragY}px)`, transition: "none" } : undefined}
    >
      <div
        className="sheet-handle"
        onPointerDown={onHandleDown}
        onPointerMove={onHandleMove}
        onPointerUp={onHandleUp}
        onPointerCancel={onHandleUp}
        aria-hidden="true"
      >
        <span />
      </div>

      <header className="panel-head">
        <span className="chip" style={{ ["--c" as string]: cat.color }}>
          <span className="dot" />
          {cat.label}
        </span>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Details schließen">
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      <h2 id="panel-title" className="panel-title">
        <span className="panel-owner">{repo.owner} /</span>
        <span className="panel-name">{repo.name}</span>
      </h2>

      <p className="panel-figures">
        <span className="fig">
          <span className="fig-num">{formatNumber(repo.stars)}</span> Stars
        </span>
        <span className={`fig${repo.growth === null ? " fig-none" : " fig-growth"}`}>
          {repo.growth === null ? "Wachstum: keine Daten" : formatGrowth(repo.growth, repo.growthMethod, period)}
          {repo.growthMethod === "estimated" && " (hochgerechnet)"}
        </span>
      </p>

      <section className="panel-section plain" aria-labelledby="sec-plain">
        <h3 id="sec-plain">Einfach erklärt</h3>
        <p className="plain-text">{repo.explanation}</p>
        {repo.explanationSource === "keywords" && (
          <p className="muted small">Originalbeschreibung von GitHub – eine einfache Erklärung folgt beim nächsten Update.</p>
        )}
      </section>

      <section className="panel-section" aria-labelledby="sec-tech">
        <h3 id="sec-tech">Technik</h3>
        <dl className="facts">
          <div>
            <dt>Sprache</dt>
            <dd>{repo.language ?? "—"}</dd>
          </div>
          <div>
            <dt>Lizenz</dt>
            <dd>{repo.license === "NOASSERTION" ? "unklar" : (repo.license ?? "keine")}</dd>
          </div>
          <div>
            <dt>Forks</dt>
            <dd>{formatNumber(repo.forks)}</dd>
          </div>
          <div>
            <dt>Letzter Push</dt>
            <dd title={repo.pushedAt ? formatDate(repo.pushedAt) : undefined}>{formatRelative(repo.pushedAt, now)}</dd>
          </div>
        </dl>
      </section>

      <section className="panel-section" aria-labelledby="sec-trust">
        <h3 id="sec-trust">Vertrauens-Ampel</h3>
        <div className={`trust trust-${t.level}`}>
          <div className="lights" aria-hidden="true">
            <span className={t.level === "red" ? "on" : ""} />
            <span className={t.level === "yellow" ? "on" : ""} />
            <span className={t.level === "green" ? "on" : ""} />
          </div>
          <div>
            <strong>{t.summary}</strong>
            <span className="sr-only"> (Ampel: {t.level === "green" ? "grün" : t.level === "yellow" ? "gelb" : "rot"})</span>
          </div>
        </div>
        {t.unusualPopularity && (
          <p className="warning" role="note">
            Popularität ungewöhnlich: sehr viele Stars bei auffällig wenigen Forks. Stars können gekauft sein – Repo besonders gründlich prüfen.
          </p>
        )}
        <ul className="signals">
          {t.signals.map((s) => (
            <li key={s.id} className={`sig sig-${s.status}`}>
              <span className="sig-icon" aria-hidden="true">
                {STATUS_ICON[s.status]}
              </span>
              <span>
                <strong>{s.label}</strong> <span className="muted">{s.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      {repo.install && (
        <section className="panel-section" aria-labelledby="sec-install">
          <h3 id="sec-install">Installieren</h3>
          <div className="cmd">
            <code>{repo.install.command}</code>
            <CopyButton text={repo.install.command} />
          </div>
          <p className="muted small">
            Abgeleitet aus <code>{repo.install.manifest}</code>
            {repo.install.verified
              ? repo.install.manager === "go"
                ? " (Modulpfad aus go.mod)."
                : ` · Paket in ${MANAGER_LABEL[repo.install.manager]} bestätigt.`
              : " · Installation direkt aus dem Repository (kein bestätigtes Registry-Paket)."}
          </p>
        </section>
      )}

      <p className="security-note" role="note">
        Prüfe Repos vor der Installation. Diese Seite führt nie Code aus – Befehle werden nur zum Kopieren angezeigt.
      </p>

      <div className="actions">
        <a className="btn btn-primary" href={`https://codespaces.new/${repo.id}`} target="_blank" rel="noopener noreferrer">
          Im Browser testen
        </a>
        <a className="btn" href={github} target="_blank" rel="noopener noreferrer">
          Auf GitHub
        </a>
        {homepage && (
          <a className="btn" href={homepage} target="_blank" rel="noopener noreferrer nofollow">
            Website
          </a>
        )}
      </div>

      {repo.topics.length > 0 && (
        <ul className="topics" aria-label="Topics">
          {repo.topics.slice(0, 12).map((topic) => (
            <li key={topic}>{topic}</li>
          ))}
        </ul>
      )}
    </aside>
  );
}
