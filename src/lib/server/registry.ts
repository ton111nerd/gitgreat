import { isSafeCrateName, isSafeNpmName, isSafePypiName, languageAllows, parseManifestNames, urlPointsToRepo, type ManifestInput } from "../install";
import type { FetchLike } from "./github";

/**
 * Checks whether a package name from a manifest really belongs to this repository
 * (registry metadata points back to github.com/owner/name). Prevents recommending a
 * same-named package published by someone else.
 */

async function getJSON(fetchImpl: FetchLike, url: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetchImpl(url, {
      headers: { "User-Agent": "github-universe (https://github.com)", Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function verifyRegistries(input: ManifestInput, fetchImpl: FetchLike = fetch): Promise<NonNullable<ManifestInput["verified"]>> {
  const names = parseManifestNames(input);
  const files = new Set(input.files);
  const result: NonNullable<ManifestInput["verified"]> = {};

  if (files.has("package.json") && names.npm && !names.npm.private && isSafeNpmName(names.npm.name) && languageAllows("npm", input.language)) {
    const meta = await getJSON(fetchImpl, `https://registry.npmjs.org/${names.npm.name.replace("/", "%2F")}`);
    const repo = meta?.repository as { url?: unknown } | string | undefined;
    result.npm = urlPointsToRepo(typeof repo === "string" ? repo : repo?.url, input.repoId);
    return result; // npm wins the priority order – no need to check others
  }

  const pyName = names.pypi ?? names.setupPyName;
  if ((files.has("pyproject.toml") || files.has("setup.py")) && pyName && isSafePypiName(pyName) && languageAllows("pip", input.language)) {
    const meta = await getJSON(fetchImpl, `https://pypi.org/pypi/${encodeURIComponent(pyName)}/json`);
    const info = (meta?.info ?? {}) as { project_urls?: Record<string, unknown> | null; home_page?: unknown };
    const urls = [info.home_page, ...Object.values(info.project_urls ?? {})];
    result.pypi = urls.some((u) => urlPointsToRepo(u, input.repoId));
    return result;
  }

  if (files.has("Cargo.toml") && names.crate?.name && isSafeCrateName(names.crate.name) && languageAllows("cargo", input.language)) {
    const meta = await getJSON(fetchImpl, `https://crates.io/api/v1/crates/${encodeURIComponent(names.crate.name)}`);
    const crate = (meta?.crate ?? {}) as { repository?: unknown };
    result.crates = urlPointsToRepo(crate.repository, input.repoId);
    const versions = (meta?.versions ?? []) as Array<{ bin_names?: unknown }>;
    if (result.crates && Array.isArray(versions[0]?.bin_names)) {
      result.crateHasBin = (versions[0].bin_names as unknown[]).length > 0;
    }
  }
  return result;
}
