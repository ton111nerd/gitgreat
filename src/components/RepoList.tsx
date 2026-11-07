"use client";

import { useMemo, useState } from "react";
import { CATEGORY_BY_ID } from "@/lib/categories";
import { formatCompact, formatGrowth } from "@/lib/format";
import type { Period, UniverseRepo } from "@/lib/types";

export type SortKey = "growth" | "stars" | "name";

interface Props {
  repos: UniverseRepo[];
  period: Period;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const LIGHT_LABEL = { green: "Ampel grün", yellow: "Ampel gelb", red: "Ampel rot" } as const;

export default function RepoList({ repos, period, selectedId, onSelect }: Props) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "growth", dir: -1 });

  const sorted = useMemo(() => {
    const val = (r: UniverseRepo) => (sort.key === "growth" ? (r.growth ?? -1) : sort.key === "stars" ? r.stars : 0);
    return [...repos].sort((a, b) =>
      sort.key === "name" ? sort.dir * a.name.localeCompare(b.name, "de") : sort.dir * (val(a) - val(b)) || b.stars - a.stars,
    );
  }, [repos, sort]);

  const header = (key: SortKey, label: string, className = "") => {
    const active = sort.key === key;
    return (
      <th className={className} aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"} scope="col">
        <button
          type="button"
          className={`sort-btn${active ? " active" : ""}`}
          onClick={() => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === "name" ? 1 : -1 }))}
        >
          {label}
          <span aria-hidden="true">{active ? (sort.dir === 1 ? " ↑" : " ↓") : " ↕"}</span>
        </button>
      </th>
    );
  };

  if (!repos.length) {
    return <p className="empty">Keine Repositories passen zu deiner Suche. Versuch es mit weniger Filtern.</p>;
  }

  return (
    <div className="list-wrap">
      <table className="repo-table">
        <caption className="sr-only">Repositories, sortierbar nach Name, Stars und Wachstum</caption>
        <thead>
          <tr>
            {header("name", "Repository", "col-name")}
            <th scope="col" className="col-cat">
              Kategorie
            </th>
            <th scope="col" className="col-lang">
              Sprache
            </th>
            {header("stars", "Stars", "num")}
            {header("growth", "Wachstum", "num")}
            <th scope="col" className="col-trust">
              <span className="sr-only">Vertrauen</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const cat = CATEGORY_BY_ID[r.category];
            return (
              <tr key={r.id} className={r.id === selectedId ? "selected" : undefined}>
                <td className="col-name">
                  <button type="button" className="row-btn" onClick={() => onSelect(r.id)}>
                    <span className="dot" style={{ background: cat.color }} aria-hidden="true" />
                    <span className="row-title">
                      <span className="owner">{r.owner}/</span>
                      <strong>{r.name}</strong>
                    </span>
                    <span className="row-sub">{r.explanation}</span>
                  </button>
                </td>
                <td className="col-cat">{cat.label}</td>
                <td className="col-lang">{r.language ?? "—"}</td>
                <td className="num">{formatCompact(r.stars)}</td>
                <td className="num accent">{r.growth === null ? "—" : formatGrowth(r.growth, r.growthMethod, period).replace(/ in .*/, "")}</td>
                <td className="col-trust">
                  <span className={`light light-${r.trust.level}`} title={`${LIGHT_LABEL[r.trust.level]}: ${r.trust.summary}`}>
                    <span className="sr-only">{LIGHT_LABEL[r.trust.level]}</span>
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
