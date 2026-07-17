import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { regionLabelById } from "@/lib/regions";
import { dbRowToZonalRow } from "@/lib/toDbRow";
import type { ZonalRow } from "@/lib/types";

/**
 * GET /api/zonal-values?region=<regionId>
 *
 * Returns every zonal-value row for one region, from Postgres. This is the seam
 * the whole front end talks to; it now queries Neon instead of the mock. The
 * response shape — `{ region, rows: ZonalRow[] }` — is unchanged, so nothing
 * downstream was touched.
 *
 * Not filtered by province / municipality / classification / text: the app
 * fetches a region's full set once and filters in memory on submit (the
 * non-progressive search contract).
 */

export const dynamic = "force-dynamic";

interface RegionResponse {
  region: string;
  rows: Array<ZonalRow>;
}

export async function GET(
  request: Request,
): Promise<NextResponse<RegionResponse | { error: string }>> {
  const { searchParams } = new URL(request.url);
  const regionId = searchParams.get("region");

  if (!regionId) {
    return NextResponse.json({ error: "Missing required query parameter: region." }, { status: 400 });
  }

  const label = await regionLabelById(regionId);
  if (!label) {
    return NextResponse.json({ error: `Unknown region: ${regionId}.` }, { status: 404 });
  }

  const dbRows = await prisma.zonalValue.findMany({
    where: { region: label },
    orderBy: [{ province: "asc" }, { municipality: "asc" }, { classification: "asc" }],
  });

  return NextResponse.json({ region: label, rows: dbRows.map(dbRowToZonalRow) });
}
