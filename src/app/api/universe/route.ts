import type { NextRequest } from "next/server";
import { getUniverse } from "@/lib/server/universe";
import { isPeriod } from "@/lib/types";

/**
 * GET /api/universe?period=24h|7d|30d
 * Serves the normalised universe from the cached snapshot. Never calls source APIs.
 */
export async function GET(request: NextRequest) {
  const period = request.nextUrl.searchParams.get("period") ?? "7d";
  if (!isPeriod(period)) {
    return Response.json({ error: "period must be one of 24h, 7d, 30d" }, { status: 400 });
  }
  const payload = await getUniverse(period);
  return Response.json(payload, {
    headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600" },
  });
}
