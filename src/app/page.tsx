import { Suspense } from "react";
import UniverseApp from "@/components/UniverseApp";
import { getUniverse } from "@/lib/server/universe";
import { isPeriod } from "@/lib/types";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

async function Universe({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const p = first(sp.period);
  const period = isPeriod(p) ? p : "7d";
  // Served from the cached snapshot (refreshed hourly by the cron job) – never from GitHub directly.
  const initial = await getUniverse(period);
  return (
    <UniverseApp
      initial={initial}
      initialState={{
        view: first(sp.view) === "list" ? "list" : "space",
        query: first(sp.q)?.slice(0, 100) ?? "",
        repo: first(sp.repo) ?? null,
      }}
    />
  );
}

function LoadingShell() {
  return (
    <div className="loading-shell" role="status">
      <div className="loading-orb" aria-hidden="true" />
      <p>Universum wird geladen …</p>
    </div>
  );
}

export default function Page({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<LoadingShell />}>
      <Universe searchParams={searchParams} />
    </Suspense>
  );
}
