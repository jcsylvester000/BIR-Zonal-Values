import { buildSearchIndex } from "./search";
import { parseNotes } from "./notes";
import { parsePeso } from "./parsePeso";
import type { AdminRecord } from "./adminCsv";
import type { ZonalRow } from "./types";

/**
 * The shape written to the `zonal_values` table. Matches the Prisma
 * `ZonalValue` model minus the auto-generated fields (id, createdAt,
 * updatedAt).
 */
export interface ZonalValueInput {
  region: string;
  municipality: string;
  province: string;
  revenueDistrict: string;
  code: string;
  classification: string;
  lowText: string;
  highText: string;
  lowValue: number | null;
  highValue: number | null;
  dataStatus: string;
  notes: string;
  searchIndex: string;
}

// The NUL byte (U+0000) that buildSearchIndex uses as a field separator.
const NUL = "\u0000";

/**
 * DB-safe search index.
 *
 * PostgreSQL text columns cannot store the NUL byte, but `buildSearchIndex`
 * separates fields with " <NUL> ". We keep the exact same haystack and simply
 * drop the NUL, leaving the two spaces around it as the field boundary. Search
 * is a case-insensitive `.includes()` on the app side against the fetched rows,
 * and a space is a natural boundary that never appears mid-field in a way that
 * would create a false cross-field match — so matching behaviour is unchanged,
 * and the value is now storable.
 */
export function dbSearchIndex(parts: Array<string>): string {
  return buildSearchIndex(parts).split(NUL).join("");
}

/**
 * Turn a validated admin record into a DB row.
 *
 * Write-side twin of the read-path mapper: the SAME parsePeso runs here, and
 * the search index uses the same buildSearchIndex field list (Municipality /
 * Province / RDO / Code / Classification, Notes excluded) — only the NUL
 * separator is removed so Postgres accepts it. `notes` is stored raw and split
 * on read via parseNotes, so that logic stays in one place.
 */
export function adminRecordToDbRow(rec: AdminRecord): ZonalValueInput {
  return {
    region: rec.region.trim(),
    municipality: rec.municipality,
    province: rec.province,
    revenueDistrict: rec.revenueDistrict,
    code: rec.code,
    classification: rec.classification,
    lowText: rec.lowText,
    highText: rec.highText,
    lowValue: parsePeso(rec.lowText),
    highValue: parsePeso(rec.highText),
    dataStatus: rec.dataStatus,
    notes: rec.notes,
    searchIndex: dbSearchIndex([
      rec.municipality,
      rec.province,
      rec.revenueDistrict,
      rec.code,
      rec.classification,
    ]),
  };
}

/**
 * Turn a DB record (as returned by Prisma) into the `ZonalRow` the front end
 * renders. Notes is split here with parseNotes, exactly as the original fetch
 * path did. `dbRow` is typed structurally so this module needn't import the
 * generated Prisma types.
 */
export function dbRowToZonalRow(dbRow: {
  id: string;
  region: string;
  municipality: string;
  province: string;
  revenueDistrict: string;
  code: string;
  classification: string;
  lowText: string;
  highText: string;
  lowValue: number | null;
  highValue: number | null;
  dataStatus: string;
  notes: string;
  searchIndex: string;
}): ZonalRow {
  return {
    id: dbRow.id,
    municipality: dbRow.municipality,
    province: dbRow.province,
    region: dbRow.region,
    revenueDistrict: dbRow.revenueDistrict,
    code: dbRow.code,
    classification: dbRow.classification,
    lowText: dbRow.lowText,
    highText: dbRow.highText,
    lowValue: dbRow.lowValue,
    highValue: dbRow.highValue,
    dataStatus: dbRow.dataStatus,
    notes: parseNotes(dbRow.notes),
    searchIndex: dbRow.searchIndex,
  };
}
