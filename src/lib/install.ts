import type { InstallInfo } from "./types";

/**
 * Derives a copy-able install command from manifest files in the repo root.
 *
 * SECURITY: names come from untrusted repository files and end up in a command the
 * user may paste into a shell. Every name is checked against a strict whitelist
 * regex; anything else is rejected. We never execute these commands ourselves.
 */

export const MANIFEST_FILES = ["package.json", "pyproject.toml", "setup.py", "Cargo.toml", "go.mod", "Dockerfile"] as const;
export type ManifestFile = (typeof MANIFEST_FILES)[number];

export interface ManifestInput {
  repoId: string; // "owner/name"
  /** Names of files/dirs in the repository root. */
  files: string[];
  /** Text content of manifest files (Dockerfile content is not needed). */
  contents: Partial<Record<Exclude<ManifestFile, "Dockerfile">, string>>;
  /** true when src/main.rs exists (Rust binary crate). */
  hasMainRs?: boolean;
  /** Primary language reported by GitHub. Manifests that don't match it are ignored
   *  (e.g. a tooling pyproject.toml inside a C++ repo). */
  language?: string | null;
  /** Registry verification: does the registry package point back to this repo? */
  verified?: { npm?: boolean; pypi?: boolean; crates?: boolean; crateHasBin?: boolean };
}

const LANGUAGES: Record<Exclude<InstallInfo["manager"], "docker">, string[]> = {
  npm: ["JavaScript", "TypeScript", "Vue", "Svelte", "Astro", "CoffeeScript", "MDX"],
  pip: ["Python", "Jupyter Notebook", "Cython"],
  cargo: ["Rust"],
  go: ["Go"],
};

/** Without a known language every manifest is allowed. */
export function languageAllows(manager: keyof typeof LANGUAGES, language: string | null | undefined): boolean {
  return !language || LANGUAGES[manager].includes(language);
}

const RE_REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const RE_NPM = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
const RE_PYPI = /^[A-Za-z0-9]([A-Za-z0-9._-]{0,98}[A-Za-z0-9])?$/;
const RE_CRATE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const RE_GOMOD = /^[A-Za-z0-9][A-Za-z0-9.\-_~/]{0,200}$/;

export const isSafeNpmName = (n: string) => RE_NPM.test(n) && n.length <= 214;
export const isSafePypiName = (n: string) => RE_PYPI.test(n);
export const isSafeCrateName = (n: string) => RE_CRATE.test(n);
export const isSafeGoModule = (n: string) => RE_GOMOD.test(n) && !n.includes("..") && n.includes(".");

export interface ParsedNames {
  npm: { name: string; private: boolean; hasBin: boolean } | null;
  pypi: string | null;
  setupPyName: string | null;
  crate: { name: string | null; workspace: boolean; hasBinSection: boolean } | null;
  goModule: string | null;
}

