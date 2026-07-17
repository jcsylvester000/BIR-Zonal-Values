/**
 * Admin-side helpers: field schema, CSV parse/serialise, and per-record
 * validation for the zonal-value upload dashboard.
 *
 * Ported from the original app. In this front-end phase it still validates
 * and exports rather than writing to a database; when Neon is wired up the
 * same records feed the INSERT/UPDATE path. Money validation reuses `parsePeso`
 * so the dashboard's idea of "a valid peso cell" is identical to the read
 * path's — a value is fine if it parses, if it is blank, or if it is an
 * explicit "Not Available" note.
 */

import { buildSearchIndex } from "./search";
import { parseNotes } from "./notes";
import { parsePeso } from "./parsePeso";
import type { ZonalRow } from "./types";

export type AdminFieldKey =
  | "municipality"
  | "province"
  | "region"
  | "revenueDistrict"
  | "code"
  | "classification"
  | "lowText"
  | "highText"
  | "dataStatus"
  | "notes";

export interface FieldDef {
  key: AdminFieldKey;
  /** Exact source column header — what import/export files use. */
  header: string;
  required: boolean;
  control: "text" | "region" | "status" | "notes";
}

export const FIELDS: ReadonlyArray<FieldDef> = [
  { key: "municipality", header: "Municipality / City", required: true, control: "text" },
  { key: "province", header: "Province", required: true, control: "text" },
  { key: "region", header: "Region", required: true, control: "region" },
  { key: "revenueDistrict", header: "BIR Revenue District", required: false, control: "text" },
  { key: "code", header: "Code", required: false, control: "text" },
  { key: "classification", header: "Classification", required: true, control: "text" },
  { key: "lowText", header: "Low (₱/sqm)", required: false, control: "text" },
  { key: "highText", header: "High (₱/sqm)", required: false, control: "text" },
  { key: "dataStatus", header: "Data Status", required: false, control: "status" },
  { key: "notes", header: "Notes", required: false, control: "notes" },
];

export type AdminRecord = Record<AdminFieldKey, string>;

/** The literal the BARMM table ships when a value is unknown. */
export const NA_TEXT = "Not Available — Verification Required";

export const DATA_STATUSES = ["Verified", "Assumed", "Not Available"] as const;

export function emptyRecord(overrides: Partial<AdminRecord> = {}): AdminRecord {
  return {
    municipality: "",
    province: "",
    region: "",
    revenueDistrict: "",
    code: "",
    classification: "",
    lowText: "",
    highText: "",
    dataStatus: "",
    notes: "",
    ...overrides,
  };
}

// --- Validation ------------------------------------------------------------

export type Severity = "error" | "warning";

export interface Issue {
  field: AdminFieldKey | null;
  severity: Severity;
  message: string;
}

type MoneyKind = "empty" | "number" | "na" | "invalid";

function moneyKind(value: string): MoneyKind {
  const t = value.trim();
  if (t === "") return "empty";
  if (parsePeso(t) !== null) return "number";
  if (/not\s*available/i.test(t)) return "na";
  return "invalid";
}

/**
 * Errors block nothing here (the file still exports) but flag rows a reviewer
 * must fix — missing required fields. Warnings are softer: a money cell that is
 * neither a number nor an explicit "Not Available", a low above its high, an
 * unrecognised status or region.
 */
export function validateRecord(rec: AdminRecord, knownRegions: ReadonlyArray<string>): Array<Issue> {
  const issues: Array<Issue> = [];

  for (const f of FIELDS) {
    if (f.required && rec[f.key].trim() === "") {
      issues.push({ field: f.key, severity: "error", message: `${f.header} is required.` });
    }
  }

  if (moneyKind(rec.lowText) === "invalid") {
    issues.push({
      field: "lowText",
      severity: "warning",
      message: `Low "${rec.lowText}" is not a peso amount or a "Not Available" note.`,
    });
  }
  if (moneyKind(rec.highText) === "invalid") {
    issues.push({
      field: "highText",
      severity: "warning",
      message: `High "${rec.highText}" is not a peso amount or a "Not Available" note.`,
    });
  }

  const lo = parsePeso(rec.lowText);
  const hi = parsePeso(rec.highText);
  if (lo !== null && hi !== null && lo > hi) {
    issues.push({
      field: null,
      severity: "warning",
      message: `Low (${lo}) is greater than High (${hi}) — check the order.`,
    });
  }

  const status = rec.dataStatus.trim();
  if (status !== "" && !(DATA_STATUSES as ReadonlyArray<string>).includes(status)) {
    issues.push({
      field: "dataStatus",
      severity: "warning",
      message: `Data Status "${status}" is not one of ${DATA_STATUSES.join(", ")}.`,
    });
  }

  const region = rec.region.trim();
  if (region !== "" && !knownRegions.includes(region)) {
    issues.push({
      field: "region",
      severity: "warning",
      message: `Region "${region}" doesn't match a configured region.`,
    });
  }

  return issues;
}

export function worstSeverity(issues: ReadonlyArray<Issue>): Severity | null {
  if (issues.some((i) => i.severity === "error")) return "error";
  if (issues.some((i) => i.severity === "warning")) return "warning";
  return null;
}

// --- CSV parsing (RFC 4180-ish) -------------------------------------------

/**
 * Parse CSV into a grid of cells. Handles quoted fields, escaped quotes (""),
 * and newlines inside quotes. `charAt` rather than indexing so the loop stays
 * clear of `noUncheckedIndexedAccess` undefineds.
 */
