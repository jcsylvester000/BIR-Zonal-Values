/**
 * Turn a source peso string into a number.
 *
 * The brief promised "₱310" | "₱41,625" | "₱2,839.3". The BARMM table also
 * ships "Not Available — Verification Required" in the same column, so this
 * returns null rather than NaN and callers are forced to handle the miss.
 *
 *   parsePeso("₱310")       -> 310
 *   parsePeso("₱41,625")    -> 41625
 *   parsePeso("₱2,839.3")   -> 2839.3
 *   parsePeso("Not Available — Verification Required") -> null
 *   parsePeso("")           -> null
 *
 * Note the ` ` strip: text pasted from spreadsheets carries non-breaking
 * spaces that would defeat a plain trim().
 *
 * Ported verbatim from the original app — verified against the real data.
 */
export function parsePeso(value: string | undefined | null): number | null {
  if (value == null) return null;

  const cleaned = value
    .replace(/[₱₱]/g, "")
    .replace(/,/g, "")
    .replace(/[\s ]/g, "");

  if (cleaned === "") return null;

  // Reject anything that isn't purely a number: "NotAvailable—VerificationRequired"
  // would otherwise slip through Number() as NaN and get compared silently.
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;

  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Render Low/High as one range cell, using the original strings.
 *
 *   "₱310", "₱26,250"  -> "₱310 – ₱26,250"
 *   "₱635", "₱635"     -> "₱635"            (a point, not a range)
 *   "Not Available …"  -> "Not Available …" (passed through untouched)
 */
export function formatRange(lowText: string, highText: string): string {
  const low = lowText.trim();
  const high = highText.trim();

  if (low === "" && high === "") return "—";
  if (low === "") return high;
  if (high === "") return low;
  if (low === high) return low;

  return `${low} – ${high}`;
}
