/**
 * Builds data/fallback.json – the static snapshot shown when no live data exists yet.
 *
 *   npx tsx scripts/build-fallback.ts
 *
 * Repo metadata: OSSInsight's GitHub mirror (/gh/repos/{owner}/{repo}, no key needed).
 * Manifests: raw.githubusercontent.com. Explanations: curated in data/fallback-seed.json.
 * Growth is unknown for offline data and therefore null.
 */
import { writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { deriveInstall, type ManifestInput } from "../src/lib/install";
import { verifyRegistries } from "../src/lib/server/registry";
import type { CategoryId, Snapshot, SnapshotRepo } from "../src/lib/types";

const root = path.resolve(import.meta.dirname, "..");
const seed = JSON.parse(readFileSync(path.join(root, "data/fallback-seed.json"), "utf8")) as Array<[string, CategoryId, string]>;

const TEXT_MANIFESTS = ["package.json", "pyproject.toml", "setup.py", "Cargo.toml", "go.mod"] as const;
const PRESENCE_ONLY = ["Dockerfile", "main.go", "src/main.rs"] as const;

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

async function buildOne([id, category, explanation]: [string, CategoryId, string]): Promise<SnapshotRepo | null> {
  const metaText = await fetchText(`https://api.ossinsight.io/gh/repos/${id}`);
  if (!metaText) {
    console.warn(`skip ${id}: metadata unavailable`);
    return null;
  }
  const d = JSON.parse(metaText).data as {
    full_name?: string;
    private?: boolean;
    fork?: boolean;
    html_url: string;
    homepage?: string | null;
    description?: string | null;
    language?: string | null;
    license?: { spdx_id?: string | null } | null;
    stargazers_count: number;
    forks_count: number;
    created_at: string;
    pushed_at?: string | null;
    topics?: string[];
    archived?: boolean;
  };
  if (!d?.full_name || d.private || d.fork) return null;
  const fullName = d.full_name;

  const files: string[] = [];
  const contents: ManifestInput["contents"] = {};
  await Promise.all([
    ...TEXT_MANIFESTS.map(async (f) => {
      const text = await fetchText(`https://raw.githubusercontent.com/${fullName}/HEAD/${f}`);
      if (text !== null) {
        files.push(f);
        contents[f] = text;
      }
    }),
    ...PRESENCE_ONLY.map(async (f) => {
      if ((await fetchText(`https://raw.githubusercontent.com/${fullName}/HEAD/${f}`)) !== null) files.push(f);
    }),
  ]);
  const manifest: ManifestInput = { repoId: fullName, files, contents, hasMainRs: files.includes("src/main.rs"), language: d.language ?? null };
  const verified = await verifyRegistries(manifest);
  const install = deriveInstall({ ...manifest, verified });
  const spdx: string | null = d.license?.spdx_id ?? null;

  return {
    id: fullName,
    url: d.html_url,
    homepage: typeof d.homepage === "string" && d.homepage.trim() ? d.homepage.trim() : null,
    description: d.description ?? null,
    language: d.language ?? null,
    license: spdx && spdx !== "NOASSERTION" ? spdx : d.license ? "NOASSERTION" : null,
    stars: d.stargazers_count,
    forks: d.forks_count,
    createdAt: d.created_at,
    pushedAt: d.pushed_at ?? null,
    topics: Array.isArray(d.topics) ? d.topics.slice(0, 15) : [],
    archived: Boolean(d.archived),
    growth: { "24h": null, "7d": null, "30d": null },
    enrichment: { category, explanation, source: "curated", install, enrichedAt: new Date().toISOString() },
  };
}

async function main() {
  const out: SnapshotRepo[] = [];
  const queue = [...seed];
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (queue.length) {
        const item = queue.shift()!;
        const repo = await buildOne(item);
        if (repo) out.push(repo);
      }
    }),
  );
  out.sort((a, b) => b.stars - a.stars);
  const snapshot: Snapshot = { version: 1, generatedAt: new Date().toISOString(), source: "fallback", repos: out };
  writeFileSync(path.join(root, "data/fallback.json"), JSON.stringify(snapshot, null, 1) + "\n");
  const withInstall = out.filter((r) => r.enrichment.install).length;
  console.log(`wrote ${out.length}/${seed.length} repos (${withInstall} with install command)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