export function parseCsv(text: string): Array<Array<string>> {
  const s = text.replace(/\r\n?/g, "\n");
  const rows: Array<Array<string>> = [];
  let row: Array<string> = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < s.length; i += 1) {
    const c = s.charAt(i);
    if (inQuotes) {
      if (c === '"') {
        if (s.charAt(i + 1) === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += c;
    }
  }

  row.push(cell);
  rows.push(row);

  // Drop a trailing empty row produced by a final newline.
  const last = rows[rows.length - 1];
  if (last && last.length === 1 && last[0] === "") rows.pop();

  return rows;
}

function normHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const HEADER_LOOKUP: Readonly<Record<string, AdminFieldKey>> = (() => {
  const map: Record<string, AdminFieldKey> = {};
  for (const f of FIELDS) map[normHeader(f.header)] = f.key;
  // A few forgiving aliases so a slightly-off header still lands.
  map[normHeader("Municipality")] = "municipality";
  map[normHeader("City")] = "municipality";
  map[normHeader("RDO")] = "revenueDistrict";
  map[normHeader("Revenue District")] = "revenueDistrict";
  map[normHeader("Low")] = "lowText";
  map[normHeader("High")] = "highText";
  map[normHeader("Status")] = "dataStatus";
  return map;
})();

function headerToKey(header: string): AdminFieldKey | null {
  return HEADER_LOOKUP[normHeader(header)] ?? null;
}

export interface CsvImportResult {
  records: Array<AdminRecord>;
  /** Header-level problems: missing required columns, ignored columns. */
  headerIssues: Array<string>;
}

export function recordsFromCsv(text: string): CsvImportResult {
  const table = parseCsv(text);
  const headerIssues: Array<string> = [];

  if (table.length === 0) {
    return { records: [], headerIssues: ["The file appears to be empty."] };
  }

  const headerRow = table[0] ?? [];
  const colMap = headerRow.map((h) => headerToKey(h));
  const mapped = new Set<AdminFieldKey>();
  for (const key of colMap) if (key) mapped.add(key);

  for (const f of FIELDS) {
    if (f.required && !mapped.has(f.key)) {
      headerIssues.push(`Missing required column: "${f.header}".`);
    }
  }
  headerRow.forEach((h, i) => {
    if (colMap[i] === null && h.trim() !== "") {
      headerIssues.push(`Column "${h}" wasn't recognised and was ignored.`);
    }
  });

  const records: Array<AdminRecord> = [];
  for (let r = 1; r < table.length; r += 1) {
    const cells = table[r] ?? [];
    if (cells.every((c) => c.trim() === "")) continue; // skip blank lines
    const rec = emptyRecord();
    colMap.forEach((key, i) => {
      if (key) rec[key] = (cells[i] ?? "").trim();
    });
    records.push(rec);
  }

  return { records, headerIssues };
}

// --- Serialisation ---------------------------------------------------------

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** CSV with the exact source headers, ready to import. */
export function toCsv(records: ReadonlyArray<AdminRecord>): string {
  const header = FIELDS.map((f) => csvCell(f.header)).join(",");
  const lines = records.map((rec) => FIELDS.map((f) => csvCell(rec[f.key])).join(","));
  return [header, ...lines].join("\r\n");
}

export function toJson(records: ReadonlyArray<AdminRecord>): string {
  const objects = records.map((rec) => {
    const obj: Record<string, string> = {};
    for (const f of FIELDS) obj[f.header] = rec[f.key];
    return obj;
  });
  return JSON.stringify(objects, null, 2);
}

// --- Bridge into the search view ------------------------------------------

let localSeq = 0;

/**
 * Turn a staged admin row into a `ZonalRow` for the in-memory Search dataset.
 *
 * This mirrors the read-path mapper exactly — same parsed values, same
 * `searchIndex` field list (Municipality / Province / RDO / Code /
 * Classification, Notes excluded) — so a saved row behaves identically to a
 * fetched one. It reuses the same lib helpers rather than reimplementing them.
 */
export function adminRecordToZonalRow(rec: AdminRecord): ZonalRow {
  localSeq += 1;
  return {
    id: `local-${localSeq}`,
    municipality: rec.municipality,
    province: rec.province,
    region: rec.region,
    revenueDistrict: rec.revenueDistrict,
    code: rec.code,
    classification: rec.classification,
    lowText: rec.lowText,
    highText: rec.highText,
    lowValue: parsePeso(rec.lowText),
    highValue: parsePeso(rec.highText),
    dataStatus: rec.dataStatus,
    notes: parseNotes(rec.notes),
    searchIndex: buildSearchIndex([
      rec.municipality,
      rec.province,
      rec.revenueDistrict,
      rec.code,
      rec.classification,
    ]),
  };
}

/** A blank template plus two example rows (one numeric, one "Not Available"). */
export function templateCsv(sampleRegion: string): string {
  return toCsv([
    emptyRecord({
      municipality: "Butuan City",
      province: "Agusan del Norte",
      region: sampleRegion,
      revenueDistrict: "RDO 102 - Butuan City",
      code: "RR",
      classification: "Residential Regular",
      lowText: "₱310",
      highText: "₱26,250",
      dataStatus: "Verified",
      notes: "Example row — replace with real data.",
    }),
    emptyRecord({
      municipality: "Example Municipality",
      province: "Example Province",
      region: sampleRegion,
      classification: "Commercial",
      lowText: NA_TEXT,
      highText: NA_TEXT,
      dataStatus: "Not Available",
    }),
  ]);
}