/** Extracts the value of `key = "value"` inside a TOML [section]. Small, dependency-free. */
export function tomlSectionValue(toml: string, section: string, key: string): string | null {
  const lines = toml.split(/\r?\n/);
  let inSection = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("[")) {
      inSection = line === `[${section}]`;
      continue;
    }
    if (!inSection) continue;
    const m = line.match(new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=\\s*["']([^"']+)["']`));
    if (m) return m[1];
  }
  return null;
}

export function parseManifestNames(input: ManifestInput): ParsedNames {
  const out: ParsedNames = { npm: null, pypi: null, setupPyName: null, crate: null, goModule: null };

  const pkg = input.contents["package.json"];
  if (pkg) {
    try {
      const json = JSON.parse(pkg) as { name?: unknown; private?: unknown; bin?: unknown };
      if (typeof json.name === "string") {
        out.npm = { name: json.name, private: json.private === true, hasBin: json.bin != null };
      }
    } catch {
      /* invalid JSON – ignore */
    }
  }

  const py = input.contents["pyproject.toml"];
  if (py) out.pypi = tomlSectionValue(py, "project", "name") ?? tomlSectionValue(py, "tool.poetry", "name");

  const setup = input.contents["setup.py"];
  if (setup) {
    const m = setup.match(/\bname\s*=\s*["']([^"']+)["']/);
    out.setupPyName = m ? m[1] : null;
  }

  const cargo = input.contents["Cargo.toml"];
  if (cargo) {
    out.crate = {
      name: tomlSectionValue(cargo, "package", "name"),
      workspace: /^\s*\[workspace\]/m.test(cargo),
      hasBinSection: /^\s*\[\[bin\]\]/m.test(cargo),
    };
  }

  const gomod = input.contents["go.mod"];
  if (gomod) {
    const m = gomod.match(/^\s*module\s+(\S+)/m);
    out.goModule = m ? m[1].replace(/^"|"$/g, "") : null;
  }
  return out;
}

/**
 * Returns the best install command, or null when nothing can be derived
 * (the UI then hides the install block).
 * Order follows the spec: package.json → pyproject/setup.py → Cargo.toml → go.mod → Dockerfile.
 */
export function deriveInstall(input: ManifestInput): InstallInfo | null {
  if (!RE_REPO.test(input.repoId)) return null;
  const files = new Set(input.files);
  const names = parseManifestNames(input);
  const gitUrl = `https://github.com/${input.repoId}`;

  // npm
  if (files.has("package.json") && names.npm && !names.npm.private && languageAllows("npm", input.language)) {
    const { name, hasBin } = names.npm;
    if (isSafeNpmName(name) && input.verified?.npm) {
      return {
        manager: "npm",
        command: hasBin ? `npm install -g ${name}` : `npm install ${name}`,
        manifest: "package.json",
        verified: true,
      };
    }
    return { manager: "npm", command: `npm install github:${input.repoId}`, manifest: "package.json", verified: false };
  }

  // pip
  if ((files.has("pyproject.toml") || files.has("setup.py")) && languageAllows("pip", input.language)) {
    const name = names.pypi ?? names.setupPyName;
    const manifest = files.has("pyproject.toml") ? "pyproject.toml" : "setup.py";
    if (name && isSafePypiName(name) && input.verified?.pypi) {
      return { manager: "pip", command: `pip install ${name}`, manifest, verified: true };
    }
    return { manager: "pip", command: `pip install git+${gitUrl}.git`, manifest, verified: false };
  }

  // cargo
  if (files.has("Cargo.toml") && names.crate && languageAllows("cargo", input.language)) {
    const { name, workspace, hasBinSection } = names.crate;
    const isBin = input.verified?.crateHasBin ?? (hasBinSection || input.hasMainRs === true);
    if (name && isSafeCrateName(name)) {
      if (input.verified?.crates) {
        return { manager: "cargo", command: isBin ? `cargo install ${name}` : `cargo add ${name}`, manifest: "Cargo.toml", verified: true };
      }
      return {
        manager: "cargo",
        command: isBin ? `cargo install --git ${gitUrl} ${name}` : `cargo add --git ${gitUrl} ${name}`,
        manifest: "Cargo.toml",
        verified: false,
      };
    }
    if (workspace) {
      return { manager: "cargo", command: `cargo install --git ${gitUrl}`, manifest: "Cargo.toml", verified: false };
    }
  }

  // go
  if (files.has("go.mod") && names.goModule && isSafeGoModule(names.goModule) && languageAllows("go", input.language)) {
    const mod = names.goModule;
    let command: string;
    if (files.has("main.go")) command = `go install ${mod}@latest`;
    else if (files.has("cmd")) command = `go install ${mod}/cmd/...@latest`;
    else command = `go get ${mod}@latest`;
    return { manager: "go", command, manifest: "go.mod", verified: true };
  }

  // docker
  if (files.has("Dockerfile")) {
    const tag = input.repoId.split("/")[1].toLowerCase().replace(/[^a-z0-9._-]/g, "-").replace(/^[._-]+/, "") || "app";
    return { manager: "docker", command: `docker build -t ${tag} ${gitUrl}.git`, manifest: "Dockerfile", verified: false };
  }

  return null;
}

/** Normalises a repository URL from a registry for comparison with "owner/name". */
export function urlPointsToRepo(url: unknown, repoId: string): boolean {
  if (typeof url !== "string") return false;
  const norm = url
    .toLowerCase()
    .replace(/^git\+/, "")
    .replace(/\.git$/, "")
    .replace(/^git:\/\//, "https://")
    .replace(/^https?:\/\/[^@/]+@github\.com\//, "https://github.com/")
    .replace(/^ssh:\/\/git@github\.com\//, "https://github.com/")
    .replace(/^git@github\.com:/, "https://github.com/");
  const id = repoId.toLowerCase();
  return norm === `https://github.com/${id}` || norm.startsWith(`https://github.com/${id}/`) || norm === `github:${id}` || norm === id;
}
