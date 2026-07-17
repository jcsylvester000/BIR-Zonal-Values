import { NextResponse } from "next/server";
import { getRegions } from "@/lib/regions";
import type { RegionConfig } from "@/lib/types";

/**
 * GET /api/regions
 *
 * The distinct regions currently in the database (id + label). Data-driven:
 * import a CSV with a new region and it appears here. The client uses this to
 * refresh its region dropdown after an import without a full reload.
 */

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse<{ regions: Array<RegionConfig> }>> {
  const regions = await getRegions();
  return NextResponse.json({ regions });
}
