import { promises as fs } from "node:fs";
import path from "node:path";
import { get, put } from "@vercel/blob";

/**
 * Persistent JSON storage.
 * - On Vercel with a Blob store connected (BLOB_READ_WRITE_TOKEN): Vercel Blob.
 * - Otherwise: local files in DATA_DIR (default ./.data) – for development and tests.
 */

export type StoreKey = "snapshot.json" | "enriched.json" | "history.json";

const PREFIX = "universe/";

function blobEnabled(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

function blobAccess(): "private" | "public" {
  return process.env.BLOB_ACCESS === "public" ? "public" : "private";
}

function dataDir(): string {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  return process.env.VERCEL ? "/tmp/github-universe" : path.join(process.cwd(), ".data");
}

export function storeKind(): "blob" | "file" {
  return blobEnabled() ? "blob" : "file";
}

export async function readJSON<T>(key: StoreKey): Promise<T | null> {
  if (blobEnabled()) {
    const res = await get(PREFIX + key, { access: blobAccess(), useCache: false });
    if (!res || res.statusCode !== 200) return null;
    const text = await new Response(res.stream).text();
    return JSON.parse(text) as T;
  }
  try {
    const text = await fs.readFile(path.join(dataDir(), key), "utf8");
    return JSON.parse(text) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function writeJSON(key: StoreKey, value: unknown): Promise<void> {
  const body = JSON.stringify(value);
  if (blobEnabled()) {
    await put(PREFIX + key, body, {
      access: blobAccess(),
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
      cacheControlMaxAge: 60,
    });
    return;
  }
  const dir = dataDir();
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `${key}.${process.pid}.tmp`);
  await fs.writeFile(tmp, body, "utf8");
  await fs.rename(tmp, path.join(dir, key)); // atomic replace
}
