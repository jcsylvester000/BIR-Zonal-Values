/**
 * Display-only casing for province names.
 *
 * Province casing is inconsistent across the three region tables: Region XIII
 * and XII store Title Case ("Agusan del Norte"), BARMM stores UPPERCASE
 * ("LANAO DEL SUR"). This normalises the *label shown to the user* so the
 * dropdown and table read "Lanao del Sur".
 *
 * It must never touch the value used for filtering or matching. The raw string
 * stays on `ZonalRow.province` and is what exact-match filtering compares, so a
 * text search for "LANAO" still hits via the lowercased `searchIndex`.
 *
 *   toTitleCase("LANAO DEL SUR")   -> "Lanao del Sur"
 *   toTitleCase("Agusan del Norte") -> "Agusan del Norte"
 *
 * Ported verbatim from the original app.
 */

// Spanish/Filipino connectors that stay lowercase unless they lead the name.
const MINOR_WORDS = new Set(["del", "de", "la", "las", "los", "el", "y", "ng", "sa", "da"]);

export function toTitleCase(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "") return "";

  return trimmed
    .toLowerCase()
    .split(/\s+/)
    .map((word, index) => {
      if (index > 0 && MINOR_WORDS.has(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}
