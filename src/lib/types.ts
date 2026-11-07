// Shared data model for GitHub Universe (server + client).

export const PERIODS = ["24h", "7d", "30d"] as const;
export type Period = (typeof PERIODS)[number];

export const PERIOD_HOURS: Record<Period, number> = { "24h": 24, "7d": 24 * 7, "30d": 24 * 30 };

export const PERIOD_LABELS: Record<Period, string> = {
  "24h": "24 h",
  "7d": "7 Tage",
  "30d": "30 Tage",
};

export function isPeriod(value: unknown): value is Period {
  return typeof value === "string" && (PERIODS as readonly string[]).includes(value);
}

export const CATEGORY_IDS = [
  "ai",
  "devtools",
  "web",
  "security",
  "data",
  "mobile",
  "infra",
  "games",
  "other",
] as const;
export type CategoryId = (typeof CATEGORY_IDS)[number];

/** How a growth number was obtained. */
export type GrowthMethod =
  | "exact" // counted from stargazer timestamps
  | "history" // difference between our own hourly snapshots
  | "estimated"; // extrapolated from the most recent stargazers

export interface GrowthValue {
  value: number;
  method: GrowthMethod;
}

export type InstallManager = "npm" | "pip" | "cargo" | "go" | "docker";

export interface InstallInfo {
  manager: InstallManager;
  command: string;
  /** Manifest file the command was derived from, e.g. "package.json". */
  manifest: string;
  /** true when the package name was verified against the public registry. */
  verified: boolean;
}

export interface Enrichment {
  category: CategoryId;
  /** Two plain-language sentences (German) – or the GitHub description as fallback. */
  explanation: string;
  source: "llm" | "keywords" | "curated";
  install: InstallInfo | null;
  enrichedAt: string;
}

/** Raw facts about one repository, as stored in the hourly snapshot. */
export interface RepoRecord {
  id: string; // "owner/name"
  url: string;
  homepage: string | null;
  description: string | null;
  language: string | null;
  license: string | null; // SPDX id (or license name), null = no license
  stars: number;
  forks: number;
  createdAt: string;
  pushedAt: string | null;
  topics: string[];
  archived: boolean;
  growth: Record<Period, GrowthValue | null>;
}

export interface SnapshotRepo extends RepoRecord {
  enrichment: Enrichment;
}

export interface Snapshot {
  version: 1;
  generatedAt: string;
  source: "live" | "fallback";
  repos: SnapshotRepo[];
}

export type TrustStatus = "good" | "warn" | "bad";

export interface TrustSignal {
  id: "license" | "age" | "activity" | "ratio";
  status: TrustStatus;
  label: string;
  detail: string;
}

export interface TrustResult {
  level: "green" | "yellow" | "red";
  summary: string;
  unusualPopularity: boolean;
  signals: TrustSignal[];
}

/** One repository as delivered to the browser. */
export interface UniverseRepo {
  id: string;
  owner: string;
  name: string;
  url: string;
  homepage: string | null;
  description: string | null;
  explanation: string;
  explanationSource: Enrichment["source"];
  category: CategoryId;
  language: string | null;
  license: string | null;
  stars: number;
  forks: number;
  createdAt: string;
  pushedAt: string | null;
  topics: string[];
  growth: number | null;
  growthMethod: GrowthMethod | null;
  install: InstallInfo | null;
  trust: TrustResult;
}

export interface UniversePayload {
  period: Period;
  generatedAt: string;
  source: "live" | "fallback";
  /** Optional hint shown in the UI, e.g. when only offline data is available. */
  notice: string | null;
  repos: UniverseRepo[];
}
