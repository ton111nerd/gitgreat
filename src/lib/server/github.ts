/**
 * Minimal GitHub GraphQL client (server only – needs GITHUB_TOKEN).
 * All calls are batched via aliases to stay well inside the 5,000 points/hour budget.
 */

const ENDPOINT = "https://api.github.com/graphql";

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly rateLimited = false,
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

export type FetchLike = typeof fetch;

export interface GitHubClientOptions {
  token: string;
  fetchImpl?: FetchLike;
  /** Stop issuing requests when fewer points than this remain. */
  minRemaining?: number;
}

export interface RepoCore {
  nameWithOwner: string;
  url: string;
  homepageUrl: string | null;
  description: string | null;
  stargazerCount: number;
  forkCount: number;
  createdAt: string;
  pushedAt: string | null;
  isArchived: boolean;
  isFork: boolean;
  isPrivate: boolean;
  primaryLanguage: { name: string } | null;
  licenseInfo: { spdxId: string | null; name: string } | null;
  repositoryTopics: { nodes: Array<{ topic: { name: string } }> };
}

export interface StargazerPage {
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  edges: Array<{ starredAt: string }>;
}

export interface RepoWithStars extends RepoCore {
  stargazers: StargazerPage;
}

export interface RepoFiles {
  id: string;
  files: string[];
  contents: Record<string, string>;
  hasMainRs: boolean;
  readme: string | null;
}

const CORE_FIELDS = `
  nameWithOwner url homepageUrl description stargazerCount forkCount createdAt pushedAt
  isArchived isFork isPrivate
  primaryLanguage { name }
  licenseInfo { spdxId name }
  repositoryTopics(first: 15) { nodes { topic { name } } }`;

const STARGAZER_FIELDS = (after: string) =>
  `stargazers(first: 100, after: ${after}, orderBy: { field: STARRED_AT, direction: DESC }) {
    pageInfo { hasNextPage endCursor }
    edges { starredAt }
  }`;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function splitRepoId(id: string): [string, string] {
  const [owner, name] = id.split("/");
  return [owner, name];
}

export class GitHubClient {
  private readonly token: string;
  private readonly fetchImpl: FetchLike;
  private readonly minRemaining: number;
  remaining: number | null = null;
  requests = 0;

  constructor(opts: GitHubClientOptions) {
    this.token = opts.token;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.minRemaining = opts.minRemaining ?? 200;
  }

