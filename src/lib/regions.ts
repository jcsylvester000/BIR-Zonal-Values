import { prisma } from "./prisma";
import type { RegionConfig } from "./types";

/**
 * Regions are now DATA-DRIVEN: the list is whatever distinct `region` values
 * exist in the `zonal_values` table. Import a CSV with a new region and it
 * simply appears — no hardcoded list to maintain.
 *
 * The front end still wants a stable `id` (used in the API query string and
 * React keys) plus a human `label`. The label IS the stored region string
 * (e.g. "Region I"); the id is a slugified form of it.
 */

/** Slugify a region label into a URL-safe, stable id. */
export function regionIdFromLabel(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Distinct regions currently in the database, sorted by label. */
export async function getRegions(): Promise<Array<RegionConfig>> {
  const rows = await prisma.zonalValue.findMany({
    distinct: ["region"],
    select: { region: true },
    orderBy: { region: "asc" },
  });

  return rows
    .map((r) => r.region)
    .filter((label) => label.trim() !== "")
    .map((label) => ({ id: regionIdFromLabel(label), label }));
}

/** Resolve a region id back to its stored label, or undefined if unknown. */
export async function regionLabelById(id: string): Promise<string | undefined> {
  const regions = await getRegions();
  return regions.find((r) => r.id === id)?.label;
}
