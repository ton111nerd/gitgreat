import Link from "next/link";
import HeroBackdrop from "@/components/landing/HeroBackdrop";
import LegacyRedirect from "@/components/landing/LegacyRedirect";
import LiveSince from "@/components/landing/LiveSince";
import PlanetOrb from "@/components/landing/PlanetOrb";
import Logo from "@/components/Logo";
import { CATEGORIES } from "@/lib/categories";
import { formatCompact, formatNumber } from "@/lib/format";
import { getUniverse } from "@/lib/server/universe";
import "./landing.css";

const REPO_URL = "https://github.com/ton111nerd/gitgreat";

function Arrow() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Check() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.5 8.5 6.5 11.5 12.5 5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default async function Landing() {
  // Cached snapshot (refreshed by the cron job) – the landing page never calls GitHub directly.
  const data = await getUniverse("7d");
  const live = data.source === "live";
  const repos = data.repos;
  const movers = [...repos].sort((a, b) => (live ? (b.growth ?? 0) - (a.growth ?? 0) : b.stars - a.stars)).slice(0, 5);
  const maxMover = Math.max(1, ...movers.map((r) => (live ? (r.growth ?? 0) : r.stars)));
  const growthSum = repos.reduce((s, r) => s + (r.growth ?? 0), 0);
  const starSum = repos.reduce((s, r) => s + r.stars, 0);
  const byCat = CATEGORIES.map((c) => {
    const list = repos.filter((r) => r.category === c.id);
    const top = [...list].sort((a, b) => (b.growth ?? b.stars) - (a.growth ?? a.stars))[0];
    return { cat: c, count: list.length, top };
  });
  const galaxies = byCat.filter((g) => g.count > 0).length;
  const languages = new Set(repos.map((r) => r.language).filter(Boolean)).size;

  return (
    <div className="lp">
      <LegacyRedirect />
      <header className="lp-nav">
        <Logo />
        <nav aria-label="Hauptnavigation">
          <a href="#so-funktionierts">So funktioniert’s</a>
          <a href="#galaxien">Galaxien</a>
          <a href="#vertrauen">Vertrauen</a>
        </nav>
        <Link href="/explore" className="lp-btn lp-btn-light lp-btn-sm">
          Universum öffnen
        </Link>
      </header>

      <section className="hero" aria-labelledby="hero-title">
        <HeroBackdrop />
        <div className="hero-fade" aria-hidden="true" />
        <div className="hero-inner">
          <div className="hero-copy">
            <p className="eyebrow">
              <span className={`live-dot${live ? " on" : ""}`} aria-hidden="true" />
              {live ? "Live" : "Vorschau"} · {repos.length} Repositories · <LiveSince iso={data.generatedAt} source={data.source} />
            </p>
            <h1 id="hero-title">
              Was auf GitHub
              <br />
              <span className="grad">gerade abhebt.</span>
            </h1>
            <p className="lede">
              GitHub Universe kartiert die am schnellsten wachsenden Open-Source-Projekte als Weltall. Galaxien sind Themenfelder, Planeten sind Projekte – und je
              heller einer leuchtet, desto mehr Menschen entdecken ihn gerade.
            </p>
            <div className="cta-row">
              <Link href="/explore" className="lp-btn lp-btn-light">
                Universum betreten <Arrow />
              </Link>
              <Link href="/explore?view=list" className="lp-btn lp-btn-ghost">
                Trend-Liste ansehen
              </Link>
            </div>
            <p className="fineprint">Kostenlos · Keine Anmeldung · Daten direkt von GitHub</p>
          </div>

          <aside className="movers glass" aria-labelledby="movers-title">
            <div className="movers-head">
              <h2 id="movers-title">{live ? "Im Aufwind" : "Meiste Stars"}</h2>
              <span className="pill">{live ? "7 Tage" : "Gesamt"}</span>
            </div>
            <ol>
              {movers.map((r, i) => {
                const val = live ? (r.growth ?? 0) : r.stars;
                return (
                  <li key={r.id}>
                    <Link href={`/explore?repo=${encodeURIComponent(r.id)}`} className="mover">
                      <span className="rank">{i + 1}</span>
                      <PlanetOrb category={r.category} variant={i} size={26} />
                      <span className="mover-name">
                        <span className="mover-repo">{r.name}</span>
                        <span className="mover-owner">{r.owner}</span>
                      </span>
                      <span className="mover-val">
                        {live ? "+" : "★ "}
                        {formatCompact(val)}
                        <span className="bar" style={{ width: `${Math.max(8, (val / maxMover) * 100)}%` }} aria-hidden="true" />
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ol>
            <Link href="/explore" className="movers-more">
              Alle {repos.length} ansehen <Arrow />
            </Link>
          </aside>
        </div>
        <a href="#so-funktionierts" className="scroll-cue" aria-label="Weiter nach unten">
          <span />
        </a>
      </section>

      <section className="lp-stats" aria-label="Kennzahlen">
        <div>
          <strong>{formatNumber(repos.length)}</strong>
          <span>Repositories im Blick</span>
        </div>
        <div>
          <strong>{galaxies}</strong>
          <span>Galaxien</span>
        </div>
        <div>
          <strong>{live ? `+${formatCompact(growthSum)}` : formatCompact(starSum)}</strong>
          <span>{live ? "neue Stars in 7 Tagen" : "Stars gesamt"}</span>
        </div>
        <div>
          <strong>{languages}</strong>
          <span>Programmiersprachen</span>
        </div>
      </section>

      <section id="so-funktionierts" className="lp-section">
        <p className="kicker">Die Logik</p>
        <h2 className="h2">Ein Blick genügt.</h2>
        <p className="sub">Drei visuelle Regeln – mehr musst du nicht wissen, um Trends zu lesen.</p>
        <div className="rules">
          <article className="rule glass">
            <div className="rule-visual" aria-hidden="true">
              <PlanetOrb category="ai" variant={0} size={44} />
              <PlanetOrb category="web" variant={1} size={34} />
              <PlanetOrb category="security" variant={2} size={38} />
            </div>
            <h3>Galaxie = Kategorie</h3>
            <p>Neun Galaxien ordnen das Chaos: KI, Web, Security, Daten und mehr. Jede trägt ihre eigene Farbe.</p>
          </article>
          <article className="rule glass">
            <div className="rule-visual" aria-hidden="true">
              <PlanetOrb category="data" variant={1} size={18} />
              <PlanetOrb category="data" variant={0} size={36} />
              <PlanetOrb category="data" variant={2} size={58} />
            </div>
            <h3>Größe = Stars gesamt</h3>
            <p>Große Planeten sind etablierte Projekte mit vielen Fans – logarithmisch skaliert, damit auch Newcomer sichtbar bleiben.</p>
          </article>
          <article className="rule glass">
            <div className="rule-visual" aria-hidden="true">
              <PlanetOrb category="devtools" variant={0} size={36} glow={0} />
              <PlanetOrb category="devtools" variant={2} size={36} glow={1} />
            </div>
            <h3>Leuchten = Momentum</h3>
            <p>Wer gerade schnell neue Stars sammelt, strahlt. Wähle den Zeitraum: 24 Stunden, 7 oder 30 Tage.</p>
          </article>
        </div>
      </section>

      <section id="galaxien" className="lp-section">
        <p className="kicker">Die Karte</p>
        <h2 className="h2">Neun Galaxien. Hunderte Welten.</h2>
        <p className="sub">Spring direkt in das Themenfeld, das dich interessiert.</p>
        <div className="galaxy-grid">
          {byCat.map(({ cat, count, top }, i) => (
            <Link key={cat.id} href={`/explore?cat=${cat.id}`} className="galaxy-card glass" style={{ ["--c" as string]: cat.color }}>
              <PlanetOrb category={cat.id} variant={i} size={52} />
              <div>
                <h3>{cat.label}</h3>
                <p>{cat.plain}</p>
                <span className="meta">
                  {count} Repos{top ? ` · Top: ${top.name}` : ""}
                </span>
              </div>
              <span className="go" aria-hidden="true">
                <Arrow />
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section className="lp-section">
        <p className="kicker">Für wen</p>
        <h2 className="h2">Gebaut für Neugierige – und für Profis.</h2>
        <div className="audiences">
          <article className="glass audience">
            <h3>Für Entwickler</h3>
            <ul>
              <li>
                <Check /> Filtern nach Sprache, Kategorie und Zeitraum
              </li>
              <li>
                <Check /> Wachstum exakt aus Star-Zeitstempeln gezählt
              </li>
              <li>
                <Check /> Install-Befehl aus dem Manifest, gegen die Registry geprüft
              </li>
              <li>
                <Check /> Mit einem Klick im Browser testen (Codespaces)
              </li>
            </ul>
          </article>
          <article className="glass audience">
            <h3>Für Gründer, Investoren &amp; Neugierige</h3>
            <ul>
              <li>
                <Check /> Jedes Projekt in zwei Sätzen erklärt
              </li>
              <li>
                <Check /> „Vergleichbar mit …“ statt Fachjargon
              </li>
              <li>
                <Check /> Trends erkennen, bevor sie Schlagzeilen machen
              </li>
              <li>
                <Check /> Teilbare Links zu jedem Projekt
              </li>
            </ul>
          </article>
        </div>
      </section>

      <section id="vertrauen" className="lp-section trust-section">
        <div className="trust-copy">
          <p className="kicker">Sicherheit</p>
          <h2 className="h2">Vertrauen ist eingebaut.</h2>
          <ul className="trust-points">
            <li>
              <strong>Vertrauens-Ampel</strong>
              <span>Lizenz, Alter, Aktivität und Forks-Verhältnis auf einen Blick – auffällige Popularität wird markiert.</span>
            </li>
            <li>
              <strong>Geprüfte Befehle</strong>
              <span>Paketnamen werden gegen npm, PyPI und crates.io abgeglichen, damit du nicht das falsche Paket installierst.</span>
            </li>
            <li>
              <strong>Nichts wird ausgeführt</strong>
              <span>Befehle gibt es nur zum Kopieren. Keine Anmeldung, keine Schlüssel im Browser.</span>
            </li>
          </ul>
        </div>
        <div className="trust-mock glass" aria-hidden="true">
          <div className="tm-head">
            <PlanetOrb category="devtools" variant={3} size={34} />
            <div>
              <span className="tm-cat">DevTools</span>
              <strong>astral-sh/uv</strong>
            </div>
          </div>
          <div className="tm-light">
            <span className="tl">
              <i />
              <i />
              <i className="on" />
            </span>
            <span>
              <strong>Solide Signale</strong>
              <small>Lizenz · etabliert · aktiv · stimmiges Verhältnis</small>
            </span>
          </div>
          <div className="tm-cmd">
            <code>pip install uv</code>
            <span>Kopieren</span>
          </div>
          <p className="tm-note">Paket in PyPI bestätigt · Prüfe Repos vor der Installation.</p>
        </div>
      </section>

      <section className="final-cta">
        <div className="final-glow" aria-hidden="true" />
        <h2 className="h2">Bereit für den Start?</h2>
        <p className="sub">Zoome durch {galaxies} Galaxien und finde das nächste große Ding, bevor es alle kennen.</p>
        <Link href="/explore" className="lp-btn lp-btn-light">
          Universum betreten <Arrow />
        </Link>
      </section>

      <footer className="lp-footer">
        <Logo />
        <p>
          Daten: GitHub API · Erklärungen: Claude · <LiveSince iso={data.generatedAt} source={data.source} />
        </p>
        <p className="muted">
          Unabhängiges Projekt, nicht mit GitHub, Inc. verbunden ·{" "}
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
            Quellcode
          </a>
        </p>
      </footer>
    </div>
  );
}