  async graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    if (this.remaining !== null && this.remaining < this.minRemaining) {
      throw new GitHubError(`GitHub rate limit budget nearly exhausted (${this.remaining} left)`, 429, true);
    }
    this.requests++;
    const res = await this.fetchImpl(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        "User-Agent": "github-universe",
      },
      body: JSON.stringify({ query, variables }),
      cache: "no-store",
    });
    const remainingHeader = res.headers.get("x-ratelimit-remaining");
    if (remainingHeader !== null) this.remaining = Number(remainingHeader);

    if (res.status === 401) throw new GitHubError("GitHub token rejected (401)", 401);
    if (res.status === 403 || res.status === 429) {
      throw new GitHubError(`GitHub rate limited (${res.status})`, res.status, true);
    }
    if (!res.ok) throw new GitHubError(`GitHub GraphQL HTTP ${res.status}`, res.status);

    const body = (await res.json()) as { data?: T; errors?: Array<{ type?: string; message: string }> };
    const fatal = (body.errors ?? []).filter((e) => e.type !== "NOT_FOUND" && e.type !== "FORBIDDEN");
    if (fatal.some((e) => e.type === "RATE_LIMITED")) throw new GitHubError("GitHub GraphQL rate limited", 429, true);
    if (!body.data) throw new GitHubError(`GitHub GraphQL error: ${fatal.map((e) => e.message).join("; ") || "no data"}`);
    return body.data;
  }

  /** Runs several repository searches; returns unique "owner/name" ids in result order. */
  async searchRepoIds(queries: Array<{ q: string; first: number }>): Promise<string[]> {
    const ids: string[] = [];
    for (const group of chunk(queries, 6)) {
      const vars: Record<string, unknown> = {};
      const defs: string[] = [];
      const parts = group.map((s, i) => {
        vars[`q${i}`] = s.q;
        defs.push(`$q${i}: String!`);
        return `s${i}: search(query: $q${i}, type: REPOSITORY, first: ${Math.min(100, s.first)}) {
          nodes { ... on Repository { nameWithOwner } }
        }`;
      });
      const data = await this.graphql<Record<string, { nodes: Array<{ nameWithOwner?: string } | null> }>>(
        `query(${defs.join(", ")}) { ${parts.join("\n")} }`,
        vars,
      );
      for (let i = 0; i < group.length; i++) {
        for (const n of data[`s${i}`]?.nodes ?? []) if (n?.nameWithOwner) ids.push(n.nameWithOwner);
      }
    }
    return [...new Set(ids)];
  }

  /** Core metadata + first page (100) of most recent stargazers. Missing repos are skipped. */
  async fetchReposWithStars(ids: string[]): Promise<RepoWithStars[]> {
    const out: RepoWithStars[] = [];
    for (const group of chunk(ids, 10)) {
      const vars: Record<string, unknown> = {};
      const defs: string[] = [];
      const parts = group.map((id, i) => {
        const [owner, name] = splitRepoId(id);
        vars[`o${i}`] = owner;
        vars[`n${i}`] = name;
        defs.push(`$o${i}: String!`, `$n${i}: String!`);
        return `r${i}: repository(owner: $o${i}, name: $n${i}) { ${CORE_FIELDS} ${STARGAZER_FIELDS("null")} }`;
      });
      const data = await this.graphql<Record<string, RepoWithStars | null>>(`query(${defs.join(", ")}) { ${parts.join("\n")} }`, vars);
      for (let i = 0; i < group.length; i++) {
        const repo = data[`r${i}`];
        if (repo) out.push(repo);
      }
    }
    return out;
  }

  /** Next stargazer pages for repos whose first page did not reach far enough back. */
  async fetchStargazerPages(requests: Array<{ id: string; after: string }>): Promise<Map<string, StargazerPage>> {
    const out = new Map<string, StargazerPage>();
    for (const group of chunk(requests, 10)) {
      const vars: Record<string, unknown> = {};
      const defs: string[] = [];
      const parts = group.map((req, i) => {
        const [owner, name] = splitRepoId(req.id);
        vars[`o${i}`] = owner;
        vars[`n${i}`] = name;
        vars[`c${i}`] = req.after;
        defs.push(`$o${i}: String!`, `$n${i}: String!`, `$c${i}: String!`);
        return `r${i}: repository(owner: $o${i}, name: $n${i}) { ${STARGAZER_FIELDS(`$c${i}`)} }`;
      });
      const data = await this.graphql<Record<string, { stargazers: StargazerPage } | null>>(
        `query(${defs.join(", ")}) { ${parts.join("\n")} }`,
        vars,
      );
      group.forEach((req, i) => {
        const page = data[`r${i}`]?.stargazers;
        if (page) out.set(req.id, page);
      });
    }
    return out;
  }

  /** Root file list, manifest contents and README start – used once per new repo. */
  async fetchRepoFiles(ids: string[]): Promise<RepoFiles[]> {
    const blobs: Record<string, string> = {
      pkg: "package.json",
      pyproject: "pyproject.toml",
      setup: "setup.py",
      cargo: "Cargo.toml",
      gomod: "go.mod",
      readme1: "README.md",
      readme2: "readme.md",
      readme3: "README.rst",
      readme4: "README",
    };
    const blobFields = Object.entries(blobs)
      .map(([alias, file]) => `${alias}: object(expression: "HEAD:${file}") { ... on Blob { text } }`)
      .join("\n");
    const out: RepoFiles[] = [];
    for (const group of chunk(ids, 5)) {
      const vars: Record<string, unknown> = {};
      const defs: string[] = [];
      const parts = group.map((id, i) => {
        const [owner, name] = splitRepoId(id);
        vars[`o${i}`] = owner;
        vars[`n${i}`] = name;
        defs.push(`$o${i}: String!`, `$n${i}: String!`);
        return `r${i}: repository(owner: $o${i}, name: $n${i}) {
          root: object(expression: "HEAD:") { ... on Tree { entries { name } } }
          mainrs: object(expression: "HEAD:src/main.rs") { id }
          ${blobFields}
        }`;
      });
      type Obj = { text?: string | null; id?: string; entries?: Array<{ name: string }> } | null;
      const data = await this.graphql<Record<string, Record<string, Obj> | null>>(`query(${defs.join(", ")}) { ${parts.join("\n")} }`, vars);
      group.forEach((id, i) => {
        const r = data[`r${i}`];
        if (!r) return;
        const contents: Record<string, string> = {};
        for (const [alias, file] of Object.entries(blobs)) {
          const text = r[alias]?.text;
          if (typeof text === "string" && !alias.startsWith("readme")) contents[file] = text.slice(0, 100_000);
        }
        const readme = ["readme1", "readme2", "readme3", "readme4"].map((a) => r[a]?.text).find((t) => typeof t === "string") ?? null;
        out.push({
          id,
          files: (r.root?.entries ?? []).map((e) => e.name),
          contents,
          hasMainRs: Boolean(r.mainrs?.id),
          readme: readme ? readme.slice(0, 6000) : null,
        });
      });
    }
    return out;
  }
}
