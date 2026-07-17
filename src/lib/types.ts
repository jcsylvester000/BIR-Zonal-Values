/**
 * Domain types for the BIR zonal-value app.
 *
 * Ported verbatim from the original Vite app. `ZonalValueFields` (the raw
 * Airtable wire shape) is retained so the seed/ETL step that will later load
 * Neon from the exported data can keep using the exact source field names —
 * nothing else in the app should ever spell "Low (₱/sqm)".
 */

/** Raw field shape of one source record (per-region table). */
export interface ZonalValueFields {
  "Municipality / City"?: string;
  Province?: string;
  Region?: string;
  "BIR Revenue District"?: string;
  /** Absent on a couple of BARMM rows. */
  Code?: string;
  Classification?: string;
  /** Text, not a number. Usually "₱310"; sometimes "Not Available — Verification Required". */
  "Low (₱/sqm)"?: string;
  "High (₱/sqm)"?: string;
  /** "Verified" | "Assumed" | "Not Available" — not constant, despite the brief. */
  "Data Status"?: string;
  /** Empty on most BARMM rows. */
  Notes?: string;
}

/**
 * Split form of the `Notes` field.
 *
 * Region XIII notes are compound: "<commentary> | Governing Order: <order> (eff. <date>)".
 * Region XII notes have no " | " at all.
 * BARMM notes are usually empty, and when they do contain " | " the tail is
 * more commentary, not a governing order — so the tail is only promoted to
 * `governingOrder` when it actually announces itself as one.
 */
export interface ParsedNotes {
  commentary: string | null;
  governingOrder: string | null;
}

/** One municipality × land classification row, cleaned up. */
export interface ZonalRow {
  id: string;
  municipality: string;
  province: string;
  region: string;
  revenueDistrict: string;
  code: string;
  classification: string;
  /** Original strings, rendered back to the user verbatim. */
  lowText: string;
  highText: string;
  /** Parsed forms. `null` when the text is not a peso amount. */
  lowValue: number | null;
  highValue: number | null;
  dataStatus: string;
  notes: ParsedNotes;
  /** Pre-lowercased, dash-normalised haystack for substring matching. */
  searchIndex: string;
}

/** A configured region. In the DB phase these come from the `region` column. */
export interface RegionConfig {
  id: string;
  label: string;
}
