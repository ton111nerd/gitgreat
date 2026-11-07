import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { revalidateTag } from "next/cache";
import { refreshUniverse } from "@/lib/server/pipeline";
import { UNIVERSE_TAG } from "@/lib/server/universe";

export const maxDuration = 300;

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail closed: the job is expensive and must not be publicly triggerable
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Hourly refresh (Vercel Cron sends `Authorization: Bearer $CRON_SECRET`).
 * On any failure the previous snapshot stays untouched and keeps being served.
 */
export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await refreshUniverse();
    revalidateTag(UNIVERSE_TAG, { expire: 0 });
    console.log("[cron] refresh ok", JSON.stringify(result));
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron] refresh failed – keeping last snapshot:", message);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
