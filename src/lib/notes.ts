import type { ParsedNotes } from "./types";

/**
 * Collapse the three dash characters that appear interchangeably in the data
 * down to a plain hyphen.
 *
 * This is not cosmetic. BARMM contains both "RDO 102 — Marawi City" (em) and
 * "RDO 102 – Marawi City" (en) for the same district, and Region XIII uses an
 * en-dash where Region XII uses an em-dash. Without this, searching "RDO 102 -"
 * returns half the rows and looks like missing data.
 *
 * Ported verbatim from the original app.
 */
export function normalizeDashes(value: string): string {
  return value.replace(/[‐‑‒–—―]/g, "-");
}

/**
 * The marker that actually delimits the governing order, anchored on the label
 * rather than on the pipe. See parseNotes for why the pipe alone won't do.
 */
const ORDER_MARKER = " | Governing Order:";
const ORDER_PREFIX = "Governing Order:";

/**
 * Split the compound `Notes` field into commentary and governing order.
 *
 * The brief says "split on the first ' | '". Measured against all 226 distinct
 * notes in the three tables, that rule is wrong twice over:
 *
 *  - Region XIII, 8 rows: "<commentary> | Siargao Islands | Governing Order: DO
 *    61-2013 (eff. 01 March 2013)". The commentary itself contains a pipe, so
 *    splitting on the first one puts "Siargao Islands" at the head of the
 *    governing order.
 *  - BARMM, 1 row: "BIR zonal values not available… | Source file labeled
 *    province as 'Sultan Dumalondong'…; corrected to Lanao del Sur — verify."
 *    The tail here is more commentary. Splitting would print it under a
 *    "Governing Order" label, which would be a lie on the face of the UI.
 *  - Region XII, all 47 rows: no " | " at all.
 *
 * So: anchor on the " | Governing Order:" marker, take the *last* one, and
 * leave everything else as commentary. Effectivity dates like "(specific date
 * not retrieved — provisional reference)" are never parsed — the order string
 * renders exactly as stored.
 */
export function parseNotes(raw: string | undefined | null): ParsedNotes {
  const value = (raw ?? "").trim();
  if (value === "") return { commentary: null, governingOrder: null };

  // A note that is nothing but a governing order.
  if (value.startsWith(ORDER_PREFIX)) return { commentary: null, governingOrder: value };

  // lastIndexOf, so a commentary containing its own " | Governing Order:" text
  // can't truncate the real trailing one.
  const marker = value.lastIndexOf(ORDER_MARKER);
  if (marker === -1) return { commentary: value, governingOrder: null };

  const head = value.slice(0, marker).trim();
  const tail = value.slice(marker + " | ".length).trim();

  return {
    commentary: head === "" ? null : head,
    governingOrder: tail,
  };
}
